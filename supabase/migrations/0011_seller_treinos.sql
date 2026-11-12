-- DashMed — Treinamento da IA do YouTube Seller (David, 12/11/26: "um botão
-- escrito treinamento da IA, onde eu vou falar algumas coisas para treinar para
-- que as próximas respostas sigam um determinado padrão. E aí isso tem que
-- ficar gravado em algum lugar").
--
-- Cada treinamento é uma orientação do médico, escrita ou ditada por voz. Os
-- ativos entram em toda triagem e toda resposta nova (os mais recentes valem
-- mais se houver conflito). Fica guardado até o médico desativar; nada expira
-- sozinho. Quem treina é quem administra o cliente (a voz é do médico).
create table seller_treinos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  texto text not null check (length(btrim(texto)) between 3 and 2000),
  origem text not null default 'texto' check (origem in ('texto', 'voz')),
  -- o comentário em que o médico estava quando treinou (contexto)
  comentario_id uuid references yt_comentarios(id),
  ativo boolean not null default true,
  criado_por uuid references usuarios(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index seller_treinos_cliente_idx on seller_treinos (cliente_id, criado_em) where ativo;
create trigger seller_treinos_atualizado before update on seller_treinos
  for each row execute function tocar_atualizado_em();
alter table seller_treinos enable row level security;
create policy seller_treinos_ler on seller_treinos for select to authenticated
  using (vejo_cliente(cliente_id));
create policy seller_treinos_criar on seller_treinos for insert to authenticated
  with check (administro_cliente(cliente_id));
create policy seller_treinos_mudar on seller_treinos for update to authenticated
  using (administro_cliente(cliente_id)) with check (administro_cliente(cliente_id));
revoke all on seller_treinos from anon;
revoke insert, update, delete on seller_treinos from authenticated;
grant insert (cliente_id, texto, origem, comentario_id) on seller_treinos to authenticated;
-- desativar em vez de apagar: o histórico do que a IA aprendeu fica
grant update (texto, ativo) on seller_treinos to authenticated;
