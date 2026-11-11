-- Teste da lista de realizados (migração 0006): quem já fez sai do resgate,
-- AH vence 6 meses depois da aplicação, bilateral com um lado só fica a
-- contatar, humano ganha do robô, RLS. Roda numa transação que termina com
-- erro DE PROPÓSITO: o placar vem na mensagem e nada fica gravado.
--
--   npx supabase db query --remote --file supabase/tests/realizacoes.sql
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

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

do $$
declare
  c constant uuid := '9b765265-4625-43b0-8257-b2fd1de178ef';
  -- monta uma linha de indicação no formato da importação
  ind constant text := '{"linha":%s,"paciente":"%s","chave":"%s|1960-01-01","chave_nome":"%s","nascimento":"1960-01-01","data":"%s","procedimento":"%s","original":"%s","marca":null,"realizado":false}';
  realizados jsonb;
  r jsonb;
  t record;
  v int;
  d uuid;
begin
  -- indicações (o que o CRM já tem)
  perform importar_planilha(c, 'indicacoes.xlsx', '{"AH": 6}', jsonb_build_array(
    format(ind, 2, 'Paciente Teste Ate', 'paciente teste ate', 'paciente teste ate', '2025-02-01', 'AH', 'AH quadril')::jsonb,
    format(ind, 3, 'Paciente Teste Ate', 'paciente teste ate', 'paciente teste ate', '2025-03-01', 'ATQ/MAKO', 'Prótese de quadril')::jsonb,
    format(ind, 4, 'Paciente Teste Bil', 'paciente teste bil', 'paciente teste bil', '2025-04-01', 'ATQ/MAKO', 'ATQ bilateral')::jsonb,
    format(ind, 5, 'Paciente Teste Ahbil', 'paciente teste ahbil', 'paciente teste ahbil', '2025-05-01', 'AH', 'AH quadris')::jsonb,
    format(ind, 6, 'Paciente Teste Emdia', 'paciente teste emdia', 'paciente teste emdia', '2025-05-02', 'AH', 'AH joelho')::jsonb,
    format(ind, 7, 'Paciente Teste Humano', 'paciente teste humano', 'paciente teste humano', '2025-05-03', 'ATQ/MAKO', 'ATQ')::jsonb));
  -- a secretária já ligou para o paciente "humano"
  select t2.id into d from terapias t2 join pacientes p on p.id = t2.paciente_id where p.chave_importacao = 'paciente teste humano|1960-01-01';
  perform registrar_contato(d, 'falou', 'vai pensar', 'em_conversa', null);

  realizados := '[
    {"linha":2,"paciente":"Paciente Teste Ate","chave_nome":"paciente teste ate","data":"2025-06-10","procedimento":"ATQ","descricao":"ATQ Unimed","lado":null,"articulacao":null},
    {"linha":3,"paciente":"Paciente Teste Ate","chave_nome":"paciente teste ate","data":"2025-03-15","procedimento":"AH","descricao":"AH QUADRIL","lado":null,"articulacao":"quadril"},
    {"linha":4,"paciente":"Paciente Teste Bil","chave_nome":"paciente teste bil","data":"2025-07-01","procedimento":"ATQ","descricao":"ATQ particular","lado":null,"articulacao":null},
    {"linha":5,"paciente":"Paciente Teste Ahbil","chave_nome":"paciente teste ahbil","data":"2026-10-01","procedimento":"AH","descricao":"AH UNILATERAL","lado":"unilateral","articulacao":null},
    {"linha":6,"paciente":"Paciente Teste Emdia","chave_nome":"paciente teste emdia","data":"2026-09-01","procedimento":"AH","descricao":"AH joelho","lado":null,"articulacao":"joelho"},
    {"linha":7,"paciente":"Paciente Teste Humano","chave_nome":"paciente teste humano","data":"2025-08-01","procedimento":"ATQ","descricao":"ATQ","lado":null,"articulacao":null},
    {"linha":8,"paciente":"Paciente Teste Ate","chave_nome":"paciente teste ate","data":"2025-09-01","procedimento":"ATJ","descricao":"ATJ","lado":null,"articulacao":null},
    {"linha":9,"paciente":"Paciente Que Nao Existe","chave_nome":"paciente que nao existe","data":"2025-09-02","procedimento":"AH","descricao":"AH","lado":null,"articulacao":null}
  ]';

  -- prévia: devolve os números e não grava nada
  r := importar_realizados(c, 'realizados.xlsx', realizados, '[]', 6, true);
  select count(*) into v from realizacoes where paciente_id in (select id from pacientes where chave_importacao like 'paciente teste%');
  insert into resultado values (1, 'prévia devolve os números e não grava', v = 0 and r->>'realizacoes_novas' = '7' and r->>'importacao_id' is null, v::text || ' ' || (r - 'erros')::text);
  select situacao into t from terapias where id = d;
  insert into resultado values (2, 'prévia não muda etapa nenhuma', t.situacao = 'em_conversa', t.situacao);

  r := importar_realizados(c, 'realizados.xlsx', realizados, '[]', 6, false);
  insert into resultado values (3, 'números: 7 novas, 1 sem paciente, 1 sem terapia, 2 cirurgias, 2 lados pendentes, AH 1 vencido e 1 em dia, 1 mexida por pessoa',
    r->>'realizacoes_novas' = '7' and r->>'sem_paciente' = '1' and r->>'sem_terapia' = '1' and r->>'cirurgias_concluidas' = '2'
    and r->>'lado_pendente' = '2' and r->>'ah_com_data' = '2' and r->>'ah_vencidos' = '1' and r->>'ah_em_dia' = '1'
    and r->>'mexidas_por_pessoa' = '1' and r->>'pacientes_encontrados' = '5', (r - 'erros')::text);
  insert into resultado values (4, 'quem não está no CRM vira erro com o número da linha', r->'erros' @> '[{"linha": 9, "motivo": "paciente não está no CRM"}]', (r->'erros')::text);

  select situacao, situacao_auto, ultima_realizacao_em, lado_pendente into t from terapias
   where procedimento = 'ATQ/MAKO' and paciente_id = (select id from pacientes where chave_importacao = 'paciente teste ate|1960-01-01');
  insert into resultado values (5, 'ATQ feita → Realizado (sai do resgate)', t.situacao = 'realizado' and t.situacao_auto and t.ultima_realizacao_em = '2025-06-10' and not t.lado_pendente, row_to_json(t)::text);

  select situacao, vence_em, ultima_realizacao_em into t from terapias
   where procedimento = 'AH' and paciente_id = (select id from pacientes where chave_importacao = 'paciente teste ate|1960-01-01');
  insert into resultado values (6, 'AH aplicado há mais de 6 meses: Realizado com vencimento passado (o quadro mostra em A contatar)',
    t.situacao = 'realizado' and t.vence_em = '2025-09-15' and t.vence_em <= (now() at time zone 'America/Sao_Paulo')::date, row_to_json(t)::text);

  select situacao, lado_pendente into t from terapias
   where procedimento = 'ATQ/MAKO' and paciente_id = (select id from pacientes where chave_importacao = 'paciente teste bil|1960-01-01');
  insert into resultado values (7, 'ATQ bilateral com um lado feito: continua a contatar, falta o outro lado', t.situacao = 'a_chamar' and t.lado_pendente, row_to_json(t)::text);

  select situacao, lado_pendente, vence_em into t from terapias
   where procedimento = 'AH' and paciente_id = (select id from pacientes where chave_importacao = 'paciente teste ahbil|1960-01-01');
  insert into resultado values (8, 'AH bilateral com aplicação unilateral: a contatar já, falta o outro lado', t.situacao = 'a_chamar' and t.lado_pendente and t.vence_em = '2027-04-01', row_to_json(t)::text);

  select situacao, vence_em into t from terapias
   where procedimento = 'AH' and paciente_id = (select id from pacientes where chave_importacao = 'paciente teste emdia|1960-01-01');
  insert into resultado values (9, 'AH aplicado há menos de 6 meses: Realizado e em dia', t.situacao = 'realizado' and t.vence_em = '2027-03-01', row_to_json(t)::text);

  select situacao, ultima_realizacao_em into t from terapias where id = d;
  insert into resultado values (10, 'cartão em que a secretária já ligou: data entra, etapa não muda (humano ganha)', t.situacao = 'em_conversa' and t.ultima_realizacao_em = '2025-08-01', row_to_json(t)::text);

  select count(*) into v from realizacoes where procedimento = 'ATJ' and terapia_id is null
    and paciente_id = (select id from pacientes where chave_importacao = 'paciente teste ate|1960-01-01');
  insert into resultado values (11, 'ATJ sem terapia indicada fica só registrada', v = 1, v::text);

  r := importar_realizados(c, 'realizados.xlsx', realizados, '[]', 6, false);
  insert into resultado values (12, 'reimportar a mesma lista não duplica', r->>'realizacoes_novas' = '0' and r->>'ja_existiam' = '7' and r->>'etapas_mudadas' = '0', (r - 'erros')::text);

  select count(*) into v from importacoes where tipo = 'realizados' and resumo is not null and arquivo = 'realizados.xlsx';
  insert into resultado values (13, 'importação de realizados fica registrada (as gravadas, não a prévia)', v = 2, v::text);

  begin
    update realizacoes set realizada_em = '2020-01-01' where procedimento = 'ATJ';
    insert into resultado values (14, 'realização registrada não se edita pela tela', false, 'o update passou');
  exception when insufficient_privilege then
    insert into resultado values (14, 'realização registrada não se edita pela tela', true, sqlerrm);
  end;

  begin
    perform importar_realizados(c, 'x.xlsx', '[]', '[]', 0, true);
    insert into resultado values (15, 'prazo do AH fora de 1–60 é recusado', false, 'passou');
  exception when invalid_parameter_value then
    insert into resultado values (15, 'prazo do AH fora de 1–60 é recusado', true, sqlerrm);
  end;

  insert into resultado values (16, 'família do procedimento casa terapia e realização',
    familia_procedimento('ATQ/MAKO') = 'ATQ' and familia_procedimento('Prótese/ATQ') = 'ATQ' and familia_procedimento('Hidrogel/Hymovis') = 'Hidrogel'
    and familia_procedimento('AH') = 'AH' and familia_procedimento('VAQ') = 'VAQ' and familia_procedimento('BMAC') = 'BMAC'
    and familia_procedimento('PRP') = 'PRP' and familia_procedimento('Outra') is null and familia_procedimento('Bloqueio/Ondas') is null, '');

  insert into resultado values (17, 'a marca de importação não vaza', coalesce(current_setting('dashmed.importando', true), '') = '', coalesce(current_setting('dashmed.importando', true), 'null'));
end $$;

-- ── como alguém de outro cliente ────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}';
do $$
declare v int;
begin
  select count(*) into v from realizacoes;
  insert into resultado values (18, 'de fora: vê 0 realizações', v = 0, v::text);
  begin
    perform importar_realizados('9b765265-4625-43b0-8257-b2fd1de178ef', 'x.xlsx', '[]', '[]', 6, false);
    insert into resultado values (19, 'de fora: não importa no cliente dos outros', false, 'passou');
  exception when insufficient_privilege then
    insert into resultado values (19, 'de fora: não importa no cliente dos outros', true, sqlerrm);
  end;
end $$;

set local role anon;
do $$
begin
  perform count(*) from realizacoes;
  insert into resultado values (20, 'anônimo: sem acesso a realizações', false, 'leu');
exception when insufficient_privilege then
  insert into resultado values (20, 'anônimo: sem acesso a realizações', true, sqlerrm);
end $$;

reset role;
do $$
declare v int;
begin
  select count(*) into v from auditoria where tabela = 'realizacoes' and acao = 'insert' and usuario_id = '00000000-0000-4000-8000-0000000000a1';
  insert into resultado values (21, 'auditoria registra as realizações e quem importou', v = 7, v::text);
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
