-- Teste da Agenda (migração 0003): RLS com dois papéis (HANDOFF 5.2, item 7)
-- e as regras da importação. Roda numa transação que termina com erro DE
-- PROPÓSITO: o resultado vem na mensagem do erro e nada fica gravado.
--
--   npx supabase db query --remote --file supabase/tests/agenda.sql
--
-- Usuários e cliente de teste são criados e somem com o rollback.
begin;

create temp table resultado (n int, teste text, ok boolean, detalhe text) on commit drop;
grant all on resultado to authenticated, anon;

-- um membro comum do cliente David Gusmão e uma pessoa de outro cliente
insert into clientes (id, nome) values ('00000000-0000-4000-8000-0000000000c2', 'Cliente de teste RLS (some no rollback)');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'teste-membro@exemplo.invalid'),
  ('00000000-0000-4000-8000-0000000000b1', 'teste-fora@exemplo.invalid');
insert into usuarios (id, nome, email, cliente_id, papel) values
  ('00000000-0000-4000-8000-0000000000a1', 'Teste membro', 'teste-membro@exemplo.invalid', '9b765265-4625-43b0-8257-b2fd1de178ef', 'membro'),
  ('00000000-0000-4000-8000-0000000000b1', 'Teste fora', 'teste-fora@exemplo.invalid', '00000000-0000-4000-8000-0000000000c2', 'membro');

-- ── como o membro do cliente ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

do $$
declare
  c constant uuid := '9b765265-4625-43b0-8257-b2fd1de178ef';
  linhas constant jsonb := '[
    {"linha":2,"paciente":"Paciente Teste Um","chave":"paciente teste um","data":"2026-08-03","horario":"08:00","tipo":"1ª consulta","procedimento":"AH","marca":null,"original":"AH","nota":"nota 1","telefone":null,"vencimento":null},
    {"linha":3,"paciente":"Paciente Teste Dois","chave":"paciente teste dois","data":"2026-08-05","horario":null,"tipo":null,"procedimento":"Prótese/ATQ","marca":"incerto","original":"Prótese/ATQ (incerto)","nota":null,"telefone":"11987654321","vencimento":null},
    {"linha":4,"paciente":"Paciente Teste Um","chave":"paciente teste um","data":"2026-10-01","horario":null,"tipo":"Retorno","procedimento":"AH","marca":null,"original":"AH","nota":"nota 2","telefone":null,"vencimento":null}
  ]';
  prazos constant jsonb := '{"AH": 6, "Prótese/ATQ": 0}';
  r jsonb;
  d date;
  v int;
begin
  r := importar_planilha(c, 'teste.xlsx', prazos, linhas, '[{"linha":5,"motivo":"data inválida ou vazia"}]');
  insert into resultado values (1, 'importação: contadores (2 pacientes, 2 terapias, 3 indicações, 1 revisar, 1 erro)',
    r->>'pacientes_novos' = '2' and r->>'terapias_novas' = '2' and r->>'indicacoes_novas' = '3'
    and r->>'ja_existiam' = '0' and r->>'para_revisar' = '1' and r->>'com_erro' = '1', r::text);

  select t.vence_em into d from terapias t join pacientes p on p.id = t.paciente_id where p.chave_importacao = 'paciente teste um';
  insert into resultado values (2, 'paciente em agosto e outubro = uma terapia, vence 6 meses após outubro', d = '2027-04-01', coalesce(d::text, 'null'));

  select count(*) into v from terapias where cliente_id = c and procedimento in ('AH', 'Prótese/ATQ')
    and paciente_id in (select id from pacientes where chave_importacao like 'paciente teste%');
  insert into resultado values (3, 'membro do cliente vê as terapias do cliente', v = 2, v::text);

  r := importar_planilha(c, 'teste.xlsx', prazos, linhas, '[]');
  insert into resultado values (4, 'reimportar a mesma planilha não duplica nada',
    r->>'pacientes_novos' = '0' and r->>'terapias_novas' = '0' and r->>'indicacoes_novas' = '0' and r->>'ja_existiam' = '3', r::text);

  update terapias set vence_em = '2026-12-25', vence_em_manual = true
   where paciente_id = (select id from pacientes where chave_importacao = 'paciente teste um');
  r := importar_planilha(c, 'nova.xlsx', prazos,
    '[{"linha":2,"paciente":"Paciente Teste Um","chave":"paciente teste um","data":"2026-11-01","horario":null,"tipo":null,"procedimento":"AH","marca":null,"original":"AH","nota":null,"telefone":null,"vencimento":null}]', '[]');
  select t.vence_em into d from terapias t join pacientes p on p.id = t.paciente_id where p.chave_importacao = 'paciente teste um';
  insert into resultado values (5, 'vencimento digitado não é recalculado pela importação (humano ganha)', d = '2026-12-25', coalesce(d::text, 'null'));

  select count(*) into v from terapias where revisar and situacao = 'a_chamar'
    and paciente_id in (select id from pacientes where chave_importacao like 'paciente teste%');
  insert into resultado values (6, 'indicação "(incerto)" fica em revisão', v = 1, v::text);

  select count(*) into v from pacientes where chave_importacao = 'paciente teste dois' and telefone = '11987654321';
  insert into resultado values (7, 'telefone da planilha entra no paciente novo', v = 1, v::text);

  select count(*) into v from auditoria;
  insert into resultado values (8, 'membro comum não lê a auditoria', v = 0, v::text);

  begin
    update pacientes set cliente_id = '00000000-0000-4000-8000-0000000000c2' where chave_importacao = 'paciente teste um';
    insert into resultado values (9, 'ninguém troca o cliente de um paciente', false, 'o update passou');
  exception when insufficient_privilege then
    insert into resultado values (9, 'ninguém troca o cliente de um paciente', true, sqlerrm);
  end;

  update terapias set situacao = 'agendado'
   where paciente_id = (select id from pacientes where chave_importacao = 'paciente teste um');
  select count(*) into v from terapias
   where situacao = 'agendado' and situacao_por = '00000000-0000-4000-8000-0000000000a1'
     and paciente_id = (select id from pacientes where chave_importacao = 'paciente teste um');
  insert into resultado values (10, 'mudar a situação grava quem mudou', v = 1, v::text);
end $$;

-- ── como alguém de outro cliente ────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}';

do $$
declare
  c constant uuid := '9b765265-4625-43b0-8257-b2fd1de178ef';
  v int;
begin
  select count(*) into v from pacientes;
  insert into resultado values (11, 'de fora: vê 0 pacientes', v = 0, v::text);
  select count(*) into v from terapias;
  insert into resultado values (12, 'de fora: vê 0 terapias', v = 0, v::text);
  select count(*) into v from indicacoes;
  insert into resultado values (13, 'de fora: vê 0 indicações', v = 0, v::text);
  select count(*) into v from importacoes;
  insert into resultado values (14, 'de fora: vê 0 importações', v = 0, v::text);
  begin
    perform importar_planilha(c, 'x.xlsx', '{}', '[]', '[]');
    insert into resultado values (15, 'de fora: não importa no cliente dos outros', false, 'a importação passou');
  exception when insufficient_privilege then
    insert into resultado values (15, 'de fora: não importa no cliente dos outros', true, sqlerrm);
  end;
  begin
    insert into pacientes (cliente_id, nome) values (c, 'Intruso');
    insert into resultado values (16, 'de fora: não cria paciente no cliente dos outros', false, 'o insert passou');
  exception when insufficient_privilege then
    insert into resultado values (16, 'de fora: não cria paciente no cliente dos outros', true, sqlerrm);
  end;
  update terapias set situacao = 'nao_renovar' where cliente_id = c;
  get diagnostics v = row_count;
  insert into resultado values (17, 'de fora: não muda terapia dos outros', v = 0, v::text);
end $$;

-- ── visitante sem login ─────────────────────────────────────────────────
set local role anon;
do $$
begin
  perform count(*) from pacientes;
  insert into resultado values (18, 'anônimo: sem acesso a pacientes', false, 'leu');
exception when insufficient_privilege then
  insert into resultado values (18, 'anônimo: sem acesso a pacientes', true, sqlerrm);
end $$;

-- ── como o banco: a auditoria gravou? ───────────────────────────────────
reset role;
do $$
declare v int;
begin
  select count(*) into v from auditoria a
   where a.registro_id in (select t.id from terapias t join pacientes p on p.id = t.paciente_id where p.chave_importacao like 'paciente teste%')
      or a.registro_id in (select id from pacientes where chave_importacao like 'paciente teste%');
  insert into resultado values (19, 'auditoria gravou criação e mudanças', v >= 6, v::text);
  select count(*) into v from auditoria where usuario_id = '00000000-0000-4000-8000-0000000000a1' and acao = 'update' and 'situacao' = any(campos);
  insert into resultado values (20, 'auditoria diz quem mudou a situação', v = 1, v::text);
end $$;

-- resultado e desfaz tudo. A mensagem de erro volta cortada perto de mil
-- caracteres, então vai o placar e só as falhas.
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
