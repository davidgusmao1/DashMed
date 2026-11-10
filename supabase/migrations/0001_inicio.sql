-- DashMed — início (Jorge, 10/11/26: "criar um dash como temos da prospekt e
-- motorcore para a dashmed multi clientes tudo em branco nesse primeiro
-- momento").
--
-- Multi-cliente desde o primeiro dia: cada CLIENTE é uma conta da plataforma
-- (o primeiro é o David Gusmão), e todo dado que vier depois leva cliente_id e
-- é lido pela RLS só por quem é daquele cliente. A equipe da PLATAFORMA vê
-- todos os clientes e escolhe em qual está trabalhando (cookie "cliente").
--
-- Dado de negócio não se apaga: deleted_at + filtro nas listagens.

-- ── clientes ────────────────────────────────────────────────────────────
create table clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_em timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index clientes_nome_unico on clientes (lower(nome)) where deleted_at is null;

-- ── usuários ────────────────────────────────────────────────────────────
-- A conta é do Supabase Auth (entrada pelo link no e-mail, sem senha); aqui
-- fica o nome, o cliente, o papel e se está ativo.
create table usuarios (
  id uuid primary key references auth.users(id),
  nome text not null,
  email text not null,
  -- o cliente de quem é da equipe dele; quem é só da plataforma pode não ter
  cliente_id uuid references clientes(id),
  papel text not null default 'membro' check (papel in ('admin', 'membro')),
  -- equipe da plataforma: vê e escolhe qualquer cliente
  plataforma boolean not null default false,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  deleted_at timestamptz,
  check (plataforma or cliente_id is not null)
);
create unique index usuarios_email_unico on usuarios (lower(email)) where deleted_at is null;
create index usuarios_cliente_idx on usuarios (cliente_id) where deleted_at is null;

-- Toda policy pergunta isto. security definer: a própria tabela de usuários
-- também tem RLS, e a pergunta não pode depender dela.
create or replace function eu_plataforma() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios where id = auth.uid() and ativo and deleted_at is null and plataforma)
$$;
create or replace function meu_cliente() returns uuid
language sql stable security definer set search_path = public as $$
  select cliente_id from usuarios where id = auth.uid() and ativo and deleted_at is null
$$;
-- quem está logado enxerga este cliente?
create or replace function vejo_cliente(p_cliente uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_cliente is not null and (eu_plataforma() or p_cliente = meu_cliente())
$$;
revoke execute on function eu_plataforma() from public, anon;
revoke execute on function meu_cliente() from public, anon;
revoke execute on function vejo_cliente(uuid) from public, anon;
grant execute on function eu_plataforma() to authenticated;
grant execute on function meu_cliente() to authenticated;
grant execute on function vejo_cliente(uuid) to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Leitura pela sessão; escrita só pelas edge functions (chave de serviço),
-- que conferem quem pediu.
alter table clientes enable row level security;
create policy clientes_ler on clientes for select to authenticated
  using (deleted_at is null and vejo_cliente(id));

alter table usuarios enable row level security;
create policy usuarios_ler on usuarios for select to authenticated
  using (deleted_at is null and (id = auth.uid() or vejo_cliente(cliente_id)));

revoke all on clientes, usuarios from anon;
