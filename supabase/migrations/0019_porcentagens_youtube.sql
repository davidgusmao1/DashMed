-- DashMed — três porcentagens novas na triagem dos comentários do YouTube
-- (David, 15/11/26: "consulta, porcentagem. Depois, cirurgia, porcentagem. E
-- aí depois é uma avaliação socioeconômica ... através da maneira como a
-- pessoa escreve ... de 0 a 100%"). Número 0019 cedido pela sessão
-- "DM - Pacientes".
--
-- A probabilidade de sempre continua decidindo quem vira lead. As novas só
-- informam quem revisa:
-- - consulta_pct: chance de marcar uma consulta;
-- - cirurgia_pct: chance de fazer uma cirurgia (o que o texto sugere, não
--   indicação médica);
-- - socio_pct: estimativa do nível socioeconômico pela escrita e pelo que a
--   pessoa conta (null = texto sem base para estimar), com socio_motivo (os
--   sinais usados), para quem lê saber de onde saiu o número.
-- A estimativa socioeconômica nunca vai para a IA que escreve a resposta: a
-- resposta é a mesma para todos (o Código de Ética Médica veda discriminar).
--
-- pct_em: quando as porcentagens foram calculadas. Os comentários triados
-- antes desta migração ficam com pct_em vazio, e a varredura os completa em
-- lotes (passo "estimar"), primeiro os de leads.
alter table yt_comentarios
  add column consulta_pct int check (consulta_pct between 0 and 100),
  add column cirurgia_pct int check (cirurgia_pct between 0 and 100),
  add column socio_pct int check (socio_pct between 0 and 100),
  add column socio_motivo text,
  add column pct_em timestamptz;
-- (sem grant de update: só o robô escreve, como a probabilidade)

-- comentário já anonimizado (LGPD) não tem texto para avaliar: fica de fora
update yt_comentarios set pct_em = now()
where texto = '[comentário anonimizado a pedido da pessoa (LGPD)]' and pct_em is null;

-- LGPD: a estimativa socioeconômica é perfil da pessoa e sai junto com os
-- outros dados pessoais. Mesma função da 0018, com as duas linhas novas
-- marcadas abaixo (a 0018 já foi aplicada; não se edita migração aplicada).
create or replace function anonimizar_lead(p_lead uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v leads%rowtype;
  v_coments uuid[];
  v_eventos uuid[];
begin
  select * into v from leads where id = p_lead and deleted_at is null for update;
  if not found or not coalesce(administro_cliente(v.cliente_id), false) then
    raise exception 'Lead não encontrado ou sem permissão (só o administrador do cliente anonimiza).' using errcode = '42501';
  end if;
  if v.anonimizado_em is not null then
    return jsonb_build_object('ja_estava', true);
  end if;

  -- novos comentários desta pessoa deixam de ser lidos
  if v.autor_canal_id is not null then
    insert into yt_bloqueados (cliente_id, autor_hash)
    values (v.cliente_id, hash_autor_youtube(v.cliente_id, v.autor_canal_id))
    on conflict (cliente_id, autor_hash) do nothing;
  end if;

  -- todos os comentários dela: os ligados ao lead e os do mesmo canal que não qualificaram
  select coalesce(array_agg(id), '{}') into v_coments from yt_comentarios
  where cliente_id = v.cliente_id
    and (lead_id = v.id or (v.autor_canal_id is not null and autor_canal_id = v.autor_canal_id));
  update yt_comentarios set
    autor_nome = 'Anonimizado', autor_canal_id = null, autor_foto_url = null,
    texto = '[comentário anonimizado a pedido da pessoa (LGPD)]',
    resumo = null,
    rascunho = case when rascunho is null then null else '[anonimizado]' end,
    sugestao_ia = case when sugestao_ia is null then null else '[anonimizado]' end,
    resposta_msg = null,
    -- 0019: a estimativa socioeconômica sai; pct_em preenchido para a varredura não recalcular
    socio_pct = null, socio_motivo = null, pct_em = coalesce(pct_em, now()),
    -- nada mais a responder para quem pediu para sair
    resposta = case when resposta in ('nenhuma', 'redigir', 'rascunho', 'falhou') then 'ignorada' else resposta end,
    triagem = case when triagem = 'pendente' then 'feita' else triagem end
  where id = any(v_coments);

  select coalesce(array_agg(id), '{}') into v_eventos from lead_eventos where lead_id = v.id;
  update lead_eventos set texto = '[anonimizado]' where lead_id = v.id and texto <> '';

  update leads set
    nome = 'Anonimizado', foto_url = null, autor_canal_id = null, telefone = null, notas = '',
    proximo_passo_em = null, anonimizado_em = now(),
    -- sai do quadro ativo; quem já fez tratamento continua contando no funil
    etapa = case when etapa = 'tratamento' then etapa else 'perdido' end
  where id = v.id;

  insert into lead_eventos (cliente_id, lead_id, tipo, texto)
  values (v.cliente_id, v.id, 'nota', 'Dados pessoais anonimizados a pedido da pessoa (LGPD).');

  -- pautas de conteúdo que citavam um comentário dela como exemplo
  update yt_pautas set exemplos = coalesce((
      select jsonb_agg(e) from jsonb_array_elements(exemplos) e
      where not coalesce((e->>'id')::uuid = any(v_coments), false)), '[]'::jsonb)
  where cliente_id = v.cliente_id
    and exists (select 1 from jsonb_array_elements(exemplos) e where coalesce((e->>'id')::uuid = any(v_coments), false));

  -- a auditoria guarda o valor antigo de cada campo mudado (inclusive os que
  -- acabamos de apagar): o registro de quem mudou e quando fica, o dado pessoal sai
  update auditoria set antes = redigir_jsonb(antes, array['nome', 'foto_url', 'autor_canal_id', 'telefone', 'notas'])
  where tabela = 'leads' and registro_id = v.id and antes is not null;
  update auditoria set antes = redigir_jsonb(antes, array['texto'])
  where tabela = 'lead_eventos' and registro_id = any(v_eventos) and antes is not null;

  return jsonb_build_object('comentarios', coalesce(array_length(v_coments, 1), 0), 'eventos', coalesce(array_length(v_eventos, 1), 0));
end $$;
revoke execute on function anonimizar_lead(uuid) from public, anon;
grant execute on function anonimizar_lead(uuid) to authenticated;
