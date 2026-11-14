-- DashMed — LGPD: anonimizar um lead do YouTube Seller a pedido da pessoa
-- (David, 14/11/26, seguindo a recomendação). Número 0018 cedido pela sessão
-- "DM - Pacientes".
--
-- Por que sobrescrever em vez de soft delete (regra 6): o titular pediu a
-- eliminação dos dados pessoais (LGPD art. 18). Fica o esqueleto que não
-- identifica ninguém — etapa, procedimentos, datas, contagem do funil — e some
-- o que identifica: nome, foto, canal, telefone, anotações, o texto dos
-- comentários, das respostas e do histórico, e os valores antigos guardados na
-- auditoria. Não mexe em nada no YouTube: o comentário público é da pessoa.
--
-- E a pessoa não volta a ser lida: o canal dela entra em yt_bloqueados como
-- hash (sha256 de cliente:canal), e a varredura pula quem está lá — sem
-- guardar o identificador em claro.

alter table leads add column anonimizado_em timestamptz;

create table yt_bloqueados (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  autor_hash text not null,
  criado_em timestamptz not null default now()
);
-- regra 1: um bloqueio por pessoa por cliente
create unique index yt_bloqueados_unico on yt_bloqueados (cliente_id, autor_hash);
alter table yt_bloqueados enable row level security;
-- sem política: só a função abaixo e a edge function (chave de serviço) usam
revoke all on yt_bloqueados from anon, authenticated;

create or replace function hash_autor_youtube(p_cliente uuid, p_autor text) returns text
language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(p_cliente::text || ':' || p_autor, 'UTF8')), 'hex')
$$;
revoke execute on function hash_autor_youtube(uuid, text) from public, anon, authenticated;

-- troca o valor das chaves pessoais de um retrato da auditoria
create or replace function redigir_jsonb(p jsonb, p_chaves text[]) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(k, case when k = any(p_chaves) and v <> 'null'::jsonb then to_jsonb('[anonimizado]'::text) else v end), p)
  from jsonb_each(p) as e(k, v)
$$;
revoke execute on function redigir_jsonb(jsonb, text[]) from public, anon, authenticated;

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
