-- Teste da 0008 (código do paciente no Apolo). Transação desfeita no fim; o
-- placar vem na mensagem do erro.
--   npx supabase db query --remote --file supabase/tests/apolo.sql
begin;

create temp table resultado (n int, teste text, ok boolean, detalhe text) on commit drop;
grant all on resultado to authenticated;

insert into clientes (id, nome) values ('00000000-0000-4000-8000-0000000000c2', 'Cliente de teste RLS (some no rollback)');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'teste-membro@exemplo.invalid'),
  ('00000000-0000-4000-8000-0000000000b1', 'teste-fora@exemplo.invalid');
insert into usuarios (id, nome, email, cliente_id, papel) values
  ('00000000-0000-4000-8000-0000000000a1', 'Teste secretária', 'teste-membro@exemplo.invalid', '9b765265-4625-43b0-8257-b2fd1de178ef', 'membro'),
  ('00000000-0000-4000-8000-0000000000b1', 'Teste fora', 'teste-fora@exemplo.invalid', '00000000-0000-4000-8000-0000000000c2', 'membro');
insert into pacientes (id, cliente_id, nome) values
  ('00000000-0000-4000-8000-0000000000e1', '9b765265-4625-43b0-8257-b2fd1de178ef', 'Paciente Teste Apolo Um'),
  ('00000000-0000-4000-8000-0000000000e2', '9b765265-4625-43b0-8257-b2fd1de178ef', 'Paciente Teste Apolo Dois');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
do $$
declare v int;
begin
  update pacientes set apolo_id = 999001 where id = '00000000-0000-4000-8000-0000000000e1';
  get diagnostics v = row_count;
  insert into resultado values (1, 'secretária grava o código do Apolo', v = 1, v::text);
  begin
    update pacientes set apolo_id = 999001 where id = '00000000-0000-4000-8000-0000000000e2';
    insert into resultado values (2, 'o mesmo código do Apolo não vai para dois pacientes', false, 'passou');
  exception when unique_violation then
    insert into resultado values (2, 'o mesmo código do Apolo não vai para dois pacientes', true, sqlerrm);
  end;
  begin
    update pacientes set apolo_id = -5 where id = '00000000-0000-4000-8000-0000000000e2';
    insert into resultado values (3, 'código inválido é recusado', false, 'passou');
  exception when check_violation then
    insert into resultado values (3, 'código inválido é recusado', true, sqlerrm);
  end;
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}';
do $$
declare v int;
begin
  update pacientes set apolo_id = 999002 where id = '00000000-0000-4000-8000-0000000000e2';
  get diagnostics v = row_count;
  insert into resultado values (4, 'de fora: não grava código em paciente dos outros', v = 0, v::text);
  select count(*) into v from pacientes where apolo_id is not null;
  insert into resultado values (5, 'de fora: não vê códigos dos outros', v = 0, v::text);
end $$;

reset role;
do $$
declare v int;
begin
  select count(*) into v from auditoria where registro_id = '00000000-0000-4000-8000-0000000000e1' and 'apolo_id' = any(campos);
  insert into resultado values (6, 'auditoria registra quem gravou o código', v = 1, v::text);
end $$;

do $$
declare certos int; total int; falhas text;
begin
  select count(*) filter (where ok), count(*),
         string_agg(format('%s FALHOU — %s [%s]', n, teste, left(detalhe, 100)), E'\n' order by n) filter (where not ok)
    into certos, total, falhas from resultado;
  raise exception E'RESULTADO DO TESTE (tudo desfeito): % de % OK\n%', certos, total, coalesce(falhas, 'nenhuma falha');
end $$;
rollback;
