-- DashMed — perguntas frequentes do YouTube viram pautas de conteúdo (David,
-- 14/11/26, seguindo a recomendação "o que o público mais pergunta vira vídeo").
--
-- A IA lê as perguntas dos comentários e agrupa em pautas; o médico escolhe
-- quais viram conteúdo (o "Conteúdos para mídias sociais" faz o resto). A IA
-- propõe e a pessoa decide, como no aprender com edições (regra 4).
--
-- Guardadas para não refazer a análise a cada visita e para ver de qual pauta
-- saiu cada conteúdo. Uma nova análise arquiva (soft delete) as pautas que
-- ainda não viraram conteúdo; as que viraram ficam.
create table yt_pautas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  titulo text not null check (length(btrim(titulo)) between 3 and 300),
  porque text not null default '' check (length(porque) <= 1000),
  procedimento text,
  -- quantos comentários pedem isto (os que a IA apontou)
  comentarios int not null default 0 check (comentarios >= 0),
  -- até 3 perguntas reais de exemplo: [{id (yt_comentarios), texto}]; sem o
  -- nome de quem perguntou (LGPD: o texto aponta para o comentário, que é
  -- quem guarda o autor)
  exemplos jsonb not null default '[]'::jsonb,
  conteudo_id uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (conteudo_id, cliente_id) references conteudos (id, cliente_id)
);
create index yt_pautas_cliente_idx on yt_pautas (cliente_id, criado_em desc) where deleted_at is null;
-- regra 1: um conteúdo nasce de no máximo uma pauta
create unique index yt_pautas_conteudo_unico on yt_pautas (conteudo_id) where conteudo_id is not null;
create trigger yt_pautas_atualizado before update on yt_pautas
  for each row execute function tocar_atualizado_em();
alter table yt_pautas enable row level security;
create policy yt_pautas_ler on yt_pautas for select to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id));
create policy yt_pautas_descartar on yt_pautas for update to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id)) with check (vejo_cliente(cliente_id));
revoke all on yt_pautas from anon;
revoke insert, update, delete on yt_pautas from authenticated;
-- a equipe só descarta; quem escreve as pautas é a edge function (chave de serviço)
grant update (deleted_at) on yt_pautas to authenticated;

-- Criar o conteúdo a partir da pauta, de uma vez: trava a pauta, e se ela já
-- virou conteúdo devolve o mesmo (clique duplo não cria dois — regra 1).
create or replace function criar_conteudo_da_pauta(p_pauta uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v yt_pautas%rowtype;
  v_conteudo uuid;
  v_orientacoes text;
begin
  select * into v from yt_pautas where id = p_pauta and deleted_at is null for update;
  if not found or not vejo_cliente(v.cliente_id) then
    raise exception 'Pauta não encontrada.' using errcode = 'P0002';
  end if;
  if v.conteudo_id is not null then
    return v.conteudo_id;
  end if;
  v_orientacoes := left(concat_ws(E'\n',
    'Pauta vinda das perguntas dos comentários do YouTube (' || v.comentarios || ' comentário(s) pedem isto).',
    nullif(v.porque, ''),
    case when jsonb_array_length(v.exemplos) > 0 then E'\nPerguntas reais:\n' ||
      (select string_agg('- ' || left(e->>'texto', 300), E'\n') from jsonb_array_elements(v.exemplos) e) end
  ), 2000);
  insert into conteudos (cliente_id, assunto, orientacoes, criado_por)
  values (v.cliente_id, left(v.titulo, 300), v_orientacoes, auth.uid())
  returning id into v_conteudo;
  update yt_pautas set conteudo_id = v_conteudo where id = v.id;
  return v_conteudo;
end $$;
revoke execute on function criar_conteudo_da_pauta(uuid) from public, anon;
grant execute on function criar_conteudo_da_pauta(uuid) to authenticated;
