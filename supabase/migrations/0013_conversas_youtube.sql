-- DashMed — YouTube Seller segue a conversa (David, 14/11/26: "vamos seguir as
-- recomendações", a primeira delas: "seguir a conversa no YouTube").
--
-- Até aqui o robô só lia o comentário de topo. Se a pessoa respondesse à
-- resposta do médico ("e quanto custa?", "atende Unimed?"), ninguém via — e é
-- aí que o lead está mais quente. Agora a varredura confere as conversas em que
-- o canal respondeu nos últimos 30 dias; cada mensagem nova da pessoa vira uma
-- linha em yt_comentarios ligada à original (conversa_de), passa pela triagem e
-- ganha resposta sugerida, que continua a conversa.
--
-- Na mensagem de continuação: thread_id = id da própria mensagem no YouTube
-- (único, mantém o índice único da 0009) e comentario_id = id do comentário de
-- topo (é ele o parentId da resposta; o YouTube só aceita resposta no topo).
alter table yt_comentarios
  add column conversa_de uuid references yt_comentarios(id),
  -- na linha de topo: quando a conversa foi conferida pela última vez
  add column conversa_checada_em timestamptz;
create index yt_comentarios_conversa_idx on yt_comentarios (conversa_de) where conversa_de is not null;
-- as conversas a conferir: onde o canal respondeu
create index yt_comentarios_respondidas_idx on yt_comentarios (cliente_id, conversa_checada_em nulls first)
  where conversa_de is null and (resposta = 'publicada' or ja_respondido) and deleted_at is null;
