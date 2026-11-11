-- Teste da RLS do módulo Conteúdos (0002_conteudos.sql), seção 5.2 do HANDOFF.
-- Cria um cliente de teste com dados, confere o que cada papel enxerga e
-- consegue fazer, e DESFAZ TUDO no fim (rollback). Rodar:
--   npx supabase db query --remote --yes -f supabase/tests/rls_conteudos.sql
-- Troque :plataforma pelo id de um usuário da equipe da plataforma.
begin;

create temp table resultado (teste text, ok boolean, detalhe text) on commit drop;
grant all on resultado to authenticated, anon;

-- dados de teste (como dono do banco, sem RLS)
insert into clientes (id, nome) values ('00000000-0000-4000-8000-0000000000c1', 'Cliente de teste RLS');
insert into conteudos (id, cliente_id, assunto) values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 'Assunto de teste');
insert into referencias (cliente_id, conteudo_id, pmid, titulo) values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', '1', 'Artigo de teste');
insert into roteiros (id, cliente_id, conteudo_id, versao, estado) values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 1, 'pronto');
insert into roteiro_blocos (cliente_id, roteiro_id, ordem, titulo, fala) values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 1, 'Bloco', 'Fala de teste');
insert into videos (cliente_id, roteiro_id, retorno_token) values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 'x');
insert into integracoes (cliente_id, provedor, final) values ('00000000-0000-4000-8000-0000000000c1', 'anthropic', 'abcd');
insert into perfis_conteudo (cliente_id, nome_exibicao) values ('00000000-0000-4000-8000-0000000000c1', 'Teste');
select guardar_segredo('00000000-0000-4000-8000-0000000000c1', 'anthropic', 'sk-teste-nao-e-chave-de-verdade');

-- ── 1. usuário de FORA (id que não está em usuarios): vê zero ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000dead","role":"authenticated"}';
insert into resultado select 'fora vê 0 conteudos', count(*) = 0, count(*)::text from conteudos where id = '00000000-0000-4000-8000-0000000000a1';
insert into resultado select 'fora vê 0 referencias', count(*) = 0, count(*)::text from referencias where conteudo_id = '00000000-0000-4000-8000-0000000000a1';
insert into resultado select 'fora vê 0 roteiros', count(*) = 0, count(*)::text from roteiros where id = '00000000-0000-4000-8000-0000000000b1';
insert into resultado select 'fora vê 0 blocos', count(*) = 0, count(*)::text from roteiro_blocos where roteiro_id = '00000000-0000-4000-8000-0000000000b1';
insert into resultado select 'fora vê 0 videos', count(*) = 0, count(*)::text from videos where roteiro_id = '00000000-0000-4000-8000-0000000000b1';
insert into resultado select 'fora vê 0 integracoes', count(*) = 0, count(*)::text from integracoes where cliente_id = '00000000-0000-4000-8000-0000000000c1';
insert into resultado select 'fora vê 0 perfis', count(*) = 0, count(*)::text from perfis_conteudo where cliente_id = '00000000-0000-4000-8000-0000000000c1';
insert into resultado select 'fora vê 0 achados', count(*) = 0, count(*)::text from achados;
do $$ begin
  update referencias set selecionada = true where conteudo_id = '00000000-0000-4000-8000-0000000000a1';
  insert into resultado values ('fora não marca referência', not found, 'update afetou linhas');
end $$;
do $$ begin
  perform arquivar_conteudo('00000000-0000-4000-8000-0000000000a1');
  insert into resultado values ('fora não arquiva', false, 'arquivou');
exception when others then insert into resultado values ('fora não arquiva', true, sqlerrm);
end $$;
do $$ begin
  insert into conteudos (cliente_id, assunto) values ('00000000-0000-4000-8000-0000000000c1', 'invasão');
  insert into resultado values ('fora não cria conteúdo no cliente', false, 'criou');
exception when others then insert into resultado values ('fora não cria conteúdo no cliente', true, sqlerrm);
end $$;

-- ── 2. equipe da PLATAFORMA: vê o cliente de teste ──
set local request.jwt.claims = '{"sub":":plataforma","role":"authenticated"}';
insert into resultado select 'plataforma vê o conteúdo', count(*) = 1, count(*)::text from conteudos where id = '00000000-0000-4000-8000-0000000000a1';
insert into resultado select 'plataforma vê a referência', count(*) = 1, count(*)::text from referencias where conteudo_id = '00000000-0000-4000-8000-0000000000a1';
insert into resultado select 'plataforma vê o bloco', count(*) = 1, count(*)::text from roteiro_blocos where roteiro_id = '00000000-0000-4000-8000-0000000000b1';
insert into resultado select 'plataforma vê o vídeo', count(*) = 1, count(*)::text from videos where roteiro_id = '00000000-0000-4000-8000-0000000000b1';
insert into resultado select 'plataforma vê a integração (sem o valor)', count(*) = 1, count(*)::text from integracoes where cliente_id = '00000000-0000-4000-8000-0000000000c1';
do $$ begin
  update referencias set selecionada = true where conteudo_id = '00000000-0000-4000-8000-0000000000a1';
  insert into resultado values ('plataforma marca referência', found, '');
end $$;
do $$ begin
  update roteiro_blocos set fala = 'editado', editado = true where roteiro_id = '00000000-0000-4000-8000-0000000000b1';
  insert into resultado values ('plataforma edita o bloco', found, '');
end $$;

-- ── 3. o que NINGUÉM logado faz (só as edge functions, com a chave de serviço) ──
do $$ begin
  perform ler_segredo('00000000-0000-4000-8000-0000000000c1', 'anthropic');
  insert into resultado values ('sessão não lê a chave do cofre', false, 'leu');
exception when insufficient_privilege then insert into resultado values ('sessão não lê a chave do cofre', true, sqlerrm);
end $$;
do $$ begin
  perform 1 from vault.decrypted_secrets limit 1;
  insert into resultado values ('sessão não abre o vault', false, 'abriu');
exception when insufficient_privilege then insert into resultado values ('sessão não abre o vault', true, sqlerrm);
end $$;
do $$ begin
  perform guardar_segredo('00000000-0000-4000-8000-0000000000c1', 'anthropic', 'troca');
  insert into resultado values ('sessão não grava chave', false, 'gravou');
exception when insufficient_privilege then insert into resultado values ('sessão não grava chave', true, sqlerrm);
end $$;
do $$ begin
  insert into integracoes (cliente_id, provedor, final) values ('00000000-0000-4000-8000-0000000000c1', 'heygen', 'zzzz');
  insert into resultado values ('sessão não cria integração', false, 'criou');
exception when insufficient_privilege then insert into resultado values ('sessão não cria integração', true, sqlerrm);
end $$;
do $$ begin
  update conteudos set pesquisa_estado = 'pronta' where id = '00000000-0000-4000-8000-0000000000a1';
  insert into resultado values ('sessão não muda o estado da pesquisa', false, 'mudou');
exception when insufficient_privilege then insert into resultado values ('sessão não muda o estado da pesquisa', true, sqlerrm);
end $$;
do $$ begin
  update videos set estado = 'pronto' where roteiro_id = '00000000-0000-4000-8000-0000000000b1';
  insert into resultado values ('sessão não muda o estado do vídeo', false, 'mudou');
exception when insufficient_privilege then insert into resultado values ('sessão não muda o estado do vídeo', true, sqlerrm);
end $$;
do $$ begin
  perform vigiar();
  insert into resultado values ('sessão não roda o vigia', false, 'rodou');
exception when insufficient_privilege then insert into resultado values ('sessão não roda o vigia', true, sqlerrm);
end $$;
do $$ begin
  delete from referencias where conteudo_id = '00000000-0000-4000-8000-0000000000a1';
  insert into resultado values ('sessão não apaga referência', false, 'apagou');
exception when insufficient_privilege then insert into resultado values ('sessão não apaga referência', true, sqlerrm);
end $$;

-- ── 4. anon (sem login) não vê nada ──
set local role anon;
do $$ begin
  perform 1 from conteudos limit 1;
  insert into resultado values ('anon não lê conteudos', false, 'leu');
exception when insufficient_privilege then insert into resultado values ('anon não lê conteudos', true, sqlerrm);
end $$;

reset role;
-- a chave guardada voltou certa pelo cofre (como a edge function lê)
insert into resultado select 'cofre devolve a chave guardada', ler_segredo('00000000-0000-4000-8000-0000000000c1', 'anthropic') = 'sk-teste-nao-e-chave-de-verdade', '';
select teste, ok, left(detalhe, 80) as detalhe from resultado order by ok, teste;
rollback;
