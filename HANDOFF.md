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
- A `0001_inicio.sql` foi aplicada direto pela API de gestão do Supabase e marcada como aplicada no histórico em 10/11/26 (`migration repair`). Da `0002` em diante, tudo vai por `db push`:
  ```bash
  npx supabase login
  npx supabase link --project-ref yjwhhkzqmsouvnryiwde
  npx supabase migration list --remote   # confira o que falta
  npx supabase db push --remote
  ```
- O CLI pede confirmação para mexer na produção; num agente, só com `--yes` depois de combinar.
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
- **`usuarios`** (feita em 11/11/26) abastece a tela "Usuários" (`/usuarios`, só admin do cliente e plataforma):
  - cria a conta no Auth com `email_confirm: true` e a linha em `usuarios`;
  - gera o **link de primeiro acesso** (`generateLink` → `hashed_token` → `/auth/confirm` da DashMed → Minha conta para definir a senha). Vale 1 hora (`mailer_otp_exp`), uma vez. O admin do cliente só gera para quem nunca entrou; para quem já entrou, só a plataforma (o link entra na conta sem senha);
  - desativa com `ban` no Auth e `ativo = false`, nunca `deleteUser` (a única exceção é desfazer uma conta recém-criada cujo cadastro falhou); reativa; troca o papel;
  - ninguém mexe na própria conta, e conta da plataforma só a plataforma mexe. Regras em `_shared/regras-usuarios.ts`, teste `supabase/tests/usuarios.ts`. Toda ação vai para a `auditoria`.

### 6.4 Front
- **Novo item no menu:** acrescente em `ITENS` (`src/app/(app)/menu-lateral.tsx`) e crie `src/app/(app)/<rota>/page.tsx`.
- **Telas logadas:** são server components que leem pelo `supabaseServidor()`, ou seja, pela RLS de quem está logado. Interação fica em componente `"use client"` separado. Ação que muda dado vai por server action ou edge function.
- **Cliente em foco:** toda tela de dado de cliente lê `clientesDe(eu).emFoco` e filtra por esse `cliente_id`. A RLS é a garantia, e o filtro é a tela certa.
- **Desenho:** zinc + teal (`teal-700`), cartões `.cartao`, campos `.campo`, botões `.botao` / `.botao-claro`. Siga o que existe.
  - No celular (menos de 768 px) o menu vira barra no topo. Toda tela nova tem de funcionar nos dois.
- **Idioma:** textos da interface em português do Brasil, com o tom da equipe.

### 6.5 Publicar
- **Front: publica a cada push.** A Vercel está ligada ao `davidgusmao1/DashMed` desde 10/11/26 (app da Vercel instalado no GitHub do David, só neste repositório):
  - push na `main` vai para produção;
  - pull request ganha URL de preview.
- **Publicar à mão** (só se o push não servir): `npx vercel deploy --prod` na pasta do projeto, logado numa conta do time "David's projects".
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
- [x] Vercel ligada ao GitHub (6.5): push na `main` publica, PR ganha preview (10/11/26).
- [x] **Conteúdos para mídias sociais** e **Configurações** (10/11/26) — ver 8.1.
- [x] **Vigia** (regra 5): função SQL `vigiar()` rodando no pg_cron a cada 10 min (`dashmed-vigia`), achados na tabela `achados`.
- [x] **Agenda** (10/11/26): terapias para renovar e quem precisa ser chamado, com importação da planilha de indicações — ver 8.2.
- [x] **CRM de resgate** em Kanban (11/11/26), com a lista de 2025 do Apolo importada (559 pacientes, 803 terapias) — ver 8.3.
- [x] **Procedimentos já realizados** (11/11/26): quem já operou sai do resgate, AH renova 6 meses após a aplicação, bilateral com um lado só continua — ver 8.4.
- [x] Funções da Vercel em **gru1** (São Paulo), junto do banco (`vercel.json`): dado de paciente processado no Brasil e menos latência.

Sugestão de ordem:
1. **SMTP próprio** (Resend) + modelos de e-mail em português (5.3). Precisa de um domínio verificado no Resend; depois disso, convite e "esqueci a senha" podem sair por e-mail (hoje o primeiro acesso vai por link copiado/WhatsApp).
2. ~~Usuários~~ — feito em 11/11/26 (6.3).
3. **Clientes:** tela só da plataforma (criar e editar cliente; soft delete).
4. **Auditoria:** a tabela `auditoria` (gatilho `auditar()`, 0003) já registra quem criou e mudou pacientes, terapias e indicações; falta ligar nas próximas tabelas de negócio e registrar quem **viu** dado de paciente.
5. **Plano Pro do Supabase** antes de uso real: o Free pausa o projeto após 7 dias parado, limita a edge function a 150 s e arquivo a 50 MB.
6. Ambiente de **homologação** (um segundo projeto Supabase ou branch) antes de dado real de paciente.
7. Os demais itens do menu da DashMed, combinados com o David.

### 8.1 Conteúdos para mídias sociais
Pedido do David (10/11/26): assunto → referências em publicações médicas → roteiro de ~15 min → vídeo com o avatar dele.

| Passo | Onde | Como |
|---|---|---|
| Referências | edge `conteudos-pesquisa` (segundo plano) | Claude monta 2–4 buscas em inglês → **Europe PMC** (só PubMed, `SRC:MED`, com resumo; sem chave) → Claude dá relevância, nota e síntese. Só entra artigo que veio da busca (PMID real); PMID inventado é descartado (`soPmidsConhecidos`). O médico marca o que usa. |
| Roteiro | edge `conteudos-roteiro` | Estrutura (6–8 blocos, 14–16 min) e depois **um bloco por execução**, cada passo chamando o seguinte (o relógio da edge é curto). Parou? A tela mostra "Continuar" e o vigia marca erro em 15 min. Bloco editado pelo médico não é sobrescrito sem confirmação. Regras do CFM 2.336/2023 no prompt. |
| Vídeo | edge `conteudos-video` + `heygen-retorno` | HeyGen v3, `type: "studio"`: uma cena de avatar por trecho (≤ 4.800 caracteres; a HeyGen aceita 5.000 e 50 cenas). Só envia com "confirmo o custo" e `Idempotency-Key` = id do vídeo. O retorno da HeyGen só "cutuca": o estado é sempre lido em `GET /v3/videos/{id}`. Link do arquivo expira, então não é guardado. |
| Chaves | edge `integracoes` + Vault | Chave testada com o provedor antes de guardar; valor no Vault (`dashmed:<cliente>:<provedor>`), lido só por `ler_segredo` (service_role). A tela vê os 4 últimos caracteres. |

- Modelo: `claude-opus-5-5`, com `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) para recusa por engano em tema médico, e saída em JSON por esquema.
- Testes: `deno run --allow-read supabase/tests/conteudos.ts` (regras de texto) e `supabase/tests/rls_conteudos.sql` (RLS, roda em transação desfeita).
- Custos (públicos em 10/11/26): HeyGen Avatar IV ≈ US$ 4,83/min (~US$ 72 por vídeo de 15 min), Avatar III ≈ US$ 0,60/min; Claude: centavos a ~US$ 1 por roteiro.
- O avatar (gêmeo digital) e a voz clonada são criados pelo médico no app da HeyGen; a DashMed só escolhe entre os que a conta tem.

### 8.2 Agenda (renovação de terapias)
Pedido do David (10/11/26): "um menu na esquerda que vamos chamar de agenda onde todos os pacientes que precisam renovar suas terapias precisam ser chamados".

- **Modelo** (`0003_agenda.sql`): `pacientes` → `terapias` (paciente + procedimento, única por par; tem `vence_em` e `situacao`: `a_chamar`, `agendado`, `nao_renovar`) → `indicacoes` (uma por consulta: data, tipo de atendimento, trecho da evolução). `importacoes` guarda cada importação; `auditoria` registra criação e mudança por gatilho.
- **Origem dos dados:** a planilha de indicações que o David já usa (exemplo: `indicacoes-protese-ah-hidrogel-ago-out-2026.xlsx`; colunas Paciente, Data, Procedimento, e se houver Horário, Tipo atendimento, Trecho evolução, Telefone, Vencimento). Tela `/agenda/importar`: prévia sem gravar → prazo em meses por procedimento → função `importar_planilha` (uma transação, `security invoker`, RLS de quem importa).
- **Regras combinadas:** vencimento = data da última indicação + prazo do procedimento, ou a data digitada (`vence_em_manual`: a importação não recalcula por cima); "(incerto)"/"(histórico)" entram com `revisar` e só vão para a chamada depois de confirmados; telefone é digitado na ficha (a planilha não tem); reimportar não duplica (paciente pelo nome normalizado em `chave_importacao`, indicação única por terapia + data).
- **Limitação conhecida:** sem CPF/id na planilha, dois pacientes homônimos viram um só na importação.
- **Próximo passo:** a chamada vai pelo sistema do parceiro **Prospekt** (a API ainda vai ser passada). A Agenda já separa quem chamar; falta mandar a lista e receber o resultado de cada contato.
- Teste: `npx supabase db query --remote --file supabase/tests/agenda.sql` (transação desfeita; 20 checagens de RLS e importação).
- Desde a 0004, "A chamar" da Agenda = terapias **com vencimento** em etapa de contato ou já realizadas (renovação). Sem vencimento, o lugar é o CRM (8.3).

### 8.3 CRM de resgate (Kanban)
Pedido do David (11/11/26): "organizar um CRM estilo kanban para que minhas secretárias entrem em contato com os pacientes que ainda não fizeram cirurgias ... resgatar pacientes que tiveram um tratamento indicado e não realizaram".

- **Tela** `/crm`: uma coluna por etapa da terapia (`situacao`: `a_chamar` "A contatar", `tentativa`, `em_conversa`, `agendado`, `realizado`, `nao_renovar` "Não vai fazer"). Abre filtrado nas cirurgias (`ehCirurgia` em `src/lib/crm.ts`: ATQ/MAKO, VAQ, prótese…). Arrasta no computador; no celular move pelo registro da ligação. 60 cartões por coluna, com o total e aviso quando há mais.
- **Ligações** (`contatos`, 0004): resultado + anotação, via `registrar_contato` (uma transação: grava a ligação, move a etapa, marca "ligar de novo em"). É histórico: sem update nem delete. O resumo na terapia (`contatos_qtd`, `ultimo_contato_em`, `ultimo_resultado`) é escrito por gatilho. Responsável por cartão (`responsavel_id`).
- **Importação v2/v3** lê a planilha do Apolo Ninsaúde (`indicacoes-2025-apolo.xlsx`: abas Indicações e Candidatos; categoria "ATQ/MAKO, AH" vira duas terapias; celular principal + todos os números; e-mail; nascimento, que entra na chave do paciente e separa homônimos; candidatos marcados; "AH aplicado no dia" = Realizado). Prazo opcional: sem prazo, a terapia fica sem vencimento.
- **Etapa automática** (0005): enquanto ninguém mexeu no cartão (`situacao_auto` e nenhuma ligação), a etapa segue a consulta mais nova da planilha. Arrastar, ligar ou mudar na ficha desliga isso: a importação não muda mais aquela etapa. O gatilho sabe que é importação pela variável de transação `dashmed.importando`.
- **Estado em 11/11/26:** lista de 2025 importada com AH = 6 meses; AH 126 Realizado / 205 A contatar; ATQ/MAKO 227 e VAQ 28 a contatar; 63 terapias de candidatos marcadas para revisar.
- **Falta:** a integração com o Prospekt para as ligações. As contas das secretárias se criam na tela Usuários (feita em 11/11/26).
- Teste: `npx supabase db query --remote --file supabase/tests/crm.sql` (transação desfeita; 24 checagens).
- **Abrir ficha no Apolo Ninsaúde** (12/11/26): botão no cartão e na ficha. O Apolo não tem link para a ficha; ela só abre pela função interna `openWin({viewName: "cadastro_paciente", urlParam: {id}})`. O script `public/dashmed-apolo.user.js` (Tampermonkey, uma vez por computador; passo a passo em `/apolo`) lê `#dashmed-paciente=<código>` ou `#dashmed-telefone=<número>` em `apolo.ninsaude.com/inicial/` e chama essa função. O código fica em `pacientes.apolo_id` (0008, único por cliente). Em 12/11/26, 551 dos 559 pacientes ganharam o código, buscado no próprio Apolo pelo telefone, conferindo nome e nascimento, e gravado fora do git. Os 8 sem código têm cadastro duplicado no Apolo e caem na busca pelo telefone. Paciente novo da planilha entra sem código, e o botão usa o telefone.

### 8.4 Procedimentos já realizados (tira do resgate quem já fez)
Pedido do David (11/11/26), com a lista "2025_2026 - ATQ, ATJ, AH, VISCO, PRP e Hidrogel.xlsx": "Se a data ... passou de 6 meses, ele é candidato a ser chamado novamente. Se o paciente já fez cirurgia, ele não precisa ser chamado ... Se ... foi indicado fazer a terapia bilateral, a gente tem que levar isso em consideração."

- **Onde:** a mesma tela `/agenda/importar` reconhece a lista de realizados pela coluna "Data de Realização" (`ehListaDeRealizados` em `src/lib/planilha.ts`). O texto livre vira família (`familiasDe`: "Visco" = AH, "Visco BMAC" = AH + BMAC, "AH e Hidrogel" = os dois), lado (`ladoDe`: bilateral/unilateral; "JOELHOS"/"QUADRIS" = bilateral) e articulação. A lista à parte de BMAC numa coluna sem título ("nome – dd/mm/aaaa – BMAC") também é lida.
- **Banco** (0006, 0007): tabela `realizacoes` (histórico sem edição; única por paciente + família + data + articulação), `terapias.ultima_realizacao_em` e `lado_pendente`, `importacoes.tipo`/`resumo`, `familia_procedimento()` e `importar_realizados(p_cliente, p_arquivo, p_linhas, p_erros, p_meses_ah, p_simular)`. Com `p_simular` a função faz tudo dentro de um bloco que termina num erro de propósito (`DMSIM`) e desfaz a gravação, devolvendo os números: é a **prévia** da tela.
- **Regras:** casa pelo nome (a lista não tem nascimento) e **só com quem já está no CRM**; o resto vira "paciente não está no CRM" com o nº da linha. Cirurgia feita → Realizado; indicação bilateral (texto da terapia ou nota) com um lado só feito → continua a contatar, `lado_pendente`. AH vence `p_meses_ah` (6) depois da **última aplicação**; o quadro mostra em "A contatar" o realizado com vencimento passado (selo "renovação"), sem cron. Hidrogel/PRP/BMAC feitos → Realizado. Etapa só muda se `situacao_auto` e nenhuma ligação (humano ganha).
- **Por que `importar_realizados` é security definer** (0007): com RLS, a prévia levou 13 s e o banco cancelou (limite de 8 s de quem está logado): a RLS rodava `vejo_cliente()` em cada linha lida e bloqueava índice em expressão não "leakproof". A função confere `vejo_cliente(p_cliente)` uma vez e filtra tudo por `p_cliente`; ficou em 0,12 s. Use o mesmo cuidado em função nova que varre muitas linhas.
- **Estado em 11/11/26:** lista importada: 206 realizações de 178 pacientes; 84 pacientes casaram com o CRM, 101 linhas ficaram fora; 6 ATQ saíram do resgate; 58 AH com data (48 para renovar, 10 em dia); 11 bilaterais com um lado pendente; 6 Hidrogel/PRP/BMAC realizados; 13 realizações sem terapia correspondente (ex.: ATJ). Não há VAQ na lista — as videoartroscopias feitas precisam de outra fonte (o relatório "Mapa de agendamentos" do Apolo deve trazer).
- **Para olhar com o David:** os 101 de fora do CRM (grafia diferente do nome? não tiveram indicação em 2025?) e as 2 terapias ainda a contatar de quem já fez ATQ (ex.: AH no quadril operado).
- Teste: `npx supabase db query --remote --file supabase/tests/realizacoes.sql` (transação desfeita; 21 checagens).

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
