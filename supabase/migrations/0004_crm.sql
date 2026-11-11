-- DashMed — CRM de resgate em Kanban (David, 11/11/26: "Use essa nova lista
-- para organizar um CRM estilo kanban para que minhas secretárias entrem em
-- contato com os pacientes que ainda não fizeram cirurgias. As secretárias irão
-- ligar para resgatar pacientes que tiveram um tratamento indicado e não
-- realizaram.").
--
-- O cartão do Kanban é a TERAPIA da Agenda (paciente + procedimento). O que
-- muda:
-- - a situação vira uma etapa de funil: a_chamar ("A contatar"), tentativa,
--   em_conversa, agendado, realizado, nao_renovar ("Não vai fazer");
-- - cada ligação fica registrada em CONTATOS (resultado + nota), e a terapia
--   guarda o resumo (quantas, a última, o resultado) — escrito só pelo banco;
-- - retornar_em: o dia combinado para ligar de novo; responsavel_id: a
--   secretária que cuida do cartão;
-- - a lista nova (indicacoes-2025-apolo.xlsx, extraída do Apolo Ninsaúde) traz
--   telefones, e-mail, data de nascimento, impressos e observação: guardamos o
--   que ajuda a ligar e a distinguir homônimos (não guardamos endereço).
-- Ainda não há paciente no banco (11/11/26), então as etapas mudam sem migrar dado.

-- ── etapas ──────────────────────────────────────────────────────────────
alter table terapias drop constraint terapias_situacao_check;
alter table terapias add constraint terapias_situacao_check
  check (situacao in ('a_chamar', 'tentativa', 'em_conversa', 'agendado', 'realizado', 'nao_renovar'));

alter table terapias
  add column retornar_em date,
  add column responsavel_id uuid references usuarios(id),
  -- resumo das ligações, escrito pelo gatilho de contatos (fonte: contatos)
  add column contatos_qtd int not null default 0,
  add column ultimo_contato_em timestamptz,
  add column ultimo_resultado text;
create index terapias_cliente_situacao_idx on terapias (cliente_id, situacao) where deleted_at is null;

alter table pacientes
  add column email text,
  add column nascimento date,
  -- todos os números como vieram ("cel 11987654321 · res 1133334444"); o
  -- principal (primeiro celular) fica em telefone
  add column telefones text;

alter table indicacoes
  add column impressos text,
  add column observacao text;

grant update (email, nascimento, telefones) on pacientes to authenticated;
grant update (retornar_em, responsavel_id) on terapias to authenticated;

-- ── ligações ────────────────────────────────────────────────────────────
-- Registro de cada tentativa de contato. É histórico: não se edita nem se
-- apaga pela tela.
create table contatos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  terapia_id uuid not null,
  feito_em timestamptz not null default now(),
  feito_por uuid references usuarios(id) default auth.uid(),
  resultado text not null check (resultado in (
    'nao_atendeu', 'caixa_postal', 'numero_invalido', 'falou', 'pediu_retorno', 'agendou', 'ja_realizou', 'nao_quer')),
  nota text,
  deleted_at timestamptz,
  foreign key (terapia_id, cliente_id) references terapias (id, cliente_id)
);
create index contatos_terapia_idx on contatos (terapia_id, feito_em desc) where deleted_at is null;

alter table contatos enable row level security;
create policy contatos_ler on contatos for select to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id));
create policy contatos_criar on contatos for insert to authenticated
  with check (vejo_cliente(cliente_id));
revoke all on contatos from anon, authenticated;
grant select, insert on contatos to authenticated;

create trigger contatos_auditoria after insert or update or delete on contatos
  for each row execute function auditar();

-- o resumo na terapia vem do registro, nunca do navegador
create or replace function contatos_resumir() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update terapias set
    contatos_qtd = contatos_qtd + 1,
    ultimo_contato_em = greatest(coalesce(ultimo_contato_em, new.feito_em), new.feito_em),
    ultimo_resultado = new.resultado
  where id = new.terapia_id;
  return new;
end $$;
revoke execute on function contatos_resumir() from public, anon, authenticated;
create trigger contatos_resumo after insert on contatos for each row execute function contatos_resumir();

-- Registrar a ligação e mover o cartão numa transação só. security invoker:
-- vale a RLS de quem ligou.
create or replace function registrar_contato(
  p_terapia uuid, p_resultado text, p_nota text, p_etapa text, p_retornar_em date
) returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_cliente uuid;
  v_n int;
begin
  select cliente_id into v_cliente from terapias where id = p_terapia and deleted_at is null;
  if v_cliente is null then
    raise exception 'Terapia não encontrada ou sem acesso.' using errcode = '42501';
  end if;
  insert into contatos (cliente_id, terapia_id, resultado, nota)
  values (v_cliente, p_terapia, p_resultado, nullif(btrim(p_nota), ''));
  update terapias set
    situacao = coalesce(p_etapa, situacao),
    retornar_em = p_retornar_em
  where id = p_terapia;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Não consegui mover o cartão (sem acesso).' using errcode = '42501';
  end if;
end $$;
revoke execute on function registrar_contato(uuid, text, text, text, date) from public, anon;
grant execute on function registrar_contato(uuid, text, text, text, date) to authenticated;

-- Contagem por procedimento e etapa para o quadro (filtros e totais das
-- colunas) sem esbarrar no teto de 1.000 linhas do PostgREST.
create or replace function resumo_crm(p_cliente uuid)
returns table (procedimento text, situacao text, n bigint)
language sql stable security invoker set search_path = public as $$
  select procedimento, situacao, count(*) from terapias
   where cliente_id = p_cliente and deleted_at is null
   group by 1, 2
$$;
revoke execute on function resumo_crm(uuid) from public, anon;
grant execute on function resumo_crm(uuid) to authenticated;

-- ── importação, versão 2 ────────────────────────────────────────────────
-- Igual à da 0003, mais:
-- - paciente: chave com a data de nascimento quando a planilha tem ("nome|AAAA-MM-DD"),
--   para separar homônimos; quem veio antes só pelo nome é reaproveitado e
--   ganha a data; planilha só com nome reaproveita o único paciente com esse
--   nome. E-mail, nascimento e telefones só preenchem o que está vazio.
-- - indicação: impressos e observação.
-- - realizado: true (ex.: "AH aplicado no dia") cria a terapia já como
--   "realizado" — não é para resgatar.
-- - prazo é opcional: sem prazo e sem vencimento, a terapia fica sem
--   vencimento (cirurgia não "vence"; o resgate é pelo CRM). Uma terapia sem
--   vencimento ganha a data quando uma importação seguinte trouxer o prazo.
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
    -- terapia sem vencimento ganha a data quando o prazo aparecer, inclusive
    -- reimportando a mesma planilha com o prazo preenchido
    if v_prazo is not null then
      update terapias set vence_em = (ultima_indicacao_em + make_interval(months => v_prazo))::date
       where id = v_ter.id and vence_em is null and not vence_em_manual;
    end if;
  end loop;

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
