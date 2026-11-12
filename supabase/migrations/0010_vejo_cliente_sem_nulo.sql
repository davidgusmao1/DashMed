-- DashMed — vejo_cliente() nunca devolve NULL (12/11/26).
--
-- Incidente: o teste de RLS do YouTube Seller (supabase/tests/rls_youtube.sql)
-- mostrou um usuário de fora lendo os números de resumo_youtube(). Para quem
-- está logado mas não tem linha ativa em usuarios (conta desativada e ainda não
-- banida no Auth, por exemplo), meu_cliente() é NULL, e
--   p_cliente is not null and (eu_plataforma() or p_cliente = meu_cliente())
-- dava NULL, não false. Nas políticas de RLS NULL já esconde a linha, então
-- elas estavam certas; mas toda função que confere o acesso uma vez com
--   if not vejo_cliente(p_cliente) then raise ...
-- deixava passar (if not NULL não dispara): importar_planilha (0003/0004/0005),
-- importar_realizados (0006/0007) e resumo_youtube (0009).
--
-- Correção na raiz: a mesma regra, com coalesce. Mesma assinatura, mesmo
-- security definer e as mesmas permissões; nenhuma política muda de sentido.
create or replace function vejo_cliente(p_cliente uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_cliente is not null and (eu_plataforma() or p_cliente = meu_cliente()), false)
$$;
revoke execute on function vejo_cliente(uuid) from public, anon;
grant execute on function vejo_cliente(uuid) to authenticated;
