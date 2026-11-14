-- DashMed — a resposta sugere um vídeo do próprio canal (David, 14/11/26,
-- seguindo a recomendação "sugerir o vídeo do canal que responde a dúvida").
-- Número 0017 cedido pela sessão "DM - Pacientes" (ela começa na 0019).
--
-- yt_videos: o catálogo dos vídeos PÚBLICOS do canal, lido da playlist de
-- uploads uma vez por dia na varredura (1 unidade de cota por 50 vídeos).
-- Vídeo que saiu do canal ou ficou privado é arquivado (deleted_at), não apagado.
-- A IA cita o vídeo pelo título, sem link (link em resposta o YouTube costuma
-- segurar como spam — a regra de texto.ts continua valendo).
create table yt_videos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  video_id text not null,
  titulo text not null,
  descricao text not null default '',
  publicado_em timestamptz,
  visto_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  deleted_at timestamptz
);
-- regra 1: um vídeo aparece uma vez por cliente
create unique index yt_videos_unico on yt_videos (cliente_id, video_id);
alter table yt_videos enable row level security;
create policy yt_videos_ler on yt_videos for select to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id));
revoke all on yt_videos from anon;
-- só a edge function (chave de serviço) escreve
revoke insert, update, delete on yt_videos from authenticated;

-- quando o catálogo foi lido pela última vez (a varredura relê depois de 24 h)
alter table yt_varreduras add column videos_em timestamptz;

-- o vídeo que a IA citou na resposta sugerida (o médico vê e confere na fila)
alter table yt_comentarios add column video_sugerido text;
