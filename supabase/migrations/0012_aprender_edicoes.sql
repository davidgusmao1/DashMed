-- DashMed — YouTube Seller aprende com as edições do médico (David, 14/11/26,
-- escolhendo entre as sugestões: "Aprender com edições").
--
-- Até aqui o rascunho editado sobrescrevia a sugestão da IA, então não dava
-- para comparar. Agora a sugestão original fica em sugestao_ia (só o robô
-- escreve); quando o médico publica um texto diferente, a edição entra na conta
-- de "edições para aprender". A IA compara sugestão × publicado, procura
-- padrões e PROPÕE regras; só vira treinamento o que o médico aprovar (regra 4).
alter table yt_comentarios
  add column sugestao_ia text,
  -- quando esta edição entrou numa análise de aprendizado
  add column aprendido_em timestamptz;
-- a sessão não mexe nisso: sugestao_ia e aprendido_em ficam fora do grant de
-- update (o grant é por coluna, 0009)

alter table seller_treinos drop constraint seller_treinos_origem_check;
alter table seller_treinos add constraint seller_treinos_origem_check
  check (origem in ('texto', 'voz', 'edicao'));

-- Edição "de verdade": o publicado difere da sugestão além de espaço e
-- maiúscula. Usada no resumo e na escolha do que analisar.
create or replace function editou_de_verdade(p_sugestao text, p_publicado text) returns boolean
language sql immutable set search_path = public as $$
  select p_sugestao is not null and p_publicado is not null
     and regexp_replace(lower(btrim(p_sugestao)), '\s+', ' ', 'g') <> regexp_replace(lower(btrim(p_publicado)), '\s+', ' ', 'g')
$$;

create index yt_comentarios_edicoes_idx on yt_comentarios (cliente_id, publicada_em desc)
  where resposta = 'publicada' and sugestao_ia is not null;

-- resumo da tela, agora com as edições ainda não analisadas
create or replace function resumo_youtube(p_cliente uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not vejo_cliente(p_cliente) then
    raise exception 'Sem acesso a este cliente.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'comentarios', (select count(*) from yt_comentarios where cliente_id = p_cliente and deleted_at is null),
    'triagem_pendente', (select count(*) from yt_comentarios where cliente_id = p_cliente and triagem = 'pendente' and deleted_at is null),
    'para_revisar', (select count(*) from yt_comentarios where cliente_id = p_cliente and resposta in ('rascunho', 'falhou') and deleted_at is null),
    'redigir', (select count(*) from yt_comentarios where cliente_id = p_cliente and resposta = 'redigir' and deleted_at is null),
    'publicadas', (select count(*) from yt_comentarios where cliente_id = p_cliente and resposta = 'publicada' and deleted_at is null),
    'publicadas_hoje', (select count(*) from yt_comentarios where cliente_id = p_cliente and resposta = 'publicada'
                          and publicada_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'),
    'leads', (select count(*) from leads where cliente_id = p_cliente and deleted_at is null),
    'cota_hoje', (select coalesce(sum(unidades), 0) from yt_cota where cliente_id = p_cliente and dia = (now() at time zone 'America/Los_Angeles')::date),
    'edicoes_novas', (select count(*) from yt_comentarios where cliente_id = p_cliente and resposta = 'publicada' and deleted_at is null
                        and aprendido_em is null and editou_de_verdade(sugestao_ia, rascunho))
  );
end $$;
revoke execute on function resumo_youtube(uuid) from public, anon;
grant execute on function resumo_youtube(uuid) to authenticated;
