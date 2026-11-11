-- DashMed — procedimentos já realizados tiram o paciente do resgate
-- (David, 11/11/26, com a lista "2025_2026 - ATQ, ATJ, AH, VISCO, PRP e
-- Hidrogel.xlsx": "Nessa lista tem os pacientes que já fizeram prótese de
-- quadril, prótese de joelho e cirurgias de vídeo. Pacientes que já fizeram
-- ácido hialurônico, e ali tem a data ... Se a data ... passou de 6 meses, ele
-- é candidato a ser chamado novamente. Se o paciente já fez cirurgia, ele não
-- precisa ser chamado ... Se por acaso algum paciente foi indicado fazer a
-- terapia bilateral, a gente tem que levar isso em consideração.").
--
-- Regras:
-- - REALIZACOES guarda cada procedimento feito (data, família, lado). Só casa
--   com quem já está no CRM, pelo nome (a lista não tem nascimento); quem não
--   está fica relatado na importação, sem criar paciente.
-- - Cirurgia (ATQ, ATJ, VAQ) feita → a terapia da mesma família vira
--   Realizado, salvo indicação bilateral com um lado só feito: aí fica a
--   contatar com "falta o outro lado".
-- - AH (inclui viscossuplementação): vence 6 meses depois da última
--   aplicação. Fica Realizado, e o quadro o mostra em "A contatar" quando
--   vencer (sem cron). Indicação bilateral com a última aplicação de um lado só
--   → a contatar já.
-- - Hidrogel, PRP e BMAC feitos → Realizado (sem renovação), com a mesma
--   regra do lado.
-- - A etapa só muda se ninguém mexeu no cartão (situacao_auto e nenhuma
--   ligação): humano ganha do robô, como na 0005.

-- ── realizações ─────────────────────────────────────────────────────────
create table realizacoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  paciente_id uuid not null,
  -- a terapia da mesma família que a realização atualizou (nula se o
  -- paciente não tinha essa indicação, ex.: ATJ)
  terapia_id uuid,
  -- família: AH, Hidrogel, PRP, BMAC, ATQ, ATJ, VAQ
  procedimento text not null check (procedimento in ('AH', 'Hidrogel', 'PRP', 'BMAC', 'ATQ', 'ATJ', 'VAQ')),
  -- como estava na planilha, ex. "ATQ Unimed", "AH BILATERAL"
  descricao text,
  lado text check (lado in ('unilateral', 'bilateral')),
  articulacao text,
  realizada_em date not null,
  importacao_id uuid references importacoes(id),
  criado_em timestamptz not null default now(),
  criado_por uuid references usuarios(id) default auth.uid(),
  deleted_at timestamptz,
  foreign key (paciente_id, cliente_id) references pacientes (id, cliente_id),
  foreign key (terapia_id, cliente_id) references terapias (id, cliente_id)
);
-- reimportar a mesma lista não repete a realização
create unique index realizacoes_unica on realizacoes (paciente_id, procedimento, realizada_em, coalesce(articulacao, ''))
  where deleted_at is null;
create index realizacoes_paciente_idx on realizacoes (paciente_id, realizada_em desc) where deleted_at is null;

alter table realizacoes enable row level security;
create policy realizacoes_ler on realizacoes for select to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id));
create policy realizacoes_criar on realizacoes for insert to authenticated
  with check (vejo_cliente(cliente_id));
revoke all on realizacoes from anon, authenticated;
grant select, insert on realizacoes to authenticated;
create trigger realizacoes_auditoria after insert or update or delete on realizacoes
  for each row execute function auditar();

-- ── o que a terapia sabe das realizações ────────────────────────────────
alter table terapias
  add column ultima_realizacao_em date,
  -- indicação bilateral com um lado só feito
  add column lado_pendente boolean not null default false;
grant update (ultima_realizacao_em, lado_pendente) on terapias to authenticated;

alter table importacoes
  add column tipo text not null default 'indicacoes' check (tipo in ('indicacoes', 'realizados')),
  -- números da importação de realizados (encontrados, cirurgias concluídas…)
  add column resumo jsonb;
grant update (resumo) on importacoes to authenticated;

-- Família do procedimento de uma terapia, para casar com a realização
-- ("ATQ/MAKO" → ATQ, "Hidrogel/Hymovis" → Hidrogel, "AH" → AH).
create or replace function familia_procedimento(p text) returns text
language sql immutable set search_path = public as $$
  select case
    when p ~* '\m(atq|mako)\M' or p ~* 'pr[oó]tese.*quadril|artroplastia.*quadril' then 'ATQ'
    when p ~* '\matj\M' or p ~* 'pr[oó]tese.*joelho|artroplastia.*joelho' then 'ATJ'
    when p ~* '\mvaq\M' or p ~* 'artroscop|v[ií]deo' then 'VAQ'
    when p ~* 'hidrogel|hymovis' then 'Hidrogel'
    when p ~* '\mbmac\M' then 'BMAC'
    when p ~* '\mprp\M' then 'PRP'
    when p ~* '\mah\M|hialur|visco' then 'AH'
    else null
  end
$$;
revoke execute on function familia_procedimento(text) from public, anon;
grant execute on function familia_procedimento(text) to authenticated;

-- ── importação da lista de realizados ───────────────────────────────────
-- Linhas (lidas e validadas no servidor da DashMed):
--   {linha, paciente, chave_nome, data 'AAAA-MM-DD', procedimento (família),
--    descricao, lado, articulacao}
-- p_simular = true: faz tudo, devolve os números e desfaz (prévia na tela).
-- security invoker: roda com a RLS de quem importa.
create or replace function importar_realizados(
  p_cliente uuid, p_arquivo text, p_linhas jsonb, p_erros jsonb default '[]',
  p_meses_ah int default 6, p_simular boolean default false
) returns jsonb
language plpgsql security invoker set search_path = public as $$
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
         and (chave_importacao = l->>'chave_nome' or chave_importacao like (l->>'chave_nome') || '|%');
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
       where paciente_id = v_pac and deleted_at is null and familia_procedimento(procedimento) = l->>'procedimento'
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
       where tr.paciente_id = any (v_pac_achados) and tr.deleted_at is null
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
     where tr.paciente_id = any (v_pac_achados) and tr.deleted_at is null and tr.situacao = 'a_chamar'
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
