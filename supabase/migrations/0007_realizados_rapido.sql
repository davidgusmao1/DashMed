-- DashMed — importação de realizados rápida o bastante para o limite do banco
-- (11/11/26). Na primeira prévia da lista "2025_2026 - ATQ, ATJ, AH, VISCO, PRP
-- e Hidrogel.xlsx" no ar, o banco cancelou por tempo ("statement timeout": quem
-- está logado tem 8 s por comando); medimos 13 s. A busca do paciente pelo nome
-- ("chave = nome ou chave like 'nome|%'") não usava índice: para cada uma das
-- 206 linhas lia os 559 pacientes, e a RLS rodava vejo_cliente() em cada um.
-- Só o índice não bastou (medimos 13 s de novo): com RLS, o Postgres não usa
-- índice em expressão que não é "leakproof" (split_part, regex), e roda
-- vejo_cliente() em cada linha lida. Então a função passa a ser security
-- definer: confere UMA vez, no começo, se quem chamou enxerga o cliente
-- (vejo_cliente com o auth.uid() de quem chamou) e daí em diante filtra tudo
-- explicitamente por p_cliente — só lê e grava pacientes, terapias e
-- realizações daquele cliente. Auditoria e situacao_por continuam com o
-- auth.uid() de quem importou. Fora isso, igual à 0006.

create index pacientes_chave_nome_idx on pacientes (cliente_id, split_part(chave_importacao, '|', 1))
  where deleted_at is null;

create or replace function importar_realizados(
  p_cliente uuid, p_arquivo text, p_linhas jsonb, p_erros jsonb default '[]',
  p_meses_ah int default 6, p_simular boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l jsonb;
  t record;
  v_imp uuid;
  v_pac uuid;
  v_qtd int;
  v_ter uuid;
  v_n int;
  v_erros jsonb := coalesce(p_erros, '[]');
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_res jsonb;
  v_tocadas uuid[] := '{}';
  v_pac_achados uuid[] := '{}';
  v_ult date;
  v_feitos int;
  v_indicados int;
  v_pendente boolean;
  v_nova_etapa text;
  c_novas int := 0;
  c_dup int := 0;
  c_sem_pac int := 0;
  c_homonimo int := 0;
  c_sem_terapia int := 0;
  c_cirurgia int := 0;
  c_pendente int := 0;
  c_ah int := 0;
  c_ah_vencido int := 0;
  c_ah_em_dia int := 0;
  c_outras_feitas int := 0;
  c_etapa_mudou int := 0;
  c_humano int := 0;
  c_outras_de_operado int := 0;
begin
  if not vejo_cliente(p_cliente) then
    raise exception 'Você não tem acesso a este cliente.' using errcode = '42501';
  end if;
  if p_meses_ah is null or p_meses_ah < 1 or p_meses_ah > 60 then
    raise exception 'Prazo de renovação do AH inválido (1 a 60 meses).' using errcode = '22023';
  end if;

  begin -- na prévia, este bloco termina com um erro que desfaz tudo
    perform set_config('dashmed.importando', 'sim', true);
    insert into importacoes (cliente_id, arquivo, tipo, prazos, linhas)
    values (p_cliente, p_arquivo, 'realizados', jsonb_build_object('AH', p_meses_ah),
            jsonb_array_length(p_linhas) + jsonb_array_length(v_erros))
    returning id into v_imp;

    for l in select value from jsonb_array_elements(p_linhas) loop
      -- paciente pelo nome (com ou sem nascimento na chave); só quem já está no CRM
      select count(*), min(id::text)::uuid into v_qtd, v_pac from pacientes
       where cliente_id = p_cliente and deleted_at is null
         and split_part(chave_importacao, '|', 1) = l->>'chave_nome';
      if v_qtd = 0 then
        c_sem_pac := c_sem_pac + 1;
        v_erros := v_erros || jsonb_build_object('linha', (l->>'linha')::int, 'motivo', 'paciente não está no CRM');
        continue;
      elsif v_qtd > 1 then
        c_homonimo := c_homonimo + 1;
        v_erros := v_erros || jsonb_build_object('linha', (l->>'linha')::int, 'motivo', 'há mais de um paciente com esse nome');
        continue;
      end if;
      v_pac_achados := v_pac_achados || v_pac;

      v_ter := null;
      select id into v_ter from terapias
       where cliente_id = p_cliente and paciente_id = v_pac and deleted_at is null and familia_procedimento(procedimento) = l->>'procedimento'
       order by ultima_indicacao_em desc nulls last limit 1;
      if v_ter is null then
        c_sem_terapia := c_sem_terapia + 1;
      end if;

      insert into realizacoes (cliente_id, paciente_id, terapia_id, procedimento, descricao, lado, articulacao, realizada_em, importacao_id)
      values (p_cliente, v_pac, v_ter, l->>'procedimento', nullif(l->>'descricao', ''), nullif(l->>'lado', ''),
              nullif(l->>'articulacao', ''), (l->>'data')::date, v_imp)
      on conflict (paciente_id, procedimento, realizada_em, coalesce(articulacao, '')) where deleted_at is null do nothing;
      get diagnostics v_n = row_count;
      if v_n = 0 then c_dup := c_dup + 1; else c_novas := c_novas + 1; end if;
    end loop;

    -- recalcula cada terapia (de quem foi achado) que tem realização da mesma família
    for t in
      select tr.*, familia_procedimento(tr.procedimento) as familia from terapias tr
       where tr.cliente_id = p_cliente and tr.paciente_id = any (v_pac_achados) and tr.deleted_at is null
         and exists (select 1 from realizacoes r where r.paciente_id = tr.paciente_id and r.deleted_at is null
                      and r.procedimento = familia_procedimento(tr.procedimento))
    loop
      select max(realizada_em) into v_ult from realizacoes
       where paciente_id = t.paciente_id and procedimento = t.familia and deleted_at is null;

      -- lados indicados: 2 se a indicação fala em bilateral
      v_indicados := case when exists (
        select 1 from indicacoes i where i.terapia_id = t.id and i.deleted_at is null
           and (coalesce(i.procedimento_original, '') ~* 'bilateral|ambos|ambas|dois lados|\mjoelhos\M|\mquadris\M'
             or coalesce(i.nota, '') ~* 'bilateral|ambos os lados|dois lados')) then 2 else 1 end;
      if t.familia in ('ATQ', 'ATJ', 'VAQ') then
        -- cirurgia: soma os lados de todas as realizações
        select coalesce(sum(case when lado = 'bilateral' then 2 else 1 end), 0) into v_feitos from realizacoes
         where paciente_id = t.paciente_id and procedimento = t.familia and deleted_at is null;
        -- (não usamos "indicação depois da cirurgia": a extração do Apolo marca
        -- como ATQ/MAKO os retornos de pós-operatório que citam a prótese)
        v_pendente := v_feitos < v_indicados;
      else
        -- aplicação: conta os lados da última rodada (até 60 dias antes da última)
        select coalesce(sum(case when lado = 'bilateral' then 2 else 1 end), 0) into v_feitos from realizacoes
         where paciente_id = t.paciente_id and procedimento = t.familia and deleted_at is null
           and realizada_em > v_ult - 60;
        v_pendente := v_feitos < v_indicados;
      end if;

      update terapias set
        ultima_realizacao_em = v_ult,
        lado_pendente = v_pendente,
        vence_em = case when t.familia = 'AH' and not vence_em_manual
                        then (v_ult + make_interval(months => p_meses_ah))::date else vence_em end
      where id = t.id;

      v_nova_etapa := case when v_pendente then 'a_chamar' else 'realizado' end;
      if t.situacao_auto and t.contatos_qtd = 0 then
        if t.situacao <> v_nova_etapa then
          update terapias set situacao = v_nova_etapa where id = t.id;
          c_etapa_mudou := c_etapa_mudou + 1;
        end if;
      else
        c_humano := c_humano + 1;
      end if;

      if v_pendente then
        c_pendente := c_pendente + 1;
      elsif t.familia in ('ATQ', 'ATJ', 'VAQ') then
        c_cirurgia := c_cirurgia + 1;
      elsif t.familia = 'AH' then
        c_ah := c_ah + 1;
        if (v_ult + make_interval(months => p_meses_ah))::date <= v_hoje then
          c_ah_vencido := c_ah_vencido + 1;
        else
          c_ah_em_dia := c_ah_em_dia + 1;
        end if;
      else
        c_outras_feitas := c_outras_feitas + 1;
      end if;
    end loop;

    -- quem operou e ainda tem outra terapia a contatar (ex.: AH no mesmo
    -- quadril): só conta, para o médico decidir
    select count(*) into c_outras_de_operado from terapias tr
     where tr.cliente_id = p_cliente and tr.paciente_id = any (v_pac_achados) and tr.deleted_at is null and tr.situacao = 'a_chamar'
       and familia_procedimento(tr.procedimento) is distinct from 'ATQ'
       and exists (select 1 from realizacoes r where r.paciente_id = tr.paciente_id and r.procedimento = 'ATQ' and r.deleted_at is null);

    v_res := jsonb_build_object(
      'importacao_id', case when p_simular then null else v_imp end,
      'linhas', jsonb_array_length(p_linhas) + jsonb_array_length(coalesce(p_erros, '[]')),
      'realizacoes_novas', c_novas, 'ja_existiam', c_dup,
      'pacientes_encontrados', coalesce(array_length(array(select distinct unnest(v_pac_achados)), 1), 0),
      'sem_paciente', c_sem_pac, 'homonimos', c_homonimo, 'sem_terapia', c_sem_terapia,
      'cirurgias_concluidas', c_cirurgia, 'lado_pendente', c_pendente,
      'ah_com_data', c_ah, 'ah_vencidos', c_ah_vencido, 'ah_em_dia', c_ah_em_dia,
      'outras_realizadas', c_outras_feitas, 'etapas_mudadas', c_etapa_mudou,
      'mexidas_por_pessoa', c_humano, 'outras_terapias_de_operados', c_outras_de_operado,
      'com_erro', jsonb_array_length(v_erros), 'erros', v_erros);

    update importacoes set
      com_erro = jsonb_array_length(v_erros), erros = v_erros, ja_existiam = c_dup,
      resumo = v_res - 'erros', concluida_em = now()
    where id = v_imp;
    perform set_config('dashmed.importando', '', true);

    if p_simular then
      raise exception 'prévia' using errcode = 'DMSIM';
    end if;
  exception when sqlstate 'DMSIM' then
    null; -- prévia: a gravação foi desfeita; os números ficaram em v_res
  end;
  return v_res;
end $$;
revoke execute on function importar_realizados(uuid, text, jsonb, jsonb, int, boolean) from public, anon;
grant execute on function importar_realizados(uuid, text, jsonb, jsonb, int, boolean) to authenticated;
