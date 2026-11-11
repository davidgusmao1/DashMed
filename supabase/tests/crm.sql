-- Teste do CRM de resgate (migração 0004): ligações, etapas, importação v2 e
-- RLS com dois papéis. Roda numa transação que termina com erro DE PROPÓSITO:
-- o placar vem na mensagem e nada fica gravado.
--
--   npx supabase db query --remote --file supabase/tests/crm.sql
begin;

create temp table resultado (n int, teste text, ok boolean, detalhe text) on commit drop;
grant all on resultado to authenticated, anon;

insert into clientes (id, nome) values ('00000000-0000-4000-8000-0000000000c2', 'Cliente de teste RLS (some no rollback)');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'teste-membro@exemplo.invalid'),
  ('00000000-0000-4000-8000-0000000000b1', 'teste-fora@exemplo.invalid');
insert into usuarios (id, nome, email, cliente_id, papel) values
  ('00000000-0000-4000-8000-0000000000a1', 'Teste secretária', 'teste-membro@exemplo.invalid', '9b765265-4625-43b0-8257-b2fd1de178ef', 'membro'),
  ('00000000-0000-4000-8000-0000000000b1', 'Teste fora', 'teste-fora@exemplo.invalid', '00000000-0000-4000-8000-0000000000c2', 'membro');

-- ── como a secretária do cliente ────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

do $$
declare
  c constant uuid := '9b765265-4625-43b0-8257-b2fd1de178ef';
  r jsonb;
  t record;
  v int;
  atq uuid;
begin
  -- 1ª planilha: paciente só pelo nome (sem nascimento)
  r := importar_planilha(c, 'antiga.xlsx', '{}',
    '[{"linha":2,"paciente":"Paciente Teste Crm","chave":"paciente teste crm","chave_nome":"paciente teste crm","data":"2025-01-10","procedimento":"Outra","original":"Outra","marca":null,"realizado":false}]');
  -- 2ª planilha (Apolo): o mesmo nome agora com nascimento; ATQ candidato, AH aplicado no dia
  r := importar_planilha(c, 'apolo.xlsx', '{"AH": 6}', '[
    {"linha":2,"paciente":"Paciente Teste Crm","chave":"paciente teste crm|1963-03-05","chave_nome":"paciente teste crm","nascimento":"1963-03-05","data":"2025-02-03","procedimento":"ATQ/MAKO","original":"Prótese de quadril","marca":"candidato","realizado":false,"telefone":"11987654321","telefones":"cel 11987654321 · res 1133334444","email":"teste@exemplo.invalid","impressos":"Mako TC protocolo (exame)","observacao":"CANDIDATO; agenda Conversar sobre cirurgia"},
    {"linha":2,"paciente":"Paciente Teste Crm","chave":"paciente teste crm|1963-03-05","chave_nome":"paciente teste crm","nascimento":"1963-03-05","data":"2025-02-03","procedimento":"AH","original":"AH quadril","marca":null,"realizado":true}
  ]');
  select count(*) into v from pacientes where chave_importacao like 'paciente teste crm%';
  insert into resultado values (1, 'mesmo nome com nascimento reaproveita o paciente antigo', v = 1 and r->>'pacientes_novos' = '0', v::text || ' ' || r::text);

  select nascimento, telefone, telefones, email, chave_importacao into t from pacientes where chave_importacao like 'paciente teste crm%';
  insert into resultado values (2, 'paciente ganha nascimento, chave nova, telefones e e-mail',
    t.nascimento = '1963-03-05' and t.chave_importacao = 'paciente teste crm|1963-03-05' and t.telefone = '11987654321'
    and t.telefones like 'cel%res%' and t.email = 'teste@exemplo.invalid', row_to_json(t)::text);

  select situacao, vence_em, revisar, revisar_motivo into t from terapias where procedimento = 'ATQ/MAKO'
    and paciente_id = (select id from pacientes where chave_importacao like 'paciente teste crm%');
  insert into resultado values (3, 'cirurgia candidata: a contatar, sem vencimento, marcada candidato',
    t.situacao = 'a_chamar' and t.vence_em is null and t.revisar and t.revisar_motivo = 'candidato', row_to_json(t)::text);

  select situacao, vence_em into t from terapias where procedimento = 'AH'
    and paciente_id = (select id from pacientes where chave_importacao like 'paciente teste crm%');
  insert into resultado values (4, 'AH aplicado no dia: realizado, vence 6 meses depois', t.situacao = 'realizado' and t.vence_em = '2025-08-03', row_to_json(t)::text);

  select count(*) into v from indicacoes where impressos = 'Mako TC protocolo (exame)' and observacao like 'CANDIDATO%';
  insert into resultado values (5, 'indicação guarda impressos e observação', v = 1, v::text);

  -- reimportar a 1ª planilha com prazo preenche o vencimento que faltava
  r := importar_planilha(c, 'antiga.xlsx', '{"Outra": 3}',
    '[{"linha":2,"paciente":"Paciente Teste Crm","chave":"paciente teste crm","chave_nome":"paciente teste crm","data":"2025-01-10","procedimento":"Outra","original":"Outra","marca":null,"realizado":false}]');
  select count(*) into v from pacientes where chave_importacao like 'paciente teste crm%';
  insert into resultado values (6, 'planilha só com nome depois da com nascimento não duplica o paciente', v = 1 and r->>'pacientes_novos' = '0', v::text || ' ' || r::text);
  select vence_em into t from terapias where procedimento = 'Outra'
    and paciente_id = (select id from pacientes where chave_importacao like 'paciente teste crm%');
  insert into resultado values (20, 'reimportar com prazo preenche o vencimento vazio', t.vence_em = '2025-04-10', coalesce(t.vence_em::text, 'null'));

  -- ligação: registra, move e resume
  select id into atq from terapias where procedimento = 'ATQ/MAKO'
    and paciente_id = (select id from pacientes where chave_importacao like 'paciente teste crm%');
  perform registrar_contato(atq, 'nao_atendeu', '  ', 'tentativa', '2026-11-12');
  perform registrar_contato(atq, 'falou', 'Quer pensar, ligar semana que vem', 'em_conversa', '2026-11-18');
  select situacao, retornar_em, contatos_qtd, ultimo_resultado, situacao_por into t from terapias where id = atq;
  insert into resultado values (7, 'registrar ligação move o cartão, marca retorno e resume (2 ligações)',
    t.situacao = 'em_conversa' and t.retornar_em = '2026-11-18' and t.contatos_qtd = 2 and t.ultimo_resultado = 'falou'
    and t.situacao_por = '00000000-0000-4000-8000-0000000000a1', row_to_json(t)::text);

  select count(*) into v from contatos where terapia_id = atq and feito_por = '00000000-0000-4000-8000-0000000000a1' and (nota is null or nota like 'Quer%');
  insert into resultado values (8, 'ligações gravadas com quem ligou (nota vazia vira nula)', v = 2, v::text);

  begin
    update terapias set contatos_qtd = 99 where id = atq;
    insert into resultado values (9, 'ninguém mexe no resumo de ligações à mão', false, 'o update passou');
  exception when insufficient_privilege then
    insert into resultado values (9, 'ninguém mexe no resumo de ligações à mão', true, sqlerrm);
  end;

  begin
    update contatos set resultado = 'agendou' where terapia_id = atq;
    insert into resultado values (10, 'ligação registrada não se edita', false, 'o update passou');
  exception when insufficient_privilege then
    insert into resultado values (10, 'ligação registrada não se edita', true, sqlerrm);
  end;

  begin
    perform registrar_contato(atq, 'inventado', null, null, null);
    insert into resultado values (11, 'resultado fora da lista é recusado', false, 'passou');
  exception when check_violation then
    insert into resultado values (11, 'resultado fora da lista é recusado', true, sqlerrm);
  end;

  update terapias set responsavel_id = '00000000-0000-4000-8000-0000000000a1' where id = atq;
  get diagnostics v = row_count;
  insert into resultado values (12, 'secretária assume o cartão', v = 1, v::text);

  select count(*) into v from resumo_crm(c) where procedimento = 'ATQ/MAKO';
  insert into resultado values (13, 'resumo do quadro conta por procedimento e etapa', v >= 1, v::text);
end $$;

-- 0005: a etapa automática segue a consulta mais nova, até uma pessoa mexer
do $$
declare
  c constant uuid := '9b765265-4625-43b0-8257-b2fd1de178ef';
  linha_base constant jsonb := '{"paciente":"Paciente Teste Ordem","chave":"paciente teste ordem|1970-01-01","chave_nome":"paciente teste ordem","nascimento":"1970-01-01","procedimento":"AH","original":"AH","marca":null}';
  t record;
  ah uuid;
begin
  perform importar_planilha(c, 'ordem.xlsx', '{"AH": 6}', jsonb_build_array(
    linha_base || '{"linha":2,"data":"2025-03-01","realizado":false}',
    linha_base || '{"linha":3,"data":"2025-05-01","realizado":true}'));
  select id, situacao, situacao_auto into t from terapias where paciente_id = (select id from pacientes where chave_importacao = 'paciente teste ordem|1970-01-01');
  ah := t.id;
  insert into resultado values (21, 'AH indicado e aplicado na consulta seguinte termina Realizado', t.situacao = 'realizado' and t.situacao_auto, row_to_json(t)::text);

  -- a secretária registra uma ligação: dali em diante a importação não mexe
  perform registrar_contato(ah, 'pediu_retorno', null, 'em_conversa', null);
  perform importar_planilha(c, 'ordem2.xlsx', '{"AH": 6}', jsonb_build_array(
    linha_base || '{"linha":2,"data":"2025-09-01","realizado":true}'));
  select situacao, situacao_auto into t from terapias where id = ah;
  insert into resultado values (22, 'depois de uma ligação, a importação não muda a etapa (humano ganha)', t.situacao = 'em_conversa' and not t.situacao_auto, row_to_json(t)::text);

  -- arrastar o cartão também é coisa de pessoa
  update terapias set situacao = 'agendado' where id = (select id from terapias where procedimento = 'Outra'
    and paciente_id = (select id from pacientes where chave_importacao like 'paciente teste crm%'));
  select situacao_auto into t from terapias where procedimento = 'Outra'
    and paciente_id = (select id from pacientes where chave_importacao like 'paciente teste crm%');
  insert into resultado values (23, 'arrastar o cartão marca a etapa como decidida por pessoa', not t.situacao_auto, row_to_json(t)::text);

  insert into resultado values (24, 'a marca de importação não vaza para fora da importação',
    coalesce(current_setting('dashmed.importando', true), '') = '', coalesce(current_setting('dashmed.importando', true), 'null'));
end $$;

-- ── como alguém de outro cliente ────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}';

do $$
declare
  c constant uuid := '9b765265-4625-43b0-8257-b2fd1de178ef';
  v int;
  atq uuid;
begin
  select count(*) into v from contatos;
  insert into resultado values (14, 'de fora: vê 0 ligações', v = 0, v::text);
  select count(*) into v from resumo_crm(c);
  insert into resultado values (15, 'de fora: resumo do quadro vem vazio', v = 0, v::text);
  -- o id da terapia vazou de algum jeito: mesmo assim não registra
  reset role;
  select t.id into atq from terapias t join pacientes p on p.id = t.paciente_id
   where p.chave_importacao like 'paciente teste crm%' and t.procedimento = 'ATQ/MAKO';
  set local role authenticated;
  begin
    perform registrar_contato(atq, 'agendou', null, 'agendado', null);
    insert into resultado values (16, 'de fora: não registra ligação no cartão dos outros', false, 'passou');
  exception when insufficient_privilege then
    insert into resultado values (16, 'de fora: não registra ligação no cartão dos outros', true, sqlerrm);
  end;
  begin
    insert into contatos (cliente_id, terapia_id, resultado) values (c, atq, 'agendou');
    insert into resultado values (17, 'de fora: não insere ligação direto na tabela', false, 'passou');
  exception when insufficient_privilege then
    insert into resultado values (17, 'de fora: não insere ligação direto na tabela', true, sqlerrm);
  end;
end $$;

-- ── visitante sem login ─────────────────────────────────────────────────
set local role anon;
do $$
begin
  perform count(*) from contatos;
  insert into resultado values (18, 'anônimo: sem acesso a ligações', false, 'leu');
exception when insufficient_privilege then
  insert into resultado values (18, 'anônimo: sem acesso a ligações', true, sqlerrm);
end $$;

-- ── como o banco: auditoria das ligações ────────────────────────────────
reset role;
do $$
declare v int;
begin
  select count(*) into v from auditoria where tabela = 'contatos' and usuario_id = '00000000-0000-4000-8000-0000000000a1';
  -- 2 ligações no bloco do resgate + 1 no bloco da etapa automática (teste 22)
  insert into resultado values (19, 'auditoria registra as ligações e quem fez', v = 3, v::text);
end $$;

-- placar e desfaz tudo (a mensagem de erro volta cortada perto de mil caracteres)
do $$
declare
  certos int;
  total int;
  falhas text;
begin
  select count(*) filter (where ok), count(*),
         string_agg(format('%s FALHOU — %s [%s]', n, teste, left(detalhe, 100)), E'\n' order by n) filter (where not ok)
    into certos, total, falhas
    from resultado;
  raise exception E'RESULTADO DO TESTE (tudo desfeito): % de % OK\n%', certos, total, coalesce(falhas, 'nenhuma falha');
end $$;
rollback;
