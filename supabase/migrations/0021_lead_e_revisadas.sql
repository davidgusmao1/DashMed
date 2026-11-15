-- Quem o médico responde vira lead (David, 15/11/26, sobre o comentário
-- respondido pela busca que não era lead: "Sim, virar lead"). Sem lead, a
-- resposta saía sem o código YT, e a secretária não sabia de que comentário a
-- pessoa veio quando ela chamava no WhatsApp.
--
-- ligar_lead_ao_comentario(): numa transação, com o comentário travado, acha
--   ou cria o lead da pessoa (garantir_lead, 0009), liga o comentário a ele e
--   põe no histórico do lead o comentário e, se já foi respondido, a resposta
--   (e o lead vai para "respondido"). Chamar de novo não muda nada. Só o robô
--   chama: a edge youtube-responder (antes de a IA escrever, no "Pôr o código"
--   e depois de publicar) e o vigia.
-- Regra 1: um evento "comentario" e um "resposta" por comentário no histórico
--   do lead viram índice único. A triagem e o médico podem ligar o mesmo
--   comentário ao mesmo tempo; quem chega depois é descartado e o descarte é
--   contado (aqui no retorno; na triagem, na mensagem do passo).
-- Agradecimento de elogio não vira lead (15/11/26: elogios entram na fila
--   para um agradecimento simples; o CRM e o funil ficam com quem pode virar
--   consulta).
-- Regra 5: o vigia liga ao lead o comentário respondido pela DashMed que ficou
--   sem lead, menos o elogio (a publicação liga na hora; se a ligação falhou
--   depois de publicar, o vigia conserta e registra o achado).
-- Combinado com a sessão "DM - Pacientes" (número da migração e a vigiar()).
--
-- Barra verde na fila (David, 15/11/26: "um botãozinho em cada pergunta ...
-- enviar para respostas para revisar ... já cria uma resposta de [IA] pronta ...
-- uma barrinha na lateral pintando de verde, mostrando que está quase pronto
-- para ser enviado. E toda a resposta que eu revisar ... na hora de publicar,
-- selecionar e mandar publicar tudo junto"). revisada_em marca a resposta que
-- o médico mandou da busca ou revisou na fila; a IA reescrever tira a marca
-- (texto novo ainda não foi visto). A equipe marca e desmarca pela sessão.

alter table yt_comentarios add column revisada_em timestamptz;
grant update (revisada_em) on yt_comentarios to authenticated;

-- conferido em 15/11/26: nenhuma duplicata em produção
create unique index lead_eventos_um_comentario on lead_eventos (comentario_id) where tipo = 'comentario';
create unique index lead_eventos_uma_resposta on lead_eventos (comentario_id) where tipo = 'resposta';

create or replace function ligar_lead_ao_comentario(p_comentario uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_lead uuid;
  v_descartados int := 0;
begin
  select id, cliente_id, autor_canal_id, autor_nome, autor_foto_url, probabilidade, procedimentos, texto, lead_id, resposta, rascunho, publicada_por
    into v from yt_comentarios where id = p_comentario and deleted_at is null for update;
  if not found then raise exception 'Comentário não encontrado.'; end if;

  v_lead := v.lead_id;
  if v_lead is null then
    -- sem o canal do autor não há pessoa (comentário anonimizado pela LGPD)
    if v.autor_canal_id is null then
      return jsonb_build_object('lead_id', null, 'codigo', null, 'motivo', 'O comentário não tem o canal do autor (dados apagados a pedido): não vira lead.', 'descartados', 0);
    end if;
    -- quem pediu para apagar os dados (0018) não volta a ser lead
    if exists (select 1 from yt_bloqueados b where b.cliente_id = v.cliente_id and b.autor_hash = hash_autor_youtube(v.cliente_id, v.autor_canal_id)) then
      return jsonb_build_object('lead_id', null, 'codigo', null, 'motivo', 'Esta pessoa pediu para apagar os dados (LGPD): não vira lead.', 'descartados', 0);
    end if;
    v_lead := garantir_lead(v.cliente_id, v.autor_canal_id, v.autor_nome, v.autor_foto_url, coalesce(v.probabilidade, 0), coalesce(v.procedimentos, '{}'));
    update yt_comentarios set lead_id = v_lead where id = v.id;
  end if;

  -- o comentário no histórico do lead (uma vez só: índice único)
  begin
    insert into lead_eventos (cliente_id, lead_id, tipo, texto, comentario_id, feito_por)
    values (v.cliente_id, v_lead, 'comentario', left(v.texto, 4000), v.id, null);
  exception when unique_violation then
    v_descartados := v_descartados + 1;
  end;

  -- já respondido: a resposta no histórico e o lead em "respondido"
  if v.resposta = 'publicada' then
    begin
      insert into lead_eventos (cliente_id, lead_id, tipo, texto, comentario_id, feito_por)
      values (v.cliente_id, v_lead, 'resposta', left(coalesce(v.rascunho, ''), 4000), v.id, v.publicada_por);
    exception when unique_violation then
      v_descartados := v_descartados + 1;
    end;
    update leads set etapa = 'respondido' where id = v_lead and etapa = 'novo';
  end if;

  return jsonb_build_object('lead_id', v_lead, 'codigo', (select codigo from leads where id = v_lead), 'motivo', null, 'descartados', v_descartados);
end $$;
revoke execute on function ligar_lead_ao_comentario(uuid) from public, anon, authenticated;
grant execute on function ligar_lead_ao_comentario(uuid) to service_role;

-- os que já foram respondidos sem lead (em 15/11/26: 1, publicado pela busca)
do $$
declare
  r record;
begin
  for r in select id from yt_comentarios
           where resposta = 'publicada' and lead_id is null and autor_canal_id is not null and deleted_at is null
             and coalesce(categoria, '') <> 'elogio'
  loop
    perform ligar_lead_ao_comentario(r.id);
  end loop;
end $$;

-- vigia: igual à da 0009 (conferida em produção, md5 07174cb0…), mais a
-- regra "youtube_respondido_sem_lead" antes da limpeza do OAuth
create or replace function vigiar() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_lig jsonb;
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

  -- vídeo: o envio à HeyGen nunca confirmou
  with perdidos as (
    update videos set estado = 'falhou',
      msg = 'O envio para a HeyGen não confirmou em 10 minutos. Confira na sua conta da HeyGen antes de gerar de novo, para não pagar duas vezes.'
    where estado = 'enviando' and atualizado_em < now() - interval '10 minutes'
    returning id, cliente_id)
  insert into achados (cliente_id, regra, alvo_tabela, alvo_id, detalhe, consertado, fechado_em)
  select cliente_id, 'video_envio_perdido', 'videos', id, 'Envio à HeyGen sem confirmação em 10 minutos; marcado como falhou.', true, now()
  from perdidos;

  insert into achados (cliente_id, regra, alvo_tabela, alvo_id, detalhe)
  select v.cliente_id, 'video_demorado', 'videos', v.id, 'Vídeo em processamento na HeyGen há mais de 3 horas.'
  from videos v
  where v.estado = 'processando' and v.deleted_at is null and v.criado_em < now() - interval '3 hours'
  on conflict (regra, alvo_id) where fechado_em is null do nothing;

  update achados a set fechado_em = now()
  where a.regra = 'video_demorado' and a.fechado_em is null
    and not exists (select 1 from videos v where v.id = a.alvo_id and v.estado = 'processando' and v.deleted_at is null);

  -- YouTube: varredura sem avanço (cada passo leva no máximo 150 s)
  with paradas as (
    update yt_varreduras set estado = 'erro',
      msg = 'A varredura parou no meio. Clique em "Varrer agora" para continuar de onde parou.'
    where estado = 'rodando' and atualizado_em < now() - interval '15 minutes'
    returning cliente_id)
  insert into achados (cliente_id, regra, alvo_tabela, alvo_id, detalhe, consertado, fechado_em)
  select cliente_id, 'youtube_varredura_parada', 'yt_varreduras', cliente_id, 'Varredura do YouTube sem avanço há mais de 15 minutos; marcada como erro.', true, now()
  from paradas;

  -- YouTube: resposta que ficou "publicando" — não se sabe se saiu. Não tenta
  -- de novo sozinha (resposta em dobro é pior que nenhuma): avisa o médico.
  with incertas as (
    update yt_comentarios set resposta = 'falhou',
      resposta_msg = 'Não sei se a resposta saiu (a publicação não confirmou). Confira no YouTube antes de publicar de novo.'
    where resposta = 'publicando' and atualizado_em < now() - interval '10 minutes'
    returning id, cliente_id)
  insert into achados (cliente_id, regra, alvo_tabela, alvo_id, detalhe, consertado, fechado_em)
  select cliente_id, 'youtube_resposta_incerta', 'yt_comentarios', id, 'Publicação no YouTube sem confirmação em 10 minutos; marcada como falhou.', true, now()
  from incertas;

  -- YouTube: quem a DashMed respondeu é lead, menos o agradecimento de
  -- elogio (0021). A publicação liga na
  -- hora; se a ligação falhou depois de publicar, liga aqui. O erro de um
  -- comentário vira achado aberto e não para o resto do vigia.
  for r in select id, cliente_id from yt_comentarios
           where resposta = 'publicada' and lead_id is null and autor_canal_id is not null and deleted_at is null
             and coalesce(categoria, '') <> 'elogio'
             and publicada_em < now() - interval '10 minutes'
           order by publicada_em limit 100
  loop
    begin
      v_lig := ligar_lead_ao_comentario(r.id);
      if v_lig->>'lead_id' is not null then
        insert into achados (cliente_id, regra, alvo_tabela, alvo_id, detalhe, consertado, fechado_em)
        values (r.cliente_id, 'youtube_respondido_sem_lead', 'yt_comentarios', r.id,
                'Comentário respondido pela DashMed sem lead; o lead foi ligado e a resposta entrou no histórico.', true, now());
      else
        insert into achados (cliente_id, regra, alvo_tabela, alvo_id, detalhe)
        values (r.cliente_id, 'youtube_respondido_sem_lead', 'yt_comentarios', r.id, coalesce(v_lig->>'motivo', 'Comentário respondido sem lead.'))
        on conflict (regra, alvo_id) where fechado_em is null do nothing;
      end if;
    exception when others then
      insert into achados (cliente_id, regra, alvo_tabela, alvo_id, detalhe)
      values (r.cliente_id, 'youtube_respondido_sem_lead', 'yt_comentarios', r.id, 'Comentário respondido sem lead e não consegui ligar: ' || sqlerrm)
      on conflict (regra, alvo_id) where fechado_em is null do nothing;
    end;
  end loop;
  -- o achado aberto fecha quando o comentário ganhou lead
  update achados a set fechado_em = now(), consertado = true
  where a.regra = 'youtube_respondido_sem_lead' and a.fechado_em is null
    and exists (select 1 from yt_comentarios c where c.id = a.alvo_id and c.lead_id is not null);

  -- OAuth: estado de ida e volta não serve depois de 15 minutos
  delete from oauth_estados where criado_em < now() - interval '1 day';
end $$;

revoke execute on function vigiar() from public, anon, authenticated;
