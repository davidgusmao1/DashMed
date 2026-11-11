-- DashMed — Conteúdos para mídias sociais (David, 10/11/26: "no menu da
-- esquerda criarmos um item que vai chamar conteúdos para mídias sociais ...
-- seleciono um assunto, dps peço para a AI buscar referências na internet em
-- publicações médicas, uma vez depurado o assunto elaboramos um roteiro para
-- vídeo em torno de 15 minutos ... o vídeo deve seguir a imagem, ou seja eu").
--
-- Fluxo: CONTEÚDO (assunto) → REFERÊNCIAS (Europe PMC/PubMed, triadas pela IA,
-- escolhidas pelo médico) → ROTEIRO (blocos de fala, ~15 min) → VÍDEO (avatar
-- do próprio médico na HeyGen).
--
-- As chaves de API de cada cliente ficam no Vault do Supabase (cifradas). A
-- tela só enxerga que a chave existe e os 4 últimos caracteres; quem lê o
-- valor são as edge functions, com a chave de serviço.
--
-- Quem escreve o quê:
--   - o médico (sessão, pela RLS): cria/arquiva conteúdo, marca referências,
--     edita o texto dos blocos, preenche o perfil;
--   - as edge functions (chave de serviço): estado da pesquisa, referências,
--     roteiros, blocos gerados, vídeos e integrações.

-- ── atualizado_em em toda escrita ───────────────────────────────────────
create or replace function tocar_atualizado_em() returns trigger
language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

-- ── quem administra o cliente (plataforma ou admin do próprio cliente) ──
create or replace function administro_cliente(p_cliente uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_cliente is not null and (eu_plataforma() or exists (
    select 1 from usuarios
    where id = auth.uid() and ativo and deleted_at is null
      and cliente_id = p_cliente and papel = 'admin'))
$$;
revoke execute on function administro_cliente(uuid) from public, anon;
grant execute on function administro_cliente(uuid) to authenticated;

-- ── integrações: chaves de API por cliente ──────────────────────────────
-- Segredo se apaga de verdade (regra 6): esta tabela não tem deleted_at, e a
-- linha some junto com o segredo do Vault.
create table integracoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  provedor text not null check (provedor in ('anthropic', 'heygen')),
  -- 4 últimos caracteres, para o médico reconhecer qual chave está salva
  final text not null,
  -- configurações NÃO secretas (HeyGen: avatar, voz e motor escolhidos)
  parametros jsonb not null default '{}'::jsonb,
  teste_ok boolean,
  teste_msg text,
  testada_em timestamptz,
  atualizado_por uuid references usuarios(id),
  atualizado_em timestamptz not null default now(),
  criado_em timestamptz not null default now()
);
-- só uma chave por provedor em cada cliente (regra 1)
create unique index integracoes_unica on integracoes (cliente_id, provedor);
create trigger integracoes_atualizado before update on integracoes
  for each row execute function tocar_atualizado_em();
alter table integracoes enable row level security;
create policy integracoes_ler on integracoes for select to authenticated
  using (vejo_cliente(cliente_id));
revoke all on integracoes from anon;
revoke insert, update, delete on integracoes from authenticated;

-- O valor da chave mora no Vault, com nome previsível por cliente e provedor.
-- Só a chave de serviço (edge functions) executa estas funções.
create or replace function guardar_segredo(p_cliente uuid, p_provedor text, p_valor text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_nome text := 'dashmed:' || p_cliente::text || ':' || p_provedor;
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = v_nome;
  if v_id is null then
    perform vault.create_secret(p_valor, v_nome, 'Chave de integração da DashMed');
  else
    perform vault.update_secret(v_id, p_valor);
  end if;
end $$;

create or replace function ler_segredo(p_cliente uuid, p_provedor text) returns text
language sql stable security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'dashmed:' || p_cliente::text || ':' || p_provedor
$$;

create or replace function apagar_segredo(p_cliente uuid, p_provedor text) returns void
language sql security definer set search_path = public as $$
  delete from vault.secrets where name = 'dashmed:' || p_cliente::text || ':' || p_provedor
$$;

revoke execute on function guardar_segredo(uuid, text, text) from public, anon, authenticated;
revoke execute on function ler_segredo(uuid, text) from public, anon, authenticated;
revoke execute on function apagar_segredo(uuid, text) from public, anon, authenticated;
grant execute on function guardar_segredo(uuid, text, text) to service_role;
grant execute on function ler_segredo(uuid, text) to service_role;
grant execute on function apagar_segredo(uuid, text) to service_role;

-- ── perfil do médico para os roteiros ───────────────────────────────────
-- Nome, CRM e RQE entram na identificação que a Resolução CFM 2.336/2023
-- exige; público e tom guiam o texto. Uma linha por cliente.
create table perfis_conteudo (
  cliente_id uuid primary key references clientes(id),
  nome_exibicao text not null default '',
  especialidade text not null default '',
  crm text not null default '',
  rqe text not null default '',
  publico text not null default '',
  tom text not null default '',
  chamada_final text not null default '',
  atualizado_por uuid references usuarios(id) default auth.uid(),
  atualizado_em timestamptz not null default now()
);
create trigger perfis_conteudo_atualizado before update on perfis_conteudo
  for each row execute function tocar_atualizado_em();
alter table perfis_conteudo enable row level security;
create policy perfis_conteudo_ler on perfis_conteudo for select to authenticated
  using (vejo_cliente(cliente_id));
create policy perfis_conteudo_criar on perfis_conteudo for insert to authenticated
  with check (administro_cliente(cliente_id));
create policy perfis_conteudo_mudar on perfis_conteudo for update to authenticated
  using (administro_cliente(cliente_id)) with check (administro_cliente(cliente_id));
revoke all on perfis_conteudo from anon;
revoke delete on perfis_conteudo from authenticated;

-- ── conteúdos ───────────────────────────────────────────────────────────
create table conteudos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  assunto text not null check (length(btrim(assunto)) between 3 and 300),
  orientacoes text not null default '' check (length(orientacoes) <= 2000),
  -- pesquisa de referências (a edge conteudos-pesquisa escreve)
  pesquisa_estado text not null default 'nao_iniciada'
    check (pesquisa_estado in ('nao_iniciada', 'buscando', 'pronta', 'erro')),
  pesquisa_msg text,
  pesquisa_iniciada_em timestamptz,
  pesquisa_terminada_em timestamptz,
  -- as consultas usadas na Europe PMC, para o médico ver de onde veio
  consultas jsonb not null default '[]'::jsonb,
  -- o que a evidência mostra, escrito pela IA, citando PMIDs
  sintese text,
  criado_por uuid references usuarios(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  deleted_at timestamptz,
  -- para as tabelas filhas garantirem o mesmo cliente do conteúdo
  unique (id, cliente_id)
);
create index conteudos_cliente_idx on conteudos (cliente_id, criado_em desc) where deleted_at is null;
create trigger conteudos_atualizado before update on conteudos
  for each row execute function tocar_atualizado_em();
alter table conteudos enable row level security;
create policy conteudos_ler on conteudos for select to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id));
create policy conteudos_criar on conteudos for insert to authenticated
  with check (vejo_cliente(cliente_id));
create policy conteudos_mudar on conteudos for update to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id)) with check (vejo_cliente(cliente_id));
revoke all on conteudos from anon;
revoke insert, update, delete on conteudos from authenticated;
-- o médico só mexe no assunto e nas orientações; o resto é da edge
grant insert (cliente_id, assunto, orientacoes) on conteudos to authenticated;
grant update (assunto, orientacoes) on conteudos to authenticated;

-- Arquivar (soft delete). Função porque a linha arquivada deixa de passar na
-- política de leitura, e o Postgres recusaria o UPDATE feito pela sessão.
create or replace function arquivar_conteudo(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update conteudos set deleted_at = now()
  where id = p_id and deleted_at is null and vejo_cliente(cliente_id);
  if not found then
    raise exception 'Conteúdo não encontrado ou sem acesso.' using errcode = 'P0002';
  end if;
end $$;
revoke execute on function arquivar_conteudo(uuid) from public, anon;
grant execute on function arquivar_conteudo(uuid) to authenticated;

-- ── referências ─────────────────────────────────────────────────────────
-- Toda referência vem da Europe PMC com PMID (a IA não inventa artigo). A IA
-- sugere; quem decide o que entra no roteiro é o médico (regra 4).
create table referencias (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  conteudo_id uuid not null,
  pmid text not null,
  doi text,
  pmcid text,
  titulo text not null,
  autores text not null default '',
  revista text not null default '',
  ano int,
  tipos text[] not null default '{}',
  citacoes int not null default 0,
  acesso_aberto boolean not null default false,
  resumo text not null default '',
  relevancia int check (relevancia between 0 and 5),
  nota text,
  sugerida boolean not null default false,
  selecionada boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (conteudo_id, cliente_id) references conteudos (id, cliente_id)
);
-- o mesmo artigo uma vez só por conteúdo (regra 1): buscar de novo não duplica
-- e não desfaz a escolha do médico
create unique index referencias_unica on referencias (conteudo_id, pmid) where deleted_at is null;
create index referencias_conteudo_idx on referencias (conteudo_id) where deleted_at is null;
create trigger referencias_atualizado before update on referencias
  for each row execute function tocar_atualizado_em();
alter table referencias enable row level security;
create policy referencias_ler on referencias for select to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id));
create policy referencias_marcar on referencias for update to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id)) with check (vejo_cliente(cliente_id));
revoke all on referencias from anon;
revoke insert, update, delete on referencias from authenticated;
grant update (selecionada) on referencias to authenticated;

-- ── roteiros ────────────────────────────────────────────────────────────
create table roteiros (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  conteudo_id uuid not null,
  versao int not null check (versao > 0),
  -- estrutura: planejando os blocos; escrevendo: blocos sendo escritos
  estado text not null default 'estrutura'
    check (estado in ('estrutura', 'escrevendo', 'pronto', 'erro')),
  msg text,
  titulo text,
  -- {resumo, blocos: [{ordem, titulo, objetivo, minutos, pontos[], pmids[]}]}
  estrutura jsonb,
  -- referências usadas (PMIDs escolhidos pelo médico no momento da escrita)
  pmids text[] not null default '{}',
  criado_por uuid references usuarios(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (conteudo_id, cliente_id) references conteudos (id, cliente_id),
  unique (id, cliente_id)
);
create unique index roteiros_versao_unica on roteiros (conteudo_id, versao);
-- um roteiro sendo escrito por vez em cada conteúdo (regra 1)
create unique index roteiros_um_escrevendo on roteiros (conteudo_id)
  where estado in ('estrutura', 'escrevendo') and deleted_at is null;
create trigger roteiros_atualizado before update on roteiros
  for each row execute function tocar_atualizado_em();
alter table roteiros enable row level security;
create policy roteiros_ler on roteiros for select to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id));
revoke all on roteiros from anon;
revoke insert, update, delete on roteiros from authenticated;

create table roteiro_blocos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  roteiro_id uuid not null,
  ordem int not null check (ordem > 0),
  titulo text not null,
  -- o que o avatar fala (vai para a HeyGen)
  fala text not null,
  -- sugestões do que mostrar na tela (não é falado)
  na_tela text not null default '',
  -- o médico editou: a IA não sobrescreve sem ele pedir (regra 4)
  editado boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  foreign key (roteiro_id, cliente_id) references roteiros (id, cliente_id)
);
-- um bloco por posição (regra 1): dois trabalhadores no mesmo bloco, o
-- segundo é descartado
create unique index roteiro_blocos_ordem on roteiro_blocos (roteiro_id, ordem);
create trigger roteiro_blocos_atualizado before update on roteiro_blocos
  for each row execute function tocar_atualizado_em();
alter table roteiro_blocos enable row level security;
create policy roteiro_blocos_ler on roteiro_blocos for select to authenticated
  using (vejo_cliente(cliente_id));
create policy roteiro_blocos_editar on roteiro_blocos for update to authenticated
  using (vejo_cliente(cliente_id)) with check (vejo_cliente(cliente_id));
revoke all on roteiro_blocos from anon;
revoke insert, update, delete on roteiro_blocos from authenticated;
grant update (titulo, fala, na_tela, editado) on roteiro_blocos to authenticated;

-- ── vídeos ──────────────────────────────────────────────────────────────
create table videos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  roteiro_id uuid not null,
  provedor text not null default 'heygen' check (provedor in ('heygen')),
  provedor_video_id text,
  estado text not null default 'enviando'
    check (estado in ('enviando', 'processando', 'pronto', 'falhou')),
  msg text,
  formato text not null default '16:9' check (formato in ('16:9', '9:16')),
  motor text,
  avatar_nome text,
  voz_nome text,
  minutos_estimados numeric,
  duracao_seg numeric,
  -- token do retorno (webhook) da HeyGen; o retorno só "cutuca", e o estado
  -- é sempre conferido na API da HeyGen (regra 3)
  retorno_token text not null,
  criado_por uuid references usuarios(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (roteiro_id, cliente_id) references roteiros (id, cliente_id)
);
create unique index videos_provedor_unico on videos (provedor, provedor_video_id)
  where provedor_video_id is not null;
-- um vídeo em produção por roteiro e formato (regra 1): clique duplo não paga
-- duas vezes
create unique index videos_um_por_vez on videos (roteiro_id, formato)
  where estado in ('enviando', 'processando') and deleted_at is null;
create index videos_roteiro_idx on videos (roteiro_id) where deleted_at is null;
create trigger videos_atualizado before update on videos
  for each row execute function tocar_atualizado_em();
alter table videos enable row level security;
create policy videos_ler on videos for select to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id));
revoke all on videos from anon;
revoke insert, update, delete on videos from authenticated;

-- ── vigia (regra 5) ─────────────────────────────────────────────────────
-- Guarda as invariantes que não cabem no banco: nada fica "buscando",
-- "escrevendo" ou "enviando" para sempre. O que tem conserto inequívoco vira
-- erro com motivo claro na tela; o resto fica aberto como achado.
create table achados (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes(id),
  regra text not null,
  alvo_tabela text not null,
  alvo_id uuid not null,
  detalhe text not null,
  consertado boolean not null default false,
  aberto_em timestamptz not null default now(),
  fechado_em timestamptz
);
create unique index achados_um_aberto on achados (regra, alvo_id) where fechado_em is null;
alter table achados enable row level security;
create policy achados_ler on achados for select to authenticated using (eu_plataforma());
revoke all on achados from anon;
revoke insert, update, delete on achados from authenticated;

create or replace function vigiar() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- pesquisa: a edge roda no máximo 150 s (plano Free) / 400 s (pagos)
  with travadas as (
    update conteudos set pesquisa_estado = 'erro',
      pesquisa_msg = 'A busca passou de 5 minutos sem terminar e foi interrompida. Clique em "Buscar de novo".',
      pesquisa_terminada_em = now()
    where pesquisa_estado = 'buscando' and pesquisa_iniciada_em < now() - interval '5 minutes'
    returning id, cliente_id)
  insert into achados (cliente_id, regra, alvo_tabela, alvo_id, detalhe, consertado, fechado_em)
  select cliente_id, 'pesquisa_travada', 'conteudos', id, 'Busca de referências parada há mais de 5 minutos; marcada como erro.', true, now()
  from travadas;

  -- roteiro: cada passo leva no máximo alguns minutos
  with parados as (
    update roteiros set estado = 'erro',
      msg = 'A escrita parou no meio. Clique em "Continuar" para retomar de onde parou.'
    where estado in ('estrutura', 'escrevendo') and atualizado_em < now() - interval '15 minutes'
    returning id, cliente_id)
  insert into achados (cliente_id, regra, alvo_tabela, alvo_id, detalhe, consertado, fechado_em)
  select cliente_id, 'roteiro_parado', 'roteiros', id, 'Roteiro sem avanço há mais de 15 minutos; marcado como erro.', true, now()
  from parados;

  -- vídeo: o envio à HeyGen nunca confirmou. Não reenvia sozinho, para não
  -- pagar duas vezes: avisa e deixa o médico decidir.
  with perdidos as (
    update videos set estado = 'falhou',
      msg = 'O envio para a HeyGen não confirmou em 10 minutos. Confira na sua conta da HeyGen antes de gerar de novo, para não pagar duas vezes.'
    where estado = 'enviando' and atualizado_em < now() - interval '10 minutes'
    returning id, cliente_id)
  insert into achados (cliente_id, regra, alvo_tabela, alvo_id, detalhe, consertado, fechado_em)
  select cliente_id, 'video_envio_perdido', 'videos', id, 'Envio à HeyGen sem confirmação em 10 minutos; marcado como falhou.', true, now()
  from perdidos;

  -- vídeo processando há mais de 3 horas: a verdade está na HeyGen, então
  -- só abre o achado (fecha quando o vídeo sair de "processando")
  insert into achados (cliente_id, regra, alvo_tabela, alvo_id, detalhe)
  select v.cliente_id, 'video_demorado', 'videos', v.id, 'Vídeo em processamento na HeyGen há mais de 3 horas.'
  from videos v
  where v.estado = 'processando' and v.deleted_at is null and v.criado_em < now() - interval '3 hours'
  on conflict (regra, alvo_id) where fechado_em is null do nothing;

  update achados a set fechado_em = now()
  where a.regra = 'video_demorado' and a.fechado_em is null
    and not exists (select 1 from videos v where v.id = a.alvo_id and v.estado = 'processando' and v.deleted_at is null);
end $$;
revoke execute on function vigiar() from public, anon, authenticated;

-- o vigia roda a cada 10 minutos dentro do próprio banco (pg_cron)
create extension if not exists pg_cron;
select cron.schedule('dashmed-vigia', '*/10 * * * *', $$select public.vigiar()$$);
