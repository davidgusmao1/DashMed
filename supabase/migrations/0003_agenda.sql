-- DashMed — Agenda de renovação de terapias (David, 10/11/26: "precisamos criar
-- um menu na esquerda que vamos chamar de agenda onde todos os pacientes que
-- precisam renovar suas terapias precisam ser chamados").
--
-- Combinado com o David em 10/11/26:
-- - os dados vêm da planilha de indicações que ele já usa: uma linha por
--   consulta em que um procedimento foi indicado (AH, Hidrogel, Prótese/ATQ);
-- - o vencimento é uma data. Na importação sai do prazo que ele digita para
--   cada procedimento; depois pode ser mudado à mão em cada terapia;
-- - linhas marcadas "(incerto)" ou "(histórico)" entram para revisão e só vão
--   para a chamada depois que alguém confirmar;
-- - o telefone é digitado na DashMed (a planilha não tem);
-- - o trecho da evolução fica guardado como nota da indicação;
-- - a chamada em si vai ser feita pelo sistema do parceiro Prospekt (a API vem
--   depois); por enquanto a Agenda mostra quem chamar e guarda a situação.
--
-- Modelo: TERAPIA = um paciente + um procedimento (o "AH do paciente X"), que
-- vence e é renovada. Cada linha da planilha vira uma INDICAÇÃO dessa terapia,
-- para o paciente que aparece em agosto e em outubro não ser chamado duas vezes.
--
-- Dado de saúde (LGPD, dado sensível): só lê quem é do cliente (RLS), toda
-- mudança fica na AUDITORIA, e nada se apaga (deleted_at).

-- ── pacientes ───────────────────────────────────────────────────────────
create table pacientes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  nome text not null check (btrim(nome) <> ''),
  telefone text,
  observacoes text,
  -- Nome normalizado de quem veio de planilha. A planilha não tem CPF nem id,
  -- então a reimportação só não duplica o paciente se o nome bater. Quem é
  -- cadastrado à mão fica sem chave, porque homônimos existem.
  chave_importacao text,
  criado_em timestamptz not null default now(),
  criado_por uuid references usuarios(id) default auth.uid(),
  atualizado_em timestamptz not null default now(),
  deleted_at timestamptz,
  -- alvo das chaves estrangeiras compostas: terapia e paciente sempre do mesmo cliente
  unique (id, cliente_id)
);
create index pacientes_cliente_idx on pacientes (cliente_id) where deleted_at is null;
create unique index pacientes_chave_importacao_unica on pacientes (cliente_id, chave_importacao)
  where deleted_at is null and chave_importacao is not null;

-- ── importações ─────────────────────────────────────────────────────────
-- Cada importação deixa o registro do que entrou, do que já existia e do que
-- deu erro: o resultado aparece na tela e fica guardado (falha silenciosa é
-- bug duplo).
create table importacoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  arquivo text not null,
  -- meses até o vencimento, por procedimento: {"AH": 6, "Hidrogel": 12}
  prazos jsonb not null default '{}',
  linhas int not null,
  pacientes_novos int not null default 0,
  terapias_novas int not null default 0,
  indicacoes_novas int not null default 0,
  ja_existiam int not null default 0,
  para_revisar int not null default 0,
  com_erro int not null default 0,
  -- [{linha, motivo}] — sem nome de paciente: o motivo basta para corrigir
  erros jsonb not null default '[]',
  feita_em timestamptz not null default now(),
  feita_por uuid references usuarios(id) default auth.uid(),
  concluida_em timestamptz
);
create index importacoes_cliente_idx on importacoes (cliente_id, feita_em desc);

-- ── terapias ────────────────────────────────────────────────────────────
create table terapias (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  paciente_id uuid not null,
  procedimento text not null check (btrim(procedimento) <> ''),
  ultima_indicacao_em date,
  vence_em date,
  -- true quando o vencimento foi digitado por alguém (na tela ou numa coluna
  -- de vencimento da planilha): a importação não recalcula por cima dele.
  -- Humano ganha do robô.
  vence_em_manual boolean not null default false,
  -- indicação incerta ou só histórica: não entra na lista de chamada até
  -- alguém confirmar
  revisar boolean not null default false,
  revisar_motivo text,
  -- a_chamar: precisa ser chamado quando vencer; agendado: o paciente já
  -- marcou; nao_renovar: não vai renovar (sai da lista)
  situacao text not null default 'a_chamar' check (situacao in ('a_chamar', 'agendado', 'nao_renovar')),
  situacao_em timestamptz not null default now(),
  situacao_por uuid references usuarios(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  criado_por uuid references usuarios(id) default auth.uid(),
  atualizado_em timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (paciente_id, cliente_id) references pacientes (id, cliente_id),
  unique (id, cliente_id)
);
create index terapias_cliente_vence_idx on terapias (cliente_id, vence_em) where deleted_at is null;
-- Só uma terapia por paciente e procedimento: cada nova consulta vira
-- indicação dela, e o paciente não aparece duas vezes na chamada.
create unique index terapias_paciente_procedimento_unica on terapias (paciente_id, lower(procedimento))
  where deleted_at is null;

-- ── indicações ──────────────────────────────────────────────────────────
create table indicacoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  terapia_id uuid not null,
  indicada_em date not null,
  horario text,
  tipo_atendimento text,
  -- como estava na planilha, ex. "AH (incerto)"
  procedimento_original text,
  -- trecho da evolução (prontuário): contexto para quem vai chamar
  nota text,
  importacao_id uuid references importacoes(id),
  criado_em timestamptz not null default now(),
  criado_por uuid references usuarios(id) default auth.uid(),
  deleted_at timestamptz,
  foreign key (terapia_id, cliente_id) references terapias (id, cliente_id)
);
-- a mesma consulta reimportada não vira indicação repetida
create unique index indicacoes_unica on indicacoes (terapia_id, indicada_em) where deleted_at is null;

-- ── auditoria (LGPD) ────────────────────────────────────────────────────
-- Quem criou ou mudou dado de paciente, quando e o que mudou. Gravada por
-- gatilho, então nenhuma tela consegue esquecer de registrar.
create table auditoria (
  id bigint generated always as identity primary key,
  cliente_id uuid not null references clientes(id),
  tabela text not null,
  registro_id uuid not null,
  acao text not null check (acao in ('insert', 'update', 'delete')),
  usuario_id uuid default auth.uid(),
  em timestamptz not null default now(),
  -- campos que mudaram (update) e o valor que tinham antes
  campos text[],
  antes jsonb
);
create index auditoria_registro_idx on auditoria (tabela, registro_id);
create index auditoria_cliente_idx on auditoria (cliente_id, em desc);

create or replace function auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_campos text[];
  v_antes jsonb;
begin
  if tg_op = 'INSERT' then
    insert into auditoria (cliente_id, tabela, registro_id, acao, usuario_id)
    values (new.cliente_id, tg_table_name, new.id, 'insert', auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key), jsonb_object_agg(n.key, o.value)
      into v_campos, v_antes
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o on o.key = n.key
     where n.value is distinct from o.value
       and n.key not in ('atualizado_em', 'situacao_em');
    if v_campos is null then
      return new;
    end if;
    insert into auditoria (cliente_id, tabela, registro_id, acao, usuario_id, campos, antes)
    values (new.cliente_id, tg_table_name, new.id, 'update', auth.uid(), v_campos, v_antes);
    return new;
  else
    insert into auditoria (cliente_id, tabela, registro_id, acao, usuario_id, antes)
    values (old.cliente_id, tg_table_name, old.id, 'delete', auth.uid(), to_jsonb(old));
    return old;
  end if;
end $$;
revoke execute on function auditar() from public, anon, authenticated;

-- atualizado_em sempre verdadeiro (tocar_atualizado_em vem da 0002), e a
-- situação diz quem mudou e quando: o que a tela mostra vem do banco, não do
-- que o navegador mandou
create or replace function terapias_ao_mudar() returns trigger
language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  if new.situacao is distinct from old.situacao then
    new.situacao_em := now();
    new.situacao_por := auth.uid();
  end if;
  return new;
end $$;
revoke execute on function terapias_ao_mudar() from public, anon, authenticated;

create trigger pacientes_atualizado before update on pacientes for each row execute function tocar_atualizado_em();
create trigger terapias_atualizado before update on terapias for each row execute function terapias_ao_mudar();
create trigger pacientes_auditoria after insert or update or delete on pacientes for each row execute function auditar();
create trigger terapias_auditoria after insert or update or delete on terapias for each row execute function auditar();
create trigger indicacoes_auditoria after insert or update or delete on indicacoes for each row execute function auditar();

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Leitura e escrita só no cliente que a pessoa enxerga. Não há política de
-- delete: dado de paciente sai por deleted_at.
alter table pacientes enable row level security;
create policy pacientes_ler on pacientes for select to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id));
create policy pacientes_criar on pacientes for insert to authenticated
  with check (vejo_cliente(cliente_id));
create policy pacientes_mudar on pacientes for update to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id)) with check (vejo_cliente(cliente_id));

alter table terapias enable row level security;
create policy terapias_ler on terapias for select to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id));
create policy terapias_criar on terapias for insert to authenticated
  with check (vejo_cliente(cliente_id));
create policy terapias_mudar on terapias for update to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id)) with check (vejo_cliente(cliente_id));

alter table indicacoes enable row level security;
create policy indicacoes_ler on indicacoes for select to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id));
create policy indicacoes_criar on indicacoes for insert to authenticated
  with check (vejo_cliente(cliente_id));
create policy indicacoes_mudar on indicacoes for update to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id)) with check (vejo_cliente(cliente_id));

alter table importacoes enable row level security;
create policy importacoes_ler on importacoes for select to authenticated
  using (vejo_cliente(cliente_id));
create policy importacoes_criar on importacoes for insert to authenticated
  with check (vejo_cliente(cliente_id));
create policy importacoes_mudar on importacoes for update to authenticated
  using (vejo_cliente(cliente_id)) with check (vejo_cliente(cliente_id));

-- auditoria: só a plataforma e o admin daquele cliente leem
-- (administro_cliente vem da 0002)
alter table auditoria enable row level security;
create policy auditoria_ler on auditoria for select to authenticated
  using (administro_cliente(cliente_id));

-- Permissões por coluna: ninguém troca o cliente_id, o paciente de uma
-- terapia nem os carimbos de quem criou; isso só o banco escreve.
revoke all on pacientes, terapias, indicacoes, importacoes, auditoria from anon, authenticated;
grant select, insert on pacientes, terapias, indicacoes, importacoes to authenticated;
grant select on auditoria to authenticated;
grant update (nome, telefone, observacoes, chave_importacao, deleted_at) on pacientes to authenticated;
grant update (ultima_indicacao_em, vence_em, vence_em_manual, revisar, revisar_motivo, situacao, deleted_at) on terapias to authenticated;
grant update (nota, deleted_at) on indicacoes to authenticated;
grant update (pacientes_novos, terapias_novas, indicacoes_novas, ja_existiam, para_revisar, com_erro, erros, concluida_em) on importacoes to authenticated;

-- ── importação da planilha ──────────────────────────────────────────────
-- Uma chamada só, numa transação: ou entra a planilha inteira ou nada (sem
-- importação pela metade). security invoker: roda com a RLS de quem importa.
-- Linhas (já lidas e validadas no servidor da DashMed), em ordem de data:
--   {linha, paciente, chave, data 'AAAA-MM-DD', horario, tipo, procedimento,
--    marca, original, nota, telefone, vencimento 'AAAA-MM-DD'|null}
-- Erros de leitura (linha sem nome, data inválida) chegam em p_erros e ficam
-- registrados na importação.
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
  v_prazo int;
  v_n int;
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
    v_prazo := (p_prazos->>(l->>'procedimento'))::int;
    if v_venc is null and v_prazo is null then
      raise exception 'Falta o prazo de vencimento de "%".', l->>'procedimento' using errcode = '22023';
    end if;

    -- paciente: pela chave do nome; cria se não existe
    select id into v_pac from pacientes
     where cliente_id = p_cliente and chave_importacao = l->>'chave' and deleted_at is null;
    if v_pac is null then
      insert into pacientes (cliente_id, nome, telefone, chave_importacao)
      values (p_cliente, l->>'paciente', nullif(l->>'telefone', ''), l->>'chave')
      returning id into v_pac;
      c_pac := c_pac + 1;
    elsif nullif(l->>'telefone', '') is not null then
      -- telefone da planilha só preenche o que está vazio (não troca o digitado)
      update pacientes set telefone = l->>'telefone' where id = v_pac and telefone is null;
    end if;

    -- terapia: uma por paciente e procedimento
    select * into v_ter from terapias
     where paciente_id = v_pac and lower(procedimento) = lower(l->>'procedimento') and deleted_at is null;
    if v_ter.id is null then
      insert into terapias (cliente_id, paciente_id, procedimento, ultima_indicacao_em, vence_em,
                            vence_em_manual, revisar, revisar_motivo)
      values (p_cliente, v_pac, l->>'procedimento', v_data,
              coalesce(v_venc, (v_data + make_interval(months => v_prazo))::date),
              v_venc is not null, l->>'marca' is not null, l->>'marca')
      returning * into v_ter;
      c_ter := c_ter + 1;
      if v_ter.revisar then
        c_rev := c_rev + 1;
      end if;
    end if;

    -- indicação: a mesma consulta reimportada não se repete
    insert into indicacoes (cliente_id, terapia_id, indicada_em, horario, tipo_atendimento,
                            procedimento_original, nota, importacao_id)
    values (p_cliente, v_ter.id, v_data, nullif(l->>'horario', ''), nullif(l->>'tipo', ''),
            nullif(l->>'original', ''), nullif(l->>'nota', ''), v_imp)
    on conflict (terapia_id, indicada_em) where deleted_at is null do nothing;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      c_dup := c_dup + 1;
    elsif v_data > v_ter.ultima_indicacao_em then
      -- consulta mais nova: a terapia passa a contar dela, salvo vencimento
      -- digitado à mão; indicação certa confirma uma terapia em revisão
      update terapias set
        ultima_indicacao_em = v_data,
        vence_em = case
          when v_venc is not null then v_venc
          when vence_em_manual then vence_em
          else (v_data + make_interval(months => v_prazo))::date end,
        vence_em_manual = vence_em_manual or v_venc is not null,
        revisar = case when l->>'marca' is null then false else revisar end,
        revisar_motivo = case when l->>'marca' is null then null else revisar_motivo end
      where id = v_ter.id;
    end if;
    if v_n = 1 then
      c_ind := c_ind + 1;
    end if;
    v_ter := null;
    v_pac := null;
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
