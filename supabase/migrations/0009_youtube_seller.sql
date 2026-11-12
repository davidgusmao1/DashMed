-- DashMed — YouTube Seller (David, 12/11/26: "uma aba nova no menu da
-- esquerda ... um bot ... vai pegar os comentários do YouTube que tenham maior
-- probabilidade de marcar consulta e realizar algum procedimento ... começando
-- pelos comentários mais recentes aos mais antigos ... fazer uma resposta para o
-- que o paciente perguntou e oferecer ... telemedicina, presencial em Porto
-- Alegre, ou presencial em São Paulo, ou ... uma estimativa de custo ... com um
-- telefone específico ... montando um acompanhamento de um CRM ... um social
-- seller automatizado").
--
-- Regras de fora que moldam o desenho (consultadas em 12/11/26):
-- - Políticas da API do YouTube: o app não pode comentar "sem o consentimento
--   prévio, específico e expresso" do usuário, que tem a "autoridade final"
--   sobre o que é publicado. Por isso a IA LÊ, TRIA e REDIGE sozinha, e o
--   médico PUBLICA com um clique (regra 4).
-- - Política de spam do YouTube: nada de comentário repetitivo ou em massa —
--   cada resposta é escrita para aquele comentário, e há limite diário.
-- - CFM 2.336/2023: pode informar como marcar consulta (inclusive virtual) e
--   que o valor do procedimento é combinado antes do atendimento; não pode
--   substituir a consulta, dar juízo de diagnóstico ou prognóstico individual
--   nem prometer resultado.
-- - LGPD: interesse em tratamento é dado de saúde. Só entra o que a pessoa
--   publicou no canal do médico; lead e eventos têm RLS e auditoria.
--
-- Fluxo: canal conectado (OAuth do Google) → varredura (lê do mais novo ao
-- mais antigo) → triagem pela IA (probabilidade, procedimento, urgência) →
-- lead no CRM → rascunho da resposta → médico revisa e publica → o CRM
-- acompanha (etapas, anotações, WhatsApp, consulta).

-- ── provedores novos nas chaves de API ───────────────────────────────────
-- google: client secret do OAuth (o client id fica em parametros);
-- youtube: o refresh token do canal conectado (parametros: canal).
alter table integracoes drop constraint integracoes_provedor_check;
alter table integracoes add constraint integracoes_provedor_check
  check (provedor in ('anthropic', 'heygen', 'google', 'youtube'));

-- ── configuração do vendedor ────────────────────────────────────────────
create table seller_config (
  cliente_id uuid primary key references clientes(id),
  -- varredura automática de hora em hora (a publicação é sempre manual)
  automatico boolean not null default false,
  procedimentos text[] not null default array[
    'Prótese de quadril', 'Videoartroscopia de quadril', 'Cirurgia para osteonecrose',
    'Ácido hialurônico', 'Hidrogel bioativo', 'Plasma rico em plaquetas (PRP)', 'Concentrado de células'],
  -- como a resposta oferece cada caminho (texto livre, com telefone/endereço)
  telemedicina text not null default '',
  porto_alegre text not null default '',
  sao_paulo text not null default '',
  -- telefone/WhatsApp para estimativa de custo de terapia
  telefone_estimativa text not null default '',
  instrucoes text not null default '',
  -- a partir de quanto a IA considera lead e escreve a resposta
  prob_minima int not null default 40 check (prob_minima between 0 and 100),
  -- respostas publicadas por dia (cota da API e política de spam)
  limite_diario int not null default 40 check (limite_diario between 1 and 150),
  atualizado_por uuid references usuarios(id) default auth.uid(),
  atualizado_em timestamptz not null default now()
);
create trigger seller_config_atualizado before update on seller_config
  for each row execute function tocar_atualizado_em();
alter table seller_config enable row level security;
create policy seller_config_ler on seller_config for select to authenticated
  using (vejo_cliente(cliente_id));
create policy seller_config_criar on seller_config for insert to authenticated
  with check (administro_cliente(cliente_id));
create policy seller_config_mudar on seller_config for update to authenticated
  using (administro_cliente(cliente_id)) with check (administro_cliente(cliente_id));
revoke all on seller_config from anon;
revoke delete on seller_config from authenticated;

-- ── estado do OAuth (ida e volta do Google) ─────────────────────────────
-- Só as edge functions leem/escrevem. Vale 15 minutos e uma vez só.
create table oauth_estados (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  usuario_id uuid not null references usuarios(id),
  provedor text not null check (provedor in ('youtube')),
  retorno text not null,
  criado_em timestamptz not null default now(),
  usado_em timestamptz
);
alter table oauth_estados enable row level security;
revoke all on oauth_estados from anon, authenticated;

-- ── varredura do canal (uma por cliente) ────────────────────────────────
create table yt_varreduras (
  cliente_id uuid primary key references clientes(id),
  canal_id text,
  estado text not null default 'parada' check (estado in ('parada', 'rodando', 'erro')),
  passo text,
  passos int not null default 0,
  msg text,
  iniciada_em timestamptz,
  terminada_em timestamptz,
  atualizado_em timestamptz not null default now(),
  -- o comentário mais novo já lido (a próxima leitura para nele)
  mais_novo_em timestamptz,
  -- a página seguinte para trás no tempo e até onde o histórico já foi
  historico_token text,
  historico_ate timestamptz,
  historico_completo boolean not null default false,
  lidos_total int not null default 0
);
create trigger yt_varreduras_atualizado before update on yt_varreduras
  for each row execute function tocar_atualizado_em();
alter table yt_varreduras enable row level security;
create policy yt_varreduras_ler on yt_varreduras for select to authenticated
  using (vejo_cliente(cliente_id));
revoke all on yt_varreduras from anon;
revoke insert, update, delete on yt_varreduras from authenticated;

-- ── cota da API do YouTube (10.000 unidades por dia, por projeto Google) ──
-- O dia da cota vira à meia-noite do Pacífico. Ler uma página = 1, responder = 50.
create table yt_cota (
  cliente_id uuid not null references clientes(id),
  dia date not null,
  unidades int not null default 0,
  primary key (cliente_id, dia)
);
alter table yt_cota enable row level security;
create policy yt_cota_ler on yt_cota for select to authenticated using (vejo_cliente(cliente_id));
revoke all on yt_cota from anon;
revoke insert, update, delete on yt_cota from authenticated;

-- Reserva unidades antes de chamar a API; recusa se passar do teto (folga
-- de 1.000 sobre os 10.000 do Google). Atômica: duas chamadas não estouram.
create or replace function gastar_cota_youtube(p_cliente uuid, p_unidades int) returns boolean
language sql security definer set search_path = public as $$
  with dia as (select (now() at time zone 'America/Los_Angeles')::date d),
  ins as (
    insert into yt_cota (cliente_id, dia, unidades)
    select p_cliente, d, p_unidades from dia
    where p_unidades <= 9000
    on conflict (cliente_id, dia) do update set unidades = yt_cota.unidades + excluded.unidades
      where yt_cota.unidades + excluded.unidades <= 9000
    returning 1)
  select exists (select 1 from ins)
$$;
revoke execute on function gastar_cota_youtube(uuid, int) from public, anon, authenticated;
grant execute on function gastar_cota_youtube(uuid, int) to service_role;

-- ── leads (o CRM do YouTube Seller) ─────────────────────────────────────
-- Um lead por pessoa (canal do YouTube que comentou). Não é paciente ainda:
-- quando vira, liga-se ao cadastro da Agenda/CRM (paciente_id).
create table leads (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  origem text not null default 'youtube' check (origem in ('youtube')),
  autor_canal_id text,
  nome text not null,
  foto_url text,
  -- vai na resposta ("informe o código YT1234"): quem chamar no WhatsApp
  -- diz o código e a equipe sabe de que comentário veio
  codigo text not null,
  etapa text not null default 'novo'
    check (etapa in ('novo', 'respondido', 'conversando', 'agendado', 'tratamento', 'perdido')),
  etapa_em timestamptz not null default now(),
  probabilidade int not null default 0 check (probabilidade between 0 and 100),
  procedimentos text[] not null default '{}',
  local_interesse text check (local_interesse in ('telemedicina', 'porto_alegre', 'sao_paulo')),
  telefone text,
  notas text not null default '',
  proximo_passo_em date,
  responsavel_id uuid references usuarios(id),
  paciente_id uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, cliente_id),
  foreign key (paciente_id, cliente_id) references pacientes (id, cliente_id)
);
-- uma pessoa = um lead; um código não se repete no cliente (regra 1)
create unique index leads_autor_unico on leads (cliente_id, autor_canal_id)
  where deleted_at is null and autor_canal_id is not null;
create unique index leads_codigo_unico on leads (cliente_id, codigo);
create index leads_cliente_etapa_idx on leads (cliente_id, etapa, probabilidade desc) where deleted_at is null;

create or replace function leads_ao_mudar() returns trigger
language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  if new.etapa is distinct from old.etapa then
    new.etapa_em := now();
  end if;
  return new;
end $$;
create trigger leads_mudar before update on leads for each row execute function leads_ao_mudar();
create trigger leads_auditoria after insert or update or delete on leads for each row execute function auditar();

alter table leads enable row level security;
create policy leads_ler on leads for select to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id));
create policy leads_mudar on leads for update to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id)) with check (vejo_cliente(cliente_id));
revoke all on leads from anon;
revoke insert, update, delete on leads from authenticated;
-- a equipe mexe no acompanhamento; origem, código e o que veio do YouTube são do robô
grant update (etapa, local_interesse, telefone, notas, proximo_passo_em, responsavel_id, paciente_id) on leads to authenticated;

-- ── histórico do lead (sem edição: é o registro do que aconteceu) ───────
create table lead_eventos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  lead_id uuid not null,
  tipo text not null check (tipo in ('comentario', 'resposta', 'etapa', 'nota', 'whatsapp', 'ligacao', 'consulta')),
  texto text not null default '' check (length(texto) <= 4000),
  comentario_id uuid,
  feito_por uuid references usuarios(id) default auth.uid(),
  feito_em timestamptz not null default now(),
  foreign key (lead_id, cliente_id) references leads (id, cliente_id)
);
create index lead_eventos_lead_idx on lead_eventos (lead_id, feito_em desc);
create trigger lead_eventos_auditoria after insert or update or delete on lead_eventos for each row execute function auditar();
alter table lead_eventos enable row level security;
create policy lead_eventos_ler on lead_eventos for select to authenticated using (vejo_cliente(cliente_id));
-- a equipe registra contato e anotação; comentário, resposta e etapa são do sistema
create policy lead_eventos_registrar on lead_eventos for insert to authenticated
  with check (vejo_cliente(cliente_id) and tipo in ('nota', 'whatsapp', 'ligacao', 'consulta'));
revoke all on lead_eventos from anon;
revoke update, delete on lead_eventos from authenticated;

-- a mudança de etapa entra no histórico sozinha (quem mudou: auth.uid(); o
-- robô fica sem autor)
create or replace function leads_registrar_etapa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into lead_eventos (cliente_id, lead_id, tipo, texto, feito_por)
  values (new.cliente_id, new.id, 'etapa', old.etapa || ' → ' || new.etapa, auth.uid());
  return new;
end $$;
revoke execute on function leads_registrar_etapa() from public, anon, authenticated;
create trigger leads_etapa_historico after update of etapa on leads
  for each row when (new.etapa is distinct from old.etapa) execute function leads_registrar_etapa();

-- Cria ou atualiza o lead de quem comentou, numa transação: uma pessoa, um
-- lead; probabilidade guarda a maior; procedimentos somam. Só o robô chama.
create or replace function garantir_lead(
  p_cliente uuid, p_autor text, p_nome text, p_foto text, p_prob int, p_procs text[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_codigo text;
begin
  for tentativa in 1..20 loop
    select id into v_id from leads
     where cliente_id = p_cliente and autor_canal_id = p_autor and deleted_at is null;
    if v_id is not null then
      update leads set
        nome = coalesce(nullif(btrim(p_nome), ''), nome),
        foto_url = coalesce(p_foto, foto_url),
        probabilidade = greatest(probabilidade, coalesce(p_prob, 0)),
        procedimentos = (select coalesce(array_agg(distinct x order by x), '{}') from unnest(procedimentos || coalesce(p_procs, '{}')) x)
      where id = v_id;
      return v_id;
    end if;
    v_codigo := 'YT' || lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
    begin
      insert into leads (cliente_id, autor_canal_id, nome, foto_url, codigo, probabilidade, procedimentos)
      values (p_cliente, p_autor, coalesce(nullif(btrim(p_nome), ''), 'Sem nome'), p_foto, v_codigo,
              least(100, greatest(0, coalesce(p_prob, 0))), coalesce(p_procs, '{}'))
      returning id into v_id;
      return v_id;
    exception when unique_violation then
      -- código repetido ou a mesma pessoa criada agora por outra varredura:
      -- volta ao começo (relê o lead ou sorteia outro código)
      null;
    end;
  end loop;
  raise exception 'Não consegui criar o lead depois de 20 tentativas.';
end $$;
revoke execute on function garantir_lead(uuid, text, text, text, int, text[]) from public, anon, authenticated;
grant execute on function garantir_lead(uuid, text, text, text, int, text[]) to service_role;

-- ── comentários lidos do canal ──────────────────────────────────────────
create table yt_comentarios (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  canal_id text not null,
  thread_id text not null,
  -- id do comentário de topo no YouTube (é o parentId da resposta)
  comentario_id text not null,
  video_id text not null,
  video_titulo text,
  autor_nome text not null,
  autor_canal_id text,
  autor_foto_url text,
  texto text not null,
  publicado_em timestamptz not null,
  curtidas int not null default 0,
  respostas_qtd int not null default 0,
  -- o canal do médico já respondeu (no YouTube): o robô não responde por cima
  ja_respondido boolean not null default false,
  pode_responder boolean not null default true,
  -- triagem pela IA
  triagem text not null default 'pendente' check (triagem in ('pendente', 'feita', 'erro')),
  probabilidade int check (probabilidade between 0 and 100),
  categoria text,
  procedimentos text[] not null default '{}',
  urgente boolean not null default false,
  resumo text,
  triado_em timestamptz,
  -- resposta: redigir (a IA vai escrever) → rascunho → publicando → publicada
  resposta text not null default 'nenhuma'
    check (resposta in ('nenhuma', 'redigir', 'rascunho', 'publicando', 'publicada', 'falhou', 'ignorada')),
  rascunho text,
  rascunho_editado boolean not null default false,
  resposta_msg text,
  resposta_youtube_id text,
  publicada_em timestamptz,
  publicada_por uuid references usuarios(id),
  lead_id uuid,
  lido_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (lead_id, cliente_id) references leads (id, cliente_id),
  -- o mesmo comentário uma vez só (regra 1): reler o canal não duplica
  unique (cliente_id, thread_id)
);
create index yt_comentarios_pendentes_idx on yt_comentarios (cliente_id, publicado_em desc) where triagem = 'pendente';
create index yt_comentarios_fila_idx on yt_comentarios (cliente_id, resposta, probabilidade desc, publicado_em desc) where deleted_at is null;
create index yt_comentarios_data_idx on yt_comentarios (cliente_id, publicado_em desc) where deleted_at is null;
create index yt_comentarios_lead_idx on yt_comentarios (lead_id) where lead_id is not null;
create trigger yt_comentarios_atualizado before update on yt_comentarios
  for each row execute function tocar_atualizado_em();
alter table yt_comentarios enable row level security;
create policy yt_comentarios_ler on yt_comentarios for select to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id));
-- o médico edita o rascunho e ignora ou volta atrás; publicar é só pela edge
-- (que tem o token do canal e confere tudo antes)
create policy yt_comentarios_revisar on yt_comentarios for update to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id))
  with check (vejo_cliente(cliente_id) and resposta in ('rascunho', 'ignorada'));
revoke all on yt_comentarios from anon;
revoke insert, update, delete on yt_comentarios from authenticated;
grant update (rascunho, rascunho_editado, resposta) on yt_comentarios to authenticated;

-- Números da tela numa consulta só (security definer: confere o cliente uma
-- vez em vez de a RLS rodar em cada linha — a lição da 0007).
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
    'cota_hoje', (select coalesce(sum(unidades), 0) from yt_cota where cliente_id = p_cliente and dia = (now() at time zone 'America/Los_Angeles')::date)
  );
end $$;
revoke execute on function resumo_youtube(uuid) from public, anon;
grant execute on function resumo_youtube(uuid) to authenticated;

-- ── vigia: invariantes novas (regra 5) ──────────────────────────────────
create or replace function vigiar() returns void
language plpgsql security definer set search_path = public as $$
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

  -- OAuth: estado de ida e volta não serve depois de 15 minutos
  delete from oauth_estados where criado_em < now() - interval '1 day';
end $$;
revoke execute on function vigiar() from public, anon, authenticated;

-- ── varredura automática de hora em hora ────────────────────────────────
-- O pg_cron chama a edge youtube-varrer com um token próprio (guardado no
-- Vault como "dashmed:cron" e no ambiente da edge como DASHMED_CRON_TOKEN;
-- não é a chave de serviço). Sem o token, o vigia de achados registra.
create extension if not exists pg_net;

create or replace function disparar_youtube() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_token text;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'dashmed:cron';
  if v_token is null then
    insert into achados (regra, alvo_tabela, alvo_id, detalhe)
    values ('youtube_cron_sem_token', 'yt_varreduras', '00000000-0000-0000-0000-000000000000',
            'O token do cron (dashmed:cron) não está no Vault: a varredura automática do YouTube não roda.')
    on conflict (regra, alvo_id) where fechado_em is null do nothing;
    return;
  end if;
  update achados set fechado_em = now() where regra = 'youtube_cron_sem_token' and fechado_em is null;
  perform net.http_post(
    url := 'https://yjwhhkzqmsouvnryiwde.supabase.co/functions/v1/youtube-varrer',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dashmed-cron', v_token),
    body := '{"acao":"cron"}'::jsonb
  );
end $$;
revoke execute on function disparar_youtube() from public, anon, authenticated;

select cron.schedule('dashmed-youtube', '7 * * * *', $$select public.disparar_youtube()$$);
