-- DashMed — busca de comentários do YouTube Seller por frase (David, 15/11/26:
-- "um campo de busca com uma lupinha, onde eu vou escrever para buscar
-- comentários específicos ... da minha última quarta ... da semana passada que
-- contenha pedido sobre prótese, sobre dor ... posso usar tempo, posso usar
-- vários critérios"). Número 0020 cedido pela sessão "DM - Pacientes".
--
-- A IA (edge youtube-responder, ação "buscar") traduz a frase em critérios
-- (jsonb); esta função aplica os critérios. Quem decide o que é achado é o
-- banco, não a IA, e a tela mostra os critérios para o médico conferir e tirar.
--
-- Segurança (combinado com "DM - Pacientes"): security definer para conferir
-- vejo_cliente uma vez (a lição da 0007), e por isso toda leitura filtra
-- cliente_id = p_cliente e deleted_at is null, inclusive o join com leads.
-- Nada de SQL dinâmico: os termos viram expressão regular só com letras,
-- números e espaços (padrao_busca), e trecho de título ou nome é comparado com
-- strpos (sem curinga de like para escapar). Limite e paginação aqui dentro
-- (o PostgREST corta em 1.000 linhas); a contagem é consulta separada.

-- minúsculas e sem acento: "Prótese" e "protese" são a mesma palavra na busca
create or replace function normalizar_busca(p text) returns text
language sql immutable set search_path = public as $$
  select translate(lower(coalesce(p, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')
$$;

-- termo → expressão regular de palavra inteira; "infiltr*" pega as terminações.
-- Só sobram letras, números e espaços: nada do que foi digitado vira operador.
-- Termo com menos de 2 letras não busca (pegaria tudo).
create or replace function padrao_busca(p_termo text) returns text
language sql immutable set search_path = public as $$
  select case when length(t) < 2 then null
    else '\m' || regexp_replace(t, ' +', '[[:space:]]+', 'g') || case when prefixo then '' else '\M' end end
  from (select btrim(regexp_replace(normalizar_busca(p_termo), '[^a-z0-9]+', ' ', 'g')) as t,
               btrim(coalesce(p_termo, '')) like '%*' as prefixo) x
$$;

-- lista de textos de um jsonb (o que não for lista vira lista vazia)
create or replace function lista_de_textos(p jsonb) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end)), '{}')
$$;

revoke execute on function normalizar_busca(text) from public, anon;
revoke execute on function padrao_busca(text) from public, anon;
revoke execute on function lista_de_textos(jsonb) from public, anon;
grant execute on function normalizar_busca(text), padrao_busca(text), lista_de_textos(jsonb) to authenticated;

-- Critérios (p_filtro), todos opcionais:
--   de, ate            datas AAAA-MM-DD, horário de Brasília, inclusive
--   grupos             [{termos: [...], procedimentos: [...]}]: um assunto por grupo;
--                      o grupo bate se o texto (ou o resumo da IA) tem um dos termos
--                      ou a triagem marcou um dos procedimentos
--   todos              true: todos os grupos no mesmo comentário; false: qualquer um
--   sem                termos que não podem aparecer
--   categorias         categorias da triagem
--   videos             ids de vídeo; video_titulo: trecho do título (um ou outro)
--   autor              trecho do nome de quem comentou
--   urgente, lead, conversa   true / false
--   situacao           fila, respondido, sem_resposta, ignorado
--   probabilidade_min, consulta_min, consulta_max, cirurgia_min, cirurgia_max,
--   socio_min, socio_max      0 a 100 (comentário ainda sem a porcentagem fica de fora)
--   ordem              recentes (padrão), antigos, probabilidade, consulta, cirurgia, socio, curtidas
create or replace function buscar_comentarios(p_cliente uuid, p_filtro jsonb, p_limite int default 50, p_pular int default 0)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  f jsonb := case when jsonb_typeof(p_filtro) = 'object' then p_filtro else '{}'::jsonb end;
  v_de timestamptz;
  v_ate timestamptz;
  v_cats text[] := lista_de_textos(f->'categorias');
  v_vids text[] := lista_de_textos(f->'videos');
  v_sit text[] := lista_de_textos(f->'situacao');
  v_vtit text := normalizar_busca(f->>'video_titulo');
  v_autor text := normalizar_busca(f->>'autor');
  v_urg boolean := case f->>'urgente' when 'true' then true when 'false' then false end;
  v_lead boolean := case f->>'lead' when 'true' then true when 'false' then false end;
  v_conv boolean := case f->>'conversa' when 'true' then true when 'false' then false end;
  v_todos boolean := coalesce(f->>'todos', '') = 'true';
  v_ordem text := coalesce(f->>'ordem', 'recentes');
  v_prob_min int; v_cons_min int; v_cons_max int; v_cir_min int; v_cir_max int; v_soc_min int; v_soc_max int;
  v_grupos jsonb;
  v_sem text;
  v_limite int := least(greatest(coalesce(p_limite, 50), 1), 100);
  v_pular int := least(greatest(coalesce(p_pular, 0), 0), 10000);
  v_total int;
  v_itens jsonb;
begin
  if not coalesce(vejo_cliente(p_cliente), false) then
    raise exception 'Sem acesso a este cliente.' using errcode = '42501';
  end if;

  begin
    v_de := (nullif(f->>'de', '')::date)::timestamp at time zone 'America/Sao_Paulo';
    v_ate := ((nullif(f->>'ate', '')::date) + 1)::timestamp at time zone 'America/Sao_Paulo';
  exception when others then
    raise exception 'Data inválida na busca (use AAAA-MM-DD).' using errcode = '22007';
  end;

  -- número de 0 a 100 ou nada
  select (case when f->>'probabilidade_min' ~ '^\d{1,3}$' then (f->>'probabilidade_min')::int end),
         (case when f->>'consulta_min' ~ '^\d{1,3}$' then (f->>'consulta_min')::int end),
         (case when f->>'consulta_max' ~ '^\d{1,3}$' then (f->>'consulta_max')::int end),
         (case when f->>'cirurgia_min' ~ '^\d{1,3}$' then (f->>'cirurgia_min')::int end),
         (case when f->>'cirurgia_max' ~ '^\d{1,3}$' then (f->>'cirurgia_max')::int end),
         (case when f->>'socio_min' ~ '^\d{1,3}$' then (f->>'socio_min')::int end),
         (case when f->>'socio_max' ~ '^\d{1,3}$' then (f->>'socio_max')::int end)
    into v_prob_min, v_cons_min, v_cons_max, v_cir_min, v_cir_max, v_soc_min, v_soc_max;

  -- cada grupo vira {rx: termos numa expressão só, procs: procedimentos}; grupo
  -- vazio sai. Grupo com termos que não sobram (só símbolos) não acha nada
  -- ('a^' nunca bate), em vez de sumir e alargar a busca.
  select coalesce(jsonb_agg(jsonb_build_object('rx', coalesce(rx, case when cardinality(termos) > 0 then 'a^' end), 'procs', to_jsonb(procs))), '[]'::jsonb)
    into v_grupos
  from (
    select (select string_agg(p, '|') from (select padrao_busca(t) as p from unnest(lista_de_textos(g->'termos')) t) x where p is not null) as rx,
           lista_de_textos(g->'termos') as termos,
           lista_de_textos(g->'procedimentos') as procs
    from jsonb_array_elements(case when jsonb_typeof(f->'grupos') = 'array' then f->'grupos' else '[]'::jsonb end) g
  ) y
  where cardinality(termos) > 0 or cardinality(procs) > 0;

  select string_agg(p, '|') into v_sem
  from (select padrao_busca(t) as p from unnest(lista_de_textos(f->'sem')) t) x where p is not null;

  -- uma consulta só: "achados" é calculado uma vez e serve à contagem (sem
  -- limite) e à página (com limite)
  with achados as (
    select c.id, c.publicado_em, c.probabilidade, c.consulta_pct, c.cirurgia_pct, c.socio_pct, c.curtidas
    from yt_comentarios c
    cross join lateral (select normalizar_busca(c.texto || ' ' || coalesce(c.resumo, '')) as alvo) a
    where c.cliente_id = p_cliente and c.deleted_at is null
      and (v_de is null or c.publicado_em >= v_de)
      and (v_ate is null or c.publicado_em < v_ate)
      and (cardinality(v_cats) = 0 or c.categoria = any(v_cats))
      and ((cardinality(v_vids) = 0 and v_vtit = '')
           or c.video_id = any(v_vids)
           or (v_vtit <> '' and strpos(normalizar_busca(c.video_titulo), v_vtit) > 0))
      and (v_autor = '' or strpos(normalizar_busca(c.autor_nome), v_autor) > 0)
      and (v_urg is null or c.urgente = v_urg)
      and (v_lead is null or (c.lead_id is not null) = v_lead)
      and (v_conv is null or (c.conversa_de is not null) = v_conv)
      and (cardinality(v_sit) = 0
           or ('fila' = any(v_sit) and c.resposta in ('redigir', 'rascunho', 'falhou', 'publicando'))
           or ('respondido' = any(v_sit) and (c.resposta = 'publicada' or c.ja_respondido))
           or ('sem_resposta' = any(v_sit) and c.resposta = 'nenhuma' and not c.ja_respondido)
           or ('ignorado' = any(v_sit) and c.resposta = 'ignorada'))
      and (v_prob_min is null or c.probabilidade >= v_prob_min)
      and (v_cons_min is null or c.consulta_pct >= v_cons_min)
      and (v_cons_max is null or c.consulta_pct <= v_cons_max)
      and (v_cir_min is null or c.cirurgia_pct >= v_cir_min)
      and (v_cir_max is null or c.cirurgia_pct <= v_cir_max)
      and (v_soc_min is null or c.socio_pct >= v_soc_min)
      and (v_soc_max is null or c.socio_pct <= v_soc_max)
      and (jsonb_array_length(v_grupos) = 0
           or case when v_todos
             then not exists (select 1 from jsonb_array_elements(v_grupos) g
                              where not ((g->>'rx' is not null and a.alvo ~ (g->>'rx'))
                                         or c.procedimentos && lista_de_textos(g->'procs')))
             else exists (select 1 from jsonb_array_elements(v_grupos) g
                          where (g->>'rx' is not null and a.alvo ~ (g->>'rx'))
                             or c.procedimentos && lista_de_textos(g->'procs'))
           end)
      and (v_sem is null or not a.alvo ~ v_sem)
  ),
  pagina as (
    select o.id, o.ordem from (
      select id, row_number() over (order by
               case when v_ordem = 'antigos' then publicado_em end asc,
               case v_ordem when 'probabilidade' then probabilidade when 'consulta' then consulta_pct
                            when 'cirurgia' then cirurgia_pct when 'socio' then socio_pct when 'curtidas' then curtidas end desc nulls last,
               publicado_em desc, id) as ordem
      from achados
    ) o
    where o.ordem > v_pular and o.ordem <= v_pular + v_limite
  )
  select (select count(*) from achados),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', c.id, 'comentario_id', c.comentario_id, 'video_id', c.video_id, 'video_titulo', c.video_titulo,
                    'autor_nome', c.autor_nome, 'texto', c.texto, 'resumo', c.resumo, 'publicado_em', c.publicado_em,
                    'curtidas', c.curtidas, 'triagem', c.triagem, 'probabilidade', c.probabilidade, 'categoria', c.categoria,
                    'procedimentos', to_jsonb(c.procedimentos), 'urgente', c.urgente, 'resposta', c.resposta,
                    'ja_respondido', c.ja_respondido, 'lead_id', c.lead_id, 'conversa_de', c.conversa_de,
                    'consulta_pct', c.consulta_pct, 'cirurgia_pct', c.cirurgia_pct, 'socio_pct', c.socio_pct,
                    'socio_motivo', c.socio_motivo, 'codigo', l.codigo) order by p.ordem)
           from pagina p
           join yt_comentarios c on c.id = p.id and c.cliente_id = p_cliente and c.deleted_at is null
           left join leads l on l.id = c.lead_id and l.cliente_id = p_cliente and l.deleted_at is null
         ), '[]'::jsonb)
    into v_total, v_itens;

  return jsonb_build_object('total', v_total, 'itens', v_itens);
end $$;
revoke execute on function buscar_comentarios(uuid, jsonb, int, int) from public, anon;
grant execute on function buscar_comentarios(uuid, jsonb, int, int) to authenticated;
