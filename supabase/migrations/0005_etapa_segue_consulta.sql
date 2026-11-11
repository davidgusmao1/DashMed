-- DashMed — a etapa que veio da planilha acompanha a consulta mais recente
-- (11/11/26). Na primeira importação da lista do Apolo (indicacoes-2025-apolo.xlsx),
-- 34 pacientes tiveram o AH indicado numa consulta e aplicado numa consulta
-- seguinte, mas ficaram em "A contatar": a importação só olhava a primeira
-- consulta, e as secretárias iam ligar para quem já fez o tratamento.
--
-- Agora, enquanto ninguém mexeu no cartão (nenhuma ligação registrada e
-- nenhuma mudança de etapa feita por uma pessoa), a etapa segue a consulta
-- mais nova: aplicado no dia → Realizado; indicado de novo sem aplicar → A
-- contatar. Depois que uma pessoa mexe, a importação não muda mais a etapa
-- (humano ganha do robô). Reimportar a mesma planilha acerta os 34.

-- true enquanto a etapa foi posta pela importação; qualquer mudança feita
-- por uma pessoa (arrastar, registrar ligação, botão na ficha) vira false
alter table terapias add column situacao_auto boolean not null default true;

create or replace function terapias_ao_mudar() returns trigger
language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  if new.situacao is distinct from old.situacao then
    new.situacao_em := now();
    new.situacao_por := auth.uid();
    new.situacao_auto := coalesce(current_setting('dashmed.importando', true), '') = 'sim';
  end if;
  return new;
end $$;
revoke execute on function terapias_ao_mudar() from public, anon, authenticated;

-- importação v3: igual à da 0004, mais a etapa que segue a consulta mais nova
create or replace function importar_planilha(
  p_cliente uuid, p_arquivo text, p_prazos jsonb, p_linhas jsonb, p_erros jsonb default '[]'
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  l jsonb;
  v_imp uuid;
  v_pac uuid;
  v_ter terapias%rowtype;
  v_data date;
  v_venc date;
  v_nasc date;
  v_prazo int;
  v_calc date;
  v_n int;
  v_qtd int;
  c_pac int := 0;
  c_ter int := 0;
  c_ind int := 0;
  c_dup int := 0;
  c_rev int := 0;
begin
  if not vejo_cliente(p_cliente) then
    raise exception 'Você não tem acesso a este cliente.' using errcode = '42501';
  end if;
  -- o gatilho de terapias entende como automática a mudança de etapa feita aqui
  perform set_config('dashmed.importando', 'sim', true);

  insert into importacoes (cliente_id, arquivo, prazos, linhas, com_erro, erros)
  values (p_cliente, p_arquivo, p_prazos, jsonb_array_length(p_linhas) + jsonb_array_length(p_erros),
          jsonb_array_length(p_erros), p_erros)
  returning id into v_imp;

  for l in select value from jsonb_array_elements(p_linhas) loop
    v_data := (l->>'data')::date;
    v_venc := nullif(l->>'vencimento', '')::date;
    v_nasc := nullif(l->>'nascimento', '')::date;
    v_prazo := (p_prazos->>(l->>'procedimento'))::int;
    v_calc := case when v_prazo is null then null else (v_data + make_interval(months => v_prazo))::date end;

    -- paciente: pela chave (nome + nascimento); senão, quem veio só pelo nome
    v_pac := null;
    select id into v_pac from pacientes
     where cliente_id = p_cliente and chave_importacao = l->>'chave' and deleted_at is null;
    if v_pac is null and v_nasc is not null then
      select id into v_pac from pacientes
       where cliente_id = p_cliente and chave_importacao = l->>'chave_nome' and nascimento is null and deleted_at is null;
      if v_pac is not null then
        update pacientes set chave_importacao = l->>'chave', nascimento = v_nasc where id = v_pac;
      end if;
    end if;
    if v_pac is null and v_nasc is null and l->>'chave_nome' is not null then
      -- planilha só com nome depois de uma com nascimento: reaproveita se
      -- houver UM paciente com esse nome (homônimos: cria outro, não chuta)
      select min(id::text)::uuid, count(*) into v_pac, v_qtd from pacientes
       where cliente_id = p_cliente and deleted_at is null and chave_importacao like (l->>'chave_nome') || '|%';
      if v_qtd <> 1 then
        v_pac := null;
      end if;
    end if;
    if v_pac is null then
      insert into pacientes (cliente_id, nome, telefone, telefones, email, nascimento, chave_importacao)
      values (p_cliente, l->>'paciente', nullif(l->>'telefone', ''), nullif(l->>'telefones', ''),
              nullif(l->>'email', ''), v_nasc, l->>'chave')
      returning id into v_pac;
      c_pac := c_pac + 1;
    else
      -- dado da planilha só preenche o que está vazio (não troca o digitado)
      update pacientes set
        telefone = coalesce(telefone, nullif(l->>'telefone', '')),
        telefones = coalesce(telefones, nullif(l->>'telefones', '')),
        email = coalesce(email, nullif(l->>'email', '')),
        nascimento = coalesce(nascimento, v_nasc)
      where id = v_pac
        and ((telefone is null and nullif(l->>'telefone', '') is not null)
          or (telefones is null and nullif(l->>'telefones', '') is not null)
          or (email is null and nullif(l->>'email', '') is not null)
          or (nascimento is null and v_nasc is not null));
    end if;

    -- terapia: uma por paciente e procedimento
    v_ter := null;
    select * into v_ter from terapias
     where paciente_id = v_pac and lower(procedimento) = lower(l->>'procedimento') and deleted_at is null;
    if v_ter.id is null then
      insert into terapias (cliente_id, paciente_id, procedimento, ultima_indicacao_em, vence_em,
                            vence_em_manual, revisar, revisar_motivo, situacao)
      values (p_cliente, v_pac, l->>'procedimento', v_data, coalesce(v_venc, v_calc),
              v_venc is not null, l->>'marca' is not null, l->>'marca',
              case when (l->>'realizado')::boolean then 'realizado' else 'a_chamar' end)
      returning * into v_ter;
      c_ter := c_ter + 1;
      if v_ter.revisar then
        c_rev := c_rev + 1;
      end if;
    end if;

    insert into indicacoes (cliente_id, terapia_id, indicada_em, horario, tipo_atendimento,
                            procedimento_original, nota, impressos, observacao, importacao_id)
    values (p_cliente, v_ter.id, v_data, nullif(l->>'horario', ''), nullif(l->>'tipo', ''),
            nullif(l->>'original', ''), nullif(l->>'nota', ''), nullif(l->>'impressos', ''),
            nullif(l->>'observacao', ''), v_imp)
    on conflict (terapia_id, indicada_em) where deleted_at is null do nothing;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      c_dup := c_dup + 1;
    else
      c_ind := c_ind + 1;
      if v_data > v_ter.ultima_indicacao_em then
        -- consulta mais nova: a terapia passa a contar dela, salvo vencimento
        -- digitado à mão; indicação certa confirma uma terapia em revisão
        update terapias set
          ultima_indicacao_em = v_data,
          vence_em = case
            when v_venc is not null then v_venc
            when vence_em_manual then vence_em
            else coalesce(v_calc, vence_em) end,
          vence_em_manual = vence_em_manual or v_venc is not null,
          revisar = case when l->>'marca' is null then false else revisar end,
          revisar_motivo = case when l->>'marca' is null then null else revisar_motivo end
        where id = v_ter.id;
      end if;
    end if;
    -- a etapa automática segue a consulta mais nova enquanto ninguém mexeu no
    -- cartão: aplicado no dia → realizado; indicado sem aplicar → a contatar
    update terapias set situacao = case when (l->>'realizado')::boolean then 'realizado' else 'a_chamar' end
     where id = v_ter.id and situacao_auto and contatos_qtd = 0
       and v_data >= ultima_indicacao_em
       and situacao <> case when (l->>'realizado')::boolean then 'realizado' else 'a_chamar' end;
    -- terapia sem vencimento ganha a data quando o prazo aparecer, inclusive
    -- reimportando a mesma planilha com o prazo preenchido
    if v_prazo is not null then
      update terapias set vence_em = (ultima_indicacao_em + make_interval(months => v_prazo))::date
       where id = v_ter.id and vence_em is null and not vence_em_manual;
    end if;
  end loop;

  perform set_config('dashmed.importando', '', true);

  update importacoes set
    pacientes_novos = c_pac, terapias_novas = c_ter, indicacoes_novas = c_ind,
    ja_existiam = c_dup, para_revisar = c_rev, concluida_em = now()
  where id = v_imp;

  return jsonb_build_object(
    'importacao_id', v_imp, 'pacientes_novos', c_pac, 'terapias_novas', c_ter,
    'indicacoes_novas', c_ind, 'ja_existiam', c_dup, 'para_revisar', c_rev,
    'com_erro', jsonb_array_length(p_erros));
end $$;
revoke execute on function importar_planilha(uuid, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function importar_planilha(uuid, text, jsonb, jsonb, jsonb) to authenticated;
