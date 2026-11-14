-- DashMed — funil de resultados do YouTube Seller (David, 14/11/26, seguindo a
-- recomendação "código YT na mão da secretária e funil de resultados").
--
-- Comentários → leads → respondidos → contato (chamou no WhatsApp/ligou com o
-- código) → consulta → tratamento, no total, por vídeo e por procedimento. Uma
-- função security definer: confere o cliente uma vez (com vejo_cliente sem
-- NULL, 0010) em vez de a RLS rodar em cada linha (a lição da 0007).
--
-- Quando um lead conta em cada etapa (o que a tela afirma vem do banco, regra 3):
--   respondido: saiu de "novo" ou tem resposta publicada;
--   contato:    etapa conversando/agendado/tratamento, ou registro de WhatsApp,
--               ligação ou consulta no histórico;
--   consulta:   etapa agendado/tratamento, ou registro de consulta;
--   tratamento: etapa tratamento.
create or replace function funil_youtube(p_cliente uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
begin
  if not vejo_cliente(p_cliente) then
    raise exception 'Sem acesso a este cliente.' using errcode = '42501';
  end if;

  with l as (
    select ld.id, ld.etapa, ld.procedimentos,
      (ld.etapa <> 'novo' or exists (select 1 from yt_comentarios c where c.lead_id = ld.id and c.resposta = 'publicada')) as respondido,
      (ld.etapa in ('conversando', 'agendado', 'tratamento')
        or exists (select 1 from lead_eventos e where e.lead_id = ld.id and e.tipo in ('whatsapp', 'ligacao', 'consulta'))) as contato,
      (ld.etapa in ('agendado', 'tratamento')
        or exists (select 1 from lead_eventos e where e.lead_id = ld.id and e.tipo = 'consulta')) as agendado,
      ld.etapa = 'tratamento' as tratamento
    from leads ld
    where ld.cliente_id = p_cliente and ld.deleted_at is null
  ),
  c as (
    select video_id, video_titulo, lead_id, resposta
    from yt_comentarios
    where cliente_id = p_cliente and deleted_at is null and conversa_de is null
  )
  select jsonb_build_object(
    'totais', (select jsonb_build_object(
        'comentarios', (select count(*) from c),
        'leads', count(*),
        'respondidos', count(*) filter (where respondido),
        'contato', count(*) filter (where contato),
        'agendado', count(*) filter (where agendado),
        'tratamento', count(*) filter (where tratamento),
        'perdidos', count(*) filter (where etapa = 'perdido'))
      from l),
    'por_video', coalesce((select jsonb_agg(x order by (x->>'leads')::int desc, (x->>'comentarios')::int desc) from (
        select jsonb_build_object(
          'video_id', c.video_id, 'titulo', max(c.video_titulo), 'comentarios', count(*),
          'leads', count(distinct c.lead_id), 'respondidos', count(*) filter (where c.resposta = 'publicada'),
          'contato', count(distinct l.id) filter (where l.contato), 'agendado', count(distinct l.id) filter (where l.agendado),
          'tratamento', count(distinct l.id) filter (where l.tratamento)) as x
        from c left join l on l.id = c.lead_id
        group by c.video_id
        order by count(distinct c.lead_id) desc, count(*) desc
        limit 25) t), '[]'::jsonb),
    'por_procedimento', coalesce((select jsonb_agg(x order by (x->>'leads')::int desc) from (
        select jsonb_build_object(
          'procedimento', p, 'leads', count(*), 'contato', count(*) filter (where contato),
          'agendado', count(*) filter (where agendado), 'tratamento', count(*) filter (where tratamento)) as x
        from l, unnest(l.procedimentos) as p
        group by p) t), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke execute on function funil_youtube(uuid) from public, anon;
grant execute on function funil_youtube(uuid) to authenticated;
