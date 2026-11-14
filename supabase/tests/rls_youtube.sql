-- Teste da RLS e das funções do YouTube Seller (0009_youtube_seller.sql).
-- Cria um cliente de teste com dados, confere o que cada papel enxerga e
-- consegue fazer, e DESFAZ TUDO no fim (rollback). Rodar:
--   npx supabase db query --remote --yes -f supabase/tests/rls_youtube.sql
-- Troque :plataforma pelo id de um usuário da equipe da plataforma.
begin;

create temp table resultado (teste text, ok boolean, detalhe text) on commit drop;
grant all on resultado to authenticated, anon;

insert into clientes (id, nome) values ('00000000-0000-4000-8000-0000000000c2', 'Cliente de teste YouTube');
insert into seller_config (cliente_id, telemedicina) values ('00000000-0000-4000-8000-0000000000c2', 'WhatsApp (51) 99999-1234');
insert into yt_varreduras (cliente_id, canal_id) values ('00000000-0000-4000-8000-0000000000c2', 'UCteste');
insert into integracoes (cliente_id, provedor, final, parametros) values ('00000000-0000-4000-8000-0000000000c2', 'youtube', 'este', '{"canal_id":"UCteste"}');
insert into oauth_estados (cliente_id, usuario_id, provedor, retorno)
  select '00000000-0000-4000-8000-0000000000c2', id, 'youtube', 'https://dashmed-app.vercel.app/configuracoes' from usuarios where plataforma limit 1;

-- garantir_lead (como o robô): a mesma pessoa vira o mesmo lead
create temp table ids (nome text, id uuid) on commit drop;
grant all on ids to authenticated;
insert into ids select 'a', garantir_lead('00000000-0000-4000-8000-0000000000c2', 'UCpessoa', 'Maria', null, 50, array['Prótese de quadril']);
insert into ids select 'b', garantir_lead('00000000-0000-4000-8000-0000000000c2', 'UCpessoa', 'Maria S.', null, 80, array['Ácido hialurônico']);
insert into ids select 'c', garantir_lead('00000000-0000-4000-8000-0000000000c2', 'UCoutra', 'João', null, 30, '{}');
insert into resultado select 'mesma pessoa = mesmo lead', (select id from ids where nome = 'a') = (select id from ids where nome = 'b'), '';
insert into resultado select 'pessoas diferentes = leads diferentes', (select id from ids where nome = 'a') <> (select id from ids where nome = 'c'), '';
insert into resultado select 'lead guarda a maior probabilidade e soma procedimentos',
  probabilidade = 80 and procedimentos @> array['Prótese de quadril', 'Ácido hialurônico'], probabilidade::text || ' ' || procedimentos::text
  from leads where id = (select id from ids where nome = 'a');
insert into resultado select 'códigos diferentes por lead', count(distinct codigo) = 2, string_agg(codigo, ',') from leads where cliente_id = '00000000-0000-4000-8000-0000000000c2';

insert into yt_comentarios (id, cliente_id, canal_id, thread_id, comentario_id, video_id, autor_nome, autor_canal_id, texto, publicado_em, triagem, probabilidade, resposta, rascunho, lead_id)
  select '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000c2', 'UCteste', 'th1', 'cm1', 'v1', 'Maria', 'UCpessoa',
         'Doutor, quanto custa a prótese?', now(), 'feita', 80, 'rascunho', 'Oi, Maria!', id from ids where nome = 'a';
insert into lead_eventos (cliente_id, lead_id, tipo, texto) select '00000000-0000-4000-8000-0000000000c2', id, 'comentario', 'comentou' from ids where nome = 'a';

-- uma resposta publicada que o médico editou (aprender com as edições, 0012)
insert into yt_comentarios (cliente_id, canal_id, thread_id, comentario_id, video_id, autor_nome, texto, publicado_em, triagem, resposta, sugestao_ia, rascunho, publicada_em)
  values ('00000000-0000-4000-8000-0000000000c2', 'UCteste', 'th2', 'cm2', 'v1', 'João', 'Atende convênio?', now(), 'feita', 'publicada',
          'Olá! Agende pelo WhatsApp.', 'Olá, João! Atendo particular. Agende pelo WhatsApp com a secretária.', now());
insert into resultado select 'edição de verdade é reconhecida', editou_de_verdade('Olá! Agende.', 'Olá, João! Agende com a secretária.') and not editou_de_verdade('Olá!  Agende.', 'olá! agende.'), '';

insert into seller_treinos (id, cliente_id, texto) values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000c2', 'Comece agradecendo a pergunta.');

-- pautas de conteúdo (0015): duas pautas do cliente de teste
insert into yt_pautas (id, cliente_id, titulo, porque, comentarios, exemplos) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c2', 'Quando posso dirigir depois da prótese?', 'Muitos perguntam.', 3,
   '[{"id":"00000000-0000-4000-8000-0000000000e1","texto":"Doutor, quando volto a dirigir?"}]'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000c2', 'Ácido hialurônico dura quanto tempo?', '', 2, '[]');

-- catálogo de vídeos do canal (0017)
insert into yt_videos (cliente_id, video_id, titulo) values ('00000000-0000-4000-8000-0000000000c2', 'v1', 'Prótese de quadril: quando posso dirigir?');
do $$ begin
  insert into yt_videos (cliente_id, video_id, titulo) values ('00000000-0000-4000-8000-0000000000c2', 'v1', 'repetido');
  insert into resultado values ('vídeo repetido é recusado', false, 'entrou');
exception when unique_violation then insert into resultado values ('vídeo repetido é recusado', true, '');
end $$;

-- LGPD (0018): o hash do canal é o mesmo no banco e na edge (hashAutor, youtube-varrer)
insert into resultado select 'hash do autor igual no banco e na edge', hash_autor_youtube('00000000-0000-4000-8000-0000000000c2', 'UCpessoa') = 'd7d77630deae2db23f9cf1e1e8831ae558cf68906b8fc5ef6749e7a8b56241c9', '';

-- A anonimização só pode tocar a auditoria do próprio lead e dos eventos dele
-- (pedido da sessão "DM - Pacientes", 14/11/26): a de outro lead e a de
-- paciente ficam intactas, mesmo com o lead ligado ao paciente (o dado clínico
-- tem outra base legal e não sai com o lead).
update leads set nome = 'João P.' where id = (select id from ids where nome = 'c');
insert into pacientes (id, cliente_id, nome) values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c2', 'Maria Paciente');
update pacientes set nome = 'Maria Paciente S.' where id = '00000000-0000-4000-8000-0000000000b1';
update leads set paciente_id = '00000000-0000-4000-8000-0000000000b1' where id = (select id from ids where nome = 'a');
create temp table auditoria_retrato on commit drop as
  select id, antes from auditoria
  where (tabela = 'leads' and registro_id = (select id from ids where nome = 'c')) or (tabela = 'pacientes' and registro_id = '00000000-0000-4000-8000-0000000000b1');

-- o mesmo comentário não entra duas vezes
do $$ begin
  insert into yt_comentarios (cliente_id, canal_id, thread_id, comentario_id, video_id, autor_nome, texto, publicado_em)
  values ('00000000-0000-4000-8000-0000000000c2', 'UCteste', 'th1', 'cm1', 'v1', 'Maria', 'repetido', now());
  insert into resultado values ('comentário repetido é recusado', false, 'entrou');
exception when unique_violation then insert into resultado values ('comentário repetido é recusado', true, '');
end $$;

-- cota: reserva até o teto e recusa depois
insert into resultado select 'cota reserva até 9.000', gastar_cota_youtube('00000000-0000-4000-8000-0000000000c2', 8999), '';
insert into resultado select 'cota recusa passar de 9.000', not gastar_cota_youtube('00000000-0000-4000-8000-0000000000c2', 2), '';

-- ── 1. usuário de FORA: vê zero ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000dead","role":"authenticated"}';
insert into resultado select 'fora vê 0 seller_config', count(*) = 0, count(*)::text from seller_config where cliente_id = '00000000-0000-4000-8000-0000000000c2';
insert into resultado select 'fora vê 0 varreduras', count(*) = 0, count(*)::text from yt_varreduras where cliente_id = '00000000-0000-4000-8000-0000000000c2';
insert into resultado select 'fora vê 0 cota', count(*) = 0, count(*)::text from yt_cota where cliente_id = '00000000-0000-4000-8000-0000000000c2';
insert into resultado select 'fora vê 0 leads', count(*) = 0, count(*)::text from leads where cliente_id = '00000000-0000-4000-8000-0000000000c2';
insert into resultado select 'fora vê 0 eventos', count(*) = 0, count(*)::text from lead_eventos where cliente_id = '00000000-0000-4000-8000-0000000000c2';
insert into resultado select 'fora vê 0 comentários', count(*) = 0, count(*)::text from yt_comentarios where cliente_id = '00000000-0000-4000-8000-0000000000c2';
do $$ begin
  perform resumo_youtube('00000000-0000-4000-8000-0000000000c2');
  insert into resultado values ('fora não lê o resumo', false, 'leu');
exception when others then insert into resultado values ('fora não lê o resumo', true, sqlerrm);
end $$;
do $$ begin
  update leads set etapa = 'perdido' where cliente_id = '00000000-0000-4000-8000-0000000000c2';
  insert into resultado values ('fora não move lead', not found, 'moveu');
end $$;
insert into resultado select 'fora vê 0 treinamentos', count(*) = 0, count(*)::text from seller_treinos where cliente_id = '00000000-0000-4000-8000-0000000000c2';
do $$ begin
  insert into seller_treinos (cliente_id, texto) values ('00000000-0000-4000-8000-0000000000c2', 'invasão');
  insert into resultado values ('fora não treina a IA', false, 'treinou');
exception when others then insert into resultado values ('fora não treina a IA', true, sqlerrm);
end $$;
insert into resultado select 'fora vê 0 pautas', count(*) = 0, count(*)::text from yt_pautas where cliente_id = '00000000-0000-4000-8000-0000000000c2';
do $$ begin
  perform criar_conteudo_da_pauta('00000000-0000-4000-8000-0000000000a1');
  insert into resultado values ('fora não cria conteúdo da pauta', false, 'criou');
exception when others then insert into resultado values ('fora não cria conteúdo da pauta', true, sqlerrm);
end $$;
do $$ begin
  perform descartar_pauta('00000000-0000-4000-8000-0000000000a2');
  insert into resultado values ('fora não descarta pauta', false, 'descartou');
exception when others then insert into resultado values ('fora não descarta pauta', true, sqlerrm);
end $$;
do $$ begin
  perform funil_youtube('00000000-0000-4000-8000-0000000000c2');
  insert into resultado values ('fora não lê o funil', false, 'leu');
exception when others then insert into resultado values ('fora não lê o funil', true, sqlerrm);
end $$;
insert into resultado select 'fora vê 0 vídeos do canal', count(*) = 0, count(*)::text from yt_videos where cliente_id = '00000000-0000-4000-8000-0000000000c2';
do $$ begin
  perform anonimizar_lead((select id from ids where nome = 'a'));
  insert into resultado values ('fora não anonimiza lead', false, 'anonimizou');
exception when others then insert into resultado values ('fora não anonimiza lead', true, sqlerrm);
end $$;

-- ── 2. equipe da PLATAFORMA ──
set local request.jwt.claims = '{"sub":":plataforma","role":"authenticated"}';
insert into resultado select 'plataforma vê os 2 leads', count(*) = 2, count(*)::text from leads where cliente_id = '00000000-0000-4000-8000-0000000000c2';
insert into resultado select 'plataforma vê o comentário', count(*) = 1, count(*)::text from yt_comentarios where id = '00000000-0000-4000-8000-0000000000e1';
insert into resultado select 'plataforma lê o resumo', (resumo_youtube('00000000-0000-4000-8000-0000000000c2')->>'leads')::int = 2, '';
do $$ begin
  update yt_comentarios set rascunho = 'Oi, Maria! Editado.', rascunho_editado = true, resposta = 'rascunho' where id = '00000000-0000-4000-8000-0000000000e1';
  insert into resultado values ('plataforma edita o rascunho', found, '');
end $$;
do $$ begin
  update yt_comentarios set resposta = 'publicada' where id = '00000000-0000-4000-8000-0000000000e1';
  insert into resultado values ('sessão não marca "publicada" sem o YouTube', false, 'marcou');
exception when others then insert into resultado values ('sessão não marca "publicada" sem o YouTube', true, sqlerrm);
end $$;
do $$ begin
  update yt_comentarios set probabilidade = 100 where id = '00000000-0000-4000-8000-0000000000e1';
  insert into resultado values ('sessão não muda a triagem', false, 'mudou');
exception when insufficient_privilege then insert into resultado values ('sessão não muda a triagem', true, sqlerrm);
end $$;
do $$ begin
  update leads set codigo = 'YT0000' where cliente_id = '00000000-0000-4000-8000-0000000000c2';
  insert into resultado values ('sessão não muda o código do lead', false, 'mudou');
exception when insufficient_privilege then insert into resultado values ('sessão não muda o código do lead', true, sqlerrm);
end $$;
do $$ begin
  update leads set etapa = 'conversando', notas = 'chamou no WhatsApp' where id = (select id from ids where nome = 'a');
  insert into resultado values ('plataforma move o lead', found, '');
end $$;
insert into resultado select 'mudança de etapa entra no histórico sozinha', count(*) = 1, count(*)::text
  from lead_eventos where lead_id = (select id from ids where nome = 'a') and tipo = 'etapa' and texto = 'novo → conversando';
do $$ begin
  insert into lead_eventos (cliente_id, lead_id, tipo, texto)
  select '00000000-0000-4000-8000-0000000000c2', id, 'whatsapp', 'mandou o código' from ids where nome = 'a';
  insert into resultado values ('plataforma registra contato', true, '');
exception when others then insert into resultado values ('plataforma registra contato', false, sqlerrm);
end $$;
do $$ begin
  insert into lead_eventos (cliente_id, lead_id, tipo, texto)
  select '00000000-0000-4000-8000-0000000000c2', id, 'resposta', 'falsa' from ids where nome = 'a';
  insert into resultado values ('sessão não forja "resposta publicada"', false, 'forjou');
exception when others then insert into resultado values ('sessão não forja "resposta publicada"', true, sqlerrm);
end $$;
do $$ begin
  delete from lead_eventos where cliente_id = '00000000-0000-4000-8000-0000000000c2';
  insert into resultado values ('sessão não apaga histórico', false, 'apagou');
exception when insufficient_privilege then insert into resultado values ('sessão não apaga histórico', true, sqlerrm);
end $$;
do $$ begin
  perform 1 from oauth_estados limit 1;
  insert into resultado values ('sessão não lê o estado do OAuth', false, 'leu');
exception when insufficient_privilege then insert into resultado values ('sessão não lê o estado do OAuth', true, sqlerrm);
end $$;
do $$ begin
  perform garantir_lead('00000000-0000-4000-8000-0000000000c2', 'UCx', 'x', null, 1, '{}');
  insert into resultado values ('sessão não cria lead pela função do robô', false, 'criou');
exception when insufficient_privilege then insert into resultado values ('sessão não cria lead pela função do robô', true, sqlerrm);
end $$;
do $$ begin
  perform gastar_cota_youtube('00000000-0000-4000-8000-0000000000c2', 1);
  insert into resultado values ('sessão não mexe na cota', false, 'mexeu');
exception when insufficient_privilege then insert into resultado values ('sessão não mexe na cota', true, sqlerrm);
end $$;
do $$ begin
  update yt_varreduras set estado = 'parada' where cliente_id = '00000000-0000-4000-8000-0000000000c2';
  insert into resultado values ('sessão não mexe na varredura', false, 'mexeu');
exception when insufficient_privilege then insert into resultado values ('sessão não mexe na varredura', true, sqlerrm);
end $$;

insert into resultado select 'resumo conta 1 edição nova', (resumo_youtube('00000000-0000-4000-8000-0000000000c2')->>'edicoes_novas')::int = 1,
  resumo_youtube('00000000-0000-4000-8000-0000000000c2')->>'edicoes_novas';
do $$ begin
  update yt_comentarios set sugestao_ia = 'troquei' where id = '00000000-0000-4000-8000-0000000000e1';
  insert into resultado values ('sessão não altera a sugestão original da IA', false, 'alterou');
exception when insufficient_privilege then insert into resultado values ('sessão não altera a sugestão original da IA', true, sqlerrm);
end $$;
do $$ begin
  update yt_comentarios set aprendido_em = now() where id = '00000000-0000-4000-8000-0000000000e1';
  insert into resultado values ('sessão não marca edição como analisada', false, 'marcou');
exception when insufficient_privilege then insert into resultado values ('sessão não marca edição como analisada', true, sqlerrm);
end $$;
do $$ begin
  insert into seller_treinos (cliente_id, texto, origem) values ('00000000-0000-4000-8000-0000000000c2', 'Diga que atende particular.', 'edicao');
  insert into resultado values ('plataforma salva regra aprendida das edições', true, '');
exception when others then insert into resultado values ('plataforma salva regra aprendida das edições', false, sqlerrm);
end $$;
insert into resultado select 'plataforma vê o treinamento', count(*) = 1, count(*)::text from seller_treinos where id = '00000000-0000-4000-8000-0000000000f1';
do $$ begin
  insert into seller_treinos (cliente_id, texto, origem) values ('00000000-0000-4000-8000-0000000000c2', 'Não fale de SUS.', 'voz');
  insert into resultado values ('plataforma treina a IA (voz)', true, '');
exception when others then insert into resultado values ('plataforma treina a IA (voz)', false, sqlerrm);
end $$;
do $$ begin
  update seller_treinos set ativo = false where id = '00000000-0000-4000-8000-0000000000f1';
  insert into resultado values ('plataforma desativa treinamento', found, '');
end $$;
do $$ begin
  update seller_treinos set cliente_id = '00000000-0000-4000-8000-0000000000c1' where id = '00000000-0000-4000-8000-0000000000f1';
  insert into resultado values ('sessão não muda o cliente do treinamento', false, 'mudou');
exception when insufficient_privilege then insert into resultado values ('sessão não muda o cliente do treinamento', true, sqlerrm);
end $$;
do $$ begin
  delete from seller_treinos where cliente_id = '00000000-0000-4000-8000-0000000000c2';
  insert into resultado values ('sessão não apaga treinamento', false, 'apagou');
exception when insufficient_privilege then insert into resultado values ('sessão não apaga treinamento', true, sqlerrm);
end $$;
-- funil (0014) e pautas (0015)
insert into resultado select 'plataforma lê o funil', (funil_youtube('00000000-0000-4000-8000-0000000000c2')->'totais'->>'leads')::int = 2, '';
insert into ids select 'conteudo1', criar_conteudo_da_pauta('00000000-0000-4000-8000-0000000000a1');
insert into ids select 'conteudo2', criar_conteudo_da_pauta('00000000-0000-4000-8000-0000000000a1');
insert into resultado select 'pauta vira um só conteúdo (clique duplo)',
  (select id from ids where nome = 'conteudo1') = (select id from ids where nome = 'conteudo2'), '';
insert into resultado select 'conteúdo nasce com as perguntas reais', orientacoes like '%quando volto a dirigir%', left(orientacoes, 60)
  from conteudos where id = (select id from ids where nome = 'conteudo1');
insert into resultado select 'pauta aponta para o conteúdo', conteudo_id = (select id from ids where nome = 'conteudo1'), ''
  from yt_pautas where id = '00000000-0000-4000-8000-0000000000a1';
do $$ begin
  insert into yt_pautas (cliente_id, titulo) values ('00000000-0000-4000-8000-0000000000c2', 'invasão');
  insert into resultado values ('sessão não escreve pauta', false, 'escreveu');
exception when insufficient_privilege then insert into resultado values ('sessão não escreve pauta', true, sqlerrm);
end $$;
do $$ begin
  update yt_pautas set titulo = 'mudado' where id = '00000000-0000-4000-8000-0000000000a2';
  insert into resultado values ('sessão não muda a pauta direto', false, 'mudou');
exception when insufficient_privilege then insert into resultado values ('sessão não muda a pauta direto', true, sqlerrm);
end $$;
do $$ begin
  perform descartar_pauta('00000000-0000-4000-8000-0000000000a1');
  insert into resultado values ('pauta que virou conteúdo não é descartada', false, 'descartou');
exception when others then insert into resultado values ('pauta que virou conteúdo não é descartada', true, sqlerrm);
end $$;
select descartar_pauta('00000000-0000-4000-8000-0000000000a2');
insert into resultado select 'pauta descartada some da lista', count(*) = 1, count(*)::text from yt_pautas where cliente_id = '00000000-0000-4000-8000-0000000000c2';

insert into resultado select 'plataforma vê o vídeo do canal', count(*) = 1, count(*)::text from yt_videos where cliente_id = '00000000-0000-4000-8000-0000000000c2';
do $$ begin
  insert into yt_videos (cliente_id, video_id, titulo) values ('00000000-0000-4000-8000-0000000000c2', 'v9', 'invasão');
  insert into resultado values ('sessão não escreve no catálogo', false, 'escreveu');
exception when insufficient_privilege then insert into resultado values ('sessão não escreve no catálogo', true, sqlerrm);
end $$;

-- LGPD (0018): anonimizar a pedido da pessoa
select anonimizar_lead((select id from ids where nome = 'a'));
insert into resultado select 'anonimizar apaga o que identifica o lead',
  nome = 'Anonimizado' and foto_url is null and telefone is null and autor_canal_id is null and notas = '' and anonimizado_em is not null and etapa = 'perdido',
  nome || ' ' || etapa from leads where id = (select id from ids where nome = 'a');
insert into resultado select 'comentário anonimizado e resposta cancelada',
  texto like '[comentário anonimizado%' and autor_nome = 'Anonimizado' and autor_canal_id is null and resposta = 'ignorada' and rascunho = '[anonimizado]', resposta
  from yt_comentarios where id = '00000000-0000-4000-8000-0000000000e1';
insert into resultado select 'histórico do lead sem texto pessoal',
  bool_and(texto in ('[anonimizado]', 'Dados pessoais anonimizados a pedido da pessoa (LGPD).') or tipo = 'etapa'), string_agg(texto, ' | ')
  from lead_eventos where lead_id = (select id from ids where nome = 'a');
insert into resultado select 'pauta perde o exemplo da pessoa', jsonb_array_length(exemplos) = 0, exemplos::text
  from yt_pautas where id = '00000000-0000-4000-8000-0000000000a1';
insert into resultado select 'anonimizar de novo não refaz', (anonimizar_lead((select id from ids where nome = 'a'))->>'ja_estava')::boolean, '';


-- ── 3. anon ──
set local role anon;
do $$ begin
  perform 1 from leads limit 1;
  insert into resultado values ('anon não lê leads', false, 'leu');
exception when insufficient_privilege then insert into resultado values ('anon não lê leads', true, sqlerrm);
end $$;

reset role;
insert into resultado select 'auditoria sem o nome antigo do lead', count(*) = 0, count(*)::text from auditoria
  where antes::text ilike '%maria%' and ((tabela = 'leads' and registro_id = (select id from ids where nome = 'a'))
    or (tabela = 'lead_eventos' and registro_id in (select id from lead_eventos where lead_id = (select id from ids where nome = 'a'))));
insert into resultado select 'pessoa anonimizada não volta a ser lida', count(*) = 1, count(*)::text from yt_bloqueados
  where cliente_id = '00000000-0000-4000-8000-0000000000c2' and autor_hash = 'd7d77630deae2db23f9cf1e1e8831ae558cf68906b8fc5ef6749e7a8b56241c9';
insert into resultado select 'auditoria de outro lead e do paciente intacta',
  count(*) = (select count(*) from auditoria_retrato) and count(*) filter (where a.antes is distinct from r.antes) = 0
  and bool_or(r.antes::text like '%João%') and bool_or(r.antes::text like '%Maria Paciente%'),
  count(*)::text || ' linha(s)'
  from auditoria_retrato r join auditoria a using (id);
insert into resultado select 'paciente ligado ao lead não é anonimizado', nome = 'Maria Paciente S.', nome
  from pacientes where id = '00000000-0000-4000-8000-0000000000b1';
insert into resultado select 'auditoria prova quem anonimizou e quando', count(*) = 1, count(*)::text from auditoria
  where tabela = 'leads' and registro_id = (select id from ids where nome = 'a') and 'anonimizado_em' = any(campos) and usuario_id = ':plataforma';
-- a auditoria (LGPD) registrou o lead e a mudança de etapa
insert into resultado select 'auditoria registrou o lead', count(*) >= 2, count(*)::text
  from auditoria where tabela = 'leads' and registro_id = (select id from ids where nome = 'a');
select teste, ok, left(detalhe, 70) as detalhe from resultado order by ok, teste;
rollback;
