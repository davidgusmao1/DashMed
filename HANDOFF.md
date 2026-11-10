# DashMed — handoff para o desenvolvedor

> Situação em 10/11/2026. Este documento é para quem assume o desenvolvimento a partir de agora:
> o que existe, como está montado, como publicar e as regras de engenharia que usamos nos nossos
> projetos (Prospekt, Motorcore, Grupo TE2). As regras curtas estão também em `AGENTS.md`, que as
> ferramentas de IA leem sozinhas.

---

## 1. O que é

A DashMed é uma **plataforma web multi-cliente**, com um painel no desenho do Prospekt/Motorcore:
- menu à esquerda;
- cada cliente com os seus dados isolados;
- uma equipe da plataforma que enxerga todos os clientes.

Hoje existe só o **esqueleto**, de propósito: login, troca de cliente, menu com "Início" e "Minha conta". Os itens do menu entram aos poucos, combinados com o Jorge e o David.

- Produção: **https://dashmed-app.vercel.app**. O `dashmed.vercel.app` é de outro projeto da Vercel, de terceiros, e não dá para usar.
- Primeiro cliente: **David Gusmão**.
- Usuários: **jorge@motorleads.co** e **davidgusmao@gmail.com**. Os dois são equipe da plataforma e admin do cliente David Gusmão.

## 2. Acessos de que você precisa

Peça ao David, que é o dono das três contas:

| Onde | O quê | Observação |
|---|---|---|
| GitHub | colaborador em `davidgusmao1/DashMed` | branch principal: `main` |
| Supabase | membro da organização **DashMed**, projeto `yjwhhkzqmsouvnryiwde` (São Paulo) | Developer ou Administrator |
| Vercel | membro do time **David's projects** (`davids-projects-a75e8135`), projeto `dashmed-app` | |
| Plataforma | um usuário seu na própria DashMed | criado pela equipe da plataforma (ver 6.3) |

Nenhum segredo está neste documento nem no repositório. A **chave de serviço** (service_role/secret) do Supabase:
- fica no painel do Supabase, em Project Settings → API Keys;
- só existe dentro das edge functions;
- nunca vai para o navegador, a Vercel, o git ou o chat.

## 3. Tecnologias

| Camada | Tecnologia | Versão |
|---|---|---|
| Front + servidor | **Next.js** (App Router), React | next 16.3.5, react 19.2.8 |
| Estilo | **Tailwind CSS v4** (config no `globals.css`), ícones **lucide-react** | |
| Banco | **Supabase Postgres** com **RLS** em todas as tabelas | |
| Autenticação | **Supabase Auth**: link no e-mail (sem senha) e e-mail + senha | |
| Regras com segredo / escrita | **Supabase Edge Functions** (Deno) | |
| Hospedagem | **Vercel** (projeto `dashmed-app`) | |
| Linguagem | TypeScript estrito | |

**Atenção ao Next 16:** ele tem mudanças grandes em relação ao que a maioria conhece.
- O antigo `middleware.ts` agora se chama **`proxy.ts`** (`src/proxy.ts`).
- APIs como `cookies()` e `params` são assíncronas.
- Antes de usar uma API do Next, leia o guia em `node_modules/next/dist/docs/`, que é o da versão instalada, e respeite os avisos de depreciação. Não confie em exemplo antigo da internet.

## 4. Estrutura do código

```
src/
  proxy.ts                     renova a sessão a cada request; quem não está logado vai para /login
  lib/config.ts                URL + chave PÚBLICA (anon) do Supabase e o nome do cookie do cliente
  lib/supabase/client.ts       cliente do navegador
  lib/supabase/server.ts       cliente do servidor (sessão por cookie), usuarioAtual(), clientesDe()
  app/layout.tsx               raiz (fonte Geist, pt-BR)
  app/globals.css              tema e classes de componente: .campo .rotulo .botao .botao-claro .cartao
  app/login/page.tsx           entrada: e-mail + senha, ou "Receber link de acesso por e-mail"
  app/auth/callback/route.ts   volta do link do e-mail (troca o código pela sessão, PKCE)
  app/(app)/layout.tsx         telas logadas: confere o usuário e monta o menu
  app/(app)/menu-lateral.tsx   MENU DA ESQUERDA (lista ITENS) + seletor de cliente + rodapé com o usuário
  app/(app)/acoes.ts           server action escolherCliente (cookie dashmed-cliente)
  app/(app)/inicio/page.tsx    Início (em branco + estado da plataforma pela edge "saude")
  app/(app)/conta/             Minha conta (definir senha)
  app/(app)/sem-acesso.tsx     conta sem cadastro ativo
supabase/
  migrations/0001_inicio.sql   esquema: clientes, usuarios, funções da RLS e políticas
  functions/saude/index.ts     edge function de saúde (prova banco + edge + Vercel ligados)
  config.toml                  project_id e verify_jwt de cada função
```

## 5. Modelo de dados e segurança (o mais importante)

### 5.1 Multi-cliente
- `clientes`: cada cliente da plataforma.
- `usuarios`: liga a conta do Auth (`id = auth.users.id`) a um **`cliente_id`**. Também guarda:
  - `papel`: `admin` ou `membro`;
  - `plataforma`: a equipe da plataforma vê todos os clientes;
  - `ativo` e `deleted_at`.
- Funções da RLS (`security definer`):
  - `eu_plataforma()`;
  - `meu_cliente()`;
  - `vejo_cliente(cliente_id)`: plataforma ou o próprio cliente.
- Cliente em foco: a equipe da plataforma escolhe no seletor do menu, e a escolha fica no cookie `dashmed-cliente`. O usuário de um cliente só vê o dele.

### 5.2 Regra de ouro para TODA tabela nova de dado de cliente
1. Coluna `cliente_id uuid not null references clientes(id)`.
2. `alter table ... enable row level security;`
3. Política de leitura: `using (deleted_at is null and vejo_cliente(cliente_id))`.
4. Escrita: pela **edge function** com a chave de serviço, conferindo quem pediu, ou por política de escrita explícita que também use `vejo_cliente(cliente_id)`.
5. `revoke all on <tabela> from anon;`
6. Toda função `security definer` nova: `revoke execute ... from public, anon;` e `grant execute ... to authenticated`. Ela nasce executável por qualquer um se você não fizer isso.
7. Teste a RLS com dois papéis: um usuário do cliente vê o dele, e um usuário de fora vê zero. Por SQL:
   ```sql
   begin;
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"<uuid do usuário>","role":"authenticated"}';
   select count(*) from <tabela>;
   rollback;
   ```

Modelo de migração para uma tabela nova:
```sql
create table pacientes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  nome text not null,
  criado_em timestamptz not null default now(),
  deleted_at timestamptz
);
create index pacientes_cliente_idx on pacientes (cliente_id) where deleted_at is null;
alter table pacientes enable row level security;
create policy pacientes_ler on pacientes for select to authenticated
  using (deleted_at is null and vejo_cliente(cliente_id));
revoke all on pacientes from anon;
```

### 5.3 Autenticação
- O cadastro aberto está **desligado** no Supabase: só entra quem tem conta, criada pela plataforma.
- Entrada:
  - por senha (`signInWithPassword`);
  - ou por link no e-mail (`signInWithOtp` com `shouldCreateUser: false`, que volta em `/auth/callback`).
- A senha se define em **Minha conta**: clique no nome, no rodapé do menu.
- Endereços permitidos no Auth: `https://dashmed-app.vercel.app/**` e `http://localhost:3000/**`. Domínio novo → acrescente em Auth → URL Configuration.
- **E-mail:** hoje é o e-mail padrão do Supabase, que tem três limites:
  - só entrega para membros da organização;
  - manda no máximo **2 por hora**;
  - o modelo não pode ser editado, então o texto fica em inglês.
  - **Antes de entrar cliente de fora:** configure um SMTP próprio (Resend, por exemplo) e traduza os modelos de e-mail.

## 6. Como trabalhar

### 6.1 Rodar local
```bash
git clone https://github.com/davidgusmao1/DashMed.git && cd DashMed
npm install
npm run dev            # http://localhost:3000 (usa o Supabase de produção — cuidado com escrita)
npm run typecheck      # tsc --noEmit
npm run build          # o mesmo build da Vercel
```

### 6.2 Banco: migrações
- Toda mudança de esquema vira um arquivo novo `supabase/migrations/NNNN_nome.sql` em sequência (`0002_...`, `0003_...`). Nunca edite uma migração já aplicada.
- A `0001_inicio.sql` foi aplicada direto pela API de gestão do Supabase. Antes do primeiro `supabase db push`, marque-a como aplicada:
  ```bash
  npx supabase login
  npx supabase link --project-ref yjwhhkzqmsouvnryiwde
  npx supabase migration repair --status applied 0001
  npx supabase db push
  ```
- O comentário no topo da migração diz **por que** ela existe (pedido, data, incidente). Isso é o histórico do projeto.

### 6.3 Edge functions
- Ficam em `supabase/functions/<nome>/index.ts`. O `verify_jwt` de cada uma fica em `supabase/config.toml`.
- Publicar:
  ```bash
  npx supabase functions deploy <nome> --project-ref yjwhhkzqmsouvnryiwde --use-api
  ```
- Padrão de uma função que escreve, como a `usuarios` do Grupo TE2:
  1. lê o token do `Authorization` e confere com `admin.auth.getUser(token)`;
  2. confere na tabela `usuarios` se a pessoa está ativa e tem o papel certo (plataforma ou admin daquele cliente);
  3. só então usa a chave de serviço;
  4. responde `{ erro: "motivo claro" }` com o status certo. Nunca falha calada.
- **Próxima função a fazer:** `usuarios`. Ela vai:
  - criar a conta no Auth com `email_confirm: true` e a linha em `usuarios`;
  - desativar com `ban` no Auth e `ativo = false`, nunca `deleteUser`;
  - trocar o papel.
  É ela que vai abastecer a tela "Usuários".

### 6.4 Front
- **Novo item no menu:** acrescente em `ITENS` (`src/app/(app)/menu-lateral.tsx`) e crie `src/app/(app)/<rota>/page.tsx`.
- **Telas logadas:** são server components que leem pelo `supabaseServidor()`, ou seja, pela RLS de quem está logado. Interação fica em componente `"use client"` separado. Ação que muda dado vai por server action ou edge function.
- **Cliente em foco:** toda tela de dado de cliente lê `clientesDe(eu).emFoco` e filtra por esse `cliente_id`. A RLS é a garantia, e o filtro é a tela certa.
- **Desenho:** zinc + teal (`teal-700`), cartões `.cartao`, campos `.campo`, botões `.botao` / `.botao-claro`. Siga o que existe.
  - No celular (menos de 768 px) o menu vira barra no topo. Toda tela nova tem de funcionar nos dois.
- **Idioma:** textos da interface em português do Brasil, com o tom da equipe.

### 6.5 Publicar
- **Front:** `npx vercel deploy --prod` na pasta do projeto, logado numa conta do time "David's projects".
- **Para publicar a cada push (recomendado):** o David instala o app da Vercel no GitHub dele, liberando o repositório DashMed. Depois, em Vercel → dashmed-app → Settings → Git, conecta o `davidgusmao1/DashMed`. A partir daí:
  - push na `main` vai para produção;
  - pull request ganha URL de preview.
- **Commits:** precisam sair com um e-mail que seja membro do time da Vercel, senão a Vercel bloqueia o deploy ("commit author email … not valid").
- **Banco e funções:** pelo CLI do Supabase (6.2 e 6.3). A Vercel não publica isso.

## 7. Regras de engenharia (as mesmas dos nossos projetos)

São lições que já custaram bug em produção no Prospekt. Valem desde o primeiro dia:

1. **"Só um X por Y" vira índice único no Postgres**, nunca só checagem no código. Duas requisições no mesmo milissegundo passam pela checagem de aplicação. No insert, trate o `unique_violation` registrando o descarte, sem explodir nem engolir o erro.
2. **Falha silenciosa é bug duplo.** Toda condição que impede algo de acontecer aparece para quem esperava: recusa na API com motivo claro, aviso na tela ou achado do vigia (regra 5). `console.error` sozinho não conta, porque ninguém olha.
3. **O que a tela afirma vem da fonte da verdade**, com todos os campos que mudam a leitura. Antes de afirmar algo sobre estado externo (banco, integração), confira se há um segundo campo que inverte a conclusão.
4. **Humano ganha do robô, por construção.** Quando houver automação, ela não atropela o que uma pessoa está fazendo. Todo recurso automático responde: "o que acontece se a pessoa agir no meio?"
5. **O vigia guarda as invariantes que não cabem no banco.** Crie um cron (ex.: `/api/cron/vigia`, de hora em hora) que:
   - procura regra violada;
   - conserta o que tem conserto inequívoco;
   - registra tudo numa tabela de achados: achado novo abre linha, condição sanada fecha com data.
   Invariante nova no sistema = check novo no vigia.
6. **Dado de negócio só tem soft delete:** `deleted_at` + filtro nas listagens. Usuário sai por bloqueio no Auth (ban), nunca por `deleteUser`, para o histórico continuar apontando para gente com nome. A exceção é segredo e credencial (chave de API, token): esses se apagam de verdade.

E mais:

- **Segredo nunca aparece:** não vai em log, em commit, em print nem em mensagem.
  - Só a chave anon (pública) está no código, em `src/lib/config.ts`. Quem protege os dados é a RLS.
  - Chave de serviço e chaves de integração moram nos secrets das edge functions (`supabase secrets set`).
- **A RLS é a segurança, a tela não.** Nunca confie em esconder botão. Toda leitura passa pela RLS de quem está logado, e toda escrita sensível passa pela edge function que confere quem pediu.
- **Teto de 1.000 linhas do PostgREST:** uma consulta pela API devolve no máximo 1.000 linhas, sem avisar. Para contar, use `count: "exact", head: true`. Para listas grandes, pagine.
- **Fuso:** a operação é em `America/Sao_Paulo`. Grave `timestamptz` e converta na exibição.
- **Nomes em português**, no mesmo estilo do código (`clientes`, `usuarioAtual`, `criado_em`).
- **Comentário explica o PORQUÊ, não o quê:** o pedido ou o incidente que gerou a regra, com data. É assim que o próximo dev entende por que algo é do jeito que é.
- **Mensagem de commit em português** dizendo o que mudou e por quê, com o pedido que motivou (ex.: `Senha: Minha conta define a senha… (Jorge, 10/11/26: "onde coloco a senha?")`).
- **Testes:**
  - para regra de negócio, um script em `supabase/tests/<regra>.ts` (Deno, `deno run --allow-read`) que confere o código e os casos da regra. É o padrão dos nossos projetos: barato e roda em segundos;
  - para RLS, o teste por SQL da seção 5.2;
  - antes de publicar, sempre `npm run typecheck` e `npm run build`.
- **Produção é produção:** não rode teste de carga, não faça disparo em massa e não apague dado sem combinar antes.
- **Antes de apagar ou sobrescrever, olhe o alvo.** Prefira desativar a apagar.
- **Mudança pequena, publicada e verificada:** faça, publique, confira no ar e só então diga que está pronto. Diga só o que foi verificado.

## 8. Estado atual e próximos passos sugeridos

Feito e no ar:
- [x] Esquema multi-cliente + RLS (`0001_inicio.sql`), testado: o usuário do cliente vê o dele, e um de fora vê zero.
- [x] Login por senha e por link, cadastro aberto desligado, Minha conta com definir senha.
- [x] Menu da esquerda (recolhe, e vira barra no celular), seletor de cliente para a plataforma.
- [x] Edge function `saude` + card "Banco e funções no ar" no Início.
- [x] Produção em https://dashmed-app.vercel.app.

Sugestão de ordem:
1. **Ligar a Vercel ao GitHub** (6.5), para publicar a cada push e ter preview por PR.
2. **SMTP próprio** (Resend) + modelos de e-mail em português (5.3).
3. **Usuários:** edge `usuarios` + tela (criar, desativar, papel), só para admin e plataforma.
4. **Clientes:** tela só da plataforma (criar e editar cliente; soft delete).
5. **Auditoria:** tabela `logs` (quem, o quê, quando, cliente) gravada por gatilho nas tabelas de negócio.
6. **Vigia** (regra 5) assim que houver a primeira invariante.
7. Ambiente de **homologação** (um segundo projeto Supabase ou branch) antes de dado real de paciente.
8. Os itens do menu da DashMed em si, combinados com o David.

Se o produto for lidar com **dados de saúde**, a LGPD trata isso como dado sensível. Desenhe isso desde já:
- acesso mínimo pela RLS;
- auditoria de quem viu e alterou;
- nada de dado de paciente em log ou em ferramenta de terceiros;
- backup e retenção combinados.

## 9. Referências rápidas

| | |
|---|---|
| Produção | https://dashmed-app.vercel.app |
| Repositório | https://github.com/davidgusmao1/DashMed |
| Supabase | projeto `yjwhhkzqmsouvnryiwde` (org DashMed) |
| Vercel | time `davids-projects-a75e8135`, projeto `dashmed-app` |
| Primeiro cliente | David Gusmão (`9b765265-4625-43b0-8257-b2fd1de178ef`) |
| Usuários iniciais | jorge@motorleads.co, davidgusmao@gmail.com (plataforma + admin) |
