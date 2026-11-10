# Regras do projeto DashMed

Leia o `HANDOFF.md` antes de começar: lá estão o que existe, como publicar e o porquê de cada regra.

## Next.js 16
Esta versão tem mudanças grandes, de API e de convenção: `middleware.ts` virou `proxy.ts`, e `cookies()`/`params` são assíncronos. Antes de usar uma API do Next, leia o guia em `node_modules/next/dist/docs/` e respeite os avisos de depreciação.

## Invariantes de engenharia
1. **"Só um X por Y" vira índice único no Postgres**, nunca só checagem no código. Trate o `unique_violation` registrando o descarte.
2. **Falha silenciosa é bug duplo.** O que impede algo de acontecer aparece para quem esperava: motivo na API, aviso na tela ou achado do vigia. `console.error` sozinho não conta.
3. **Estado mostrado vem da fonte da verdade**, com todos os campos que mudam a leitura.
4. **Humano ganha do robô, por construção.** A automação não atropela quem está agindo.
5. **O vigia guarda a invariante que não cabe no banco.** Invariante nova = check novo no vigia.
6. **Dado de negócio só tem soft delete** (`deleted_at` + filtro). Usuário sai por ban no Auth, nunca por `deleteUser`. Segredo se apaga de verdade.

## Multi-cliente e segurança
- Toda tabela de dado de cliente: `cliente_id` + RLS `vejo_cliente(cliente_id)` + `revoke all ... from anon`.
- Função `security definer` nova: `revoke execute ... from public, anon` + `grant ... to authenticated`.
- A chave de serviço só existe nas edge functions. No front, só a chave anon (pública) em `src/lib/config.ts`.
- Nunca imprima, logue nem faça commit de segredo.
- PostgREST devolve no máximo 1.000 linhas: para contar use `count: "exact", head: true`; para listas grandes, pagine.

## Estilo
- Nomes, textos da interface, comentários e mensagens de commit em português do Brasil.
- O comentário explica o porquê (pedido, incidente, data).
- Migração nova = arquivo novo `supabase/migrations/NNNN_nome.sql`; nunca edite uma já aplicada.
- Antes de publicar: `npm run typecheck` e `npm run build`.
