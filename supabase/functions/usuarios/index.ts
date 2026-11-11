// Contas da DashMed (David, 11/11/26: "criar a tela de usuários ... Assim você
// mesmo cria e desativa as contas delas" — as secretárias que vão ligar no CRM).
//
// Ações (POST {acao, ...}):
// - listar {cliente_id}: as contas do cliente com o que só o Auth sabe (se já
//   entrou, último acesso);
// - criar {cliente_id, nome, email, papel}: conta no Auth já confirmada + linha
//   em usuarios; devolve o link de primeiro acesso;
// - link {usuario_id}: novo link de primeiro acesso (vale 1 hora, uma vez);
// - papel {usuario_id, papel}; desativar {usuario_id}; reativar {usuario_id}.
//
// Sem e-mail próprio configurado (o padrão do Supabase só entrega para membros
// da organização), o acesso vai por link que o admin manda pelo WhatsApp. A
// pessoa entra, cai em Minha conta e define a senha.
//
// Regras do HANDOFF: usuário sai por ban no Auth + ativo = false, nunca por
// deleteUser (o histórico continua apontando para gente com nome). Toda ação
// fica na auditoria.
import { admin, CORS, corpoJson, ehUuid, Falha, quemPediu, responder, respostaDeErro, VIOLACAO_UNICA } from "../_shared/base.ts";
import {
  type Alvo, type Decisao, podeCriar, podeDesativar, podeGerarLink, podeMudarPapel, podeReativar, validarNovaConta,
} from "../_shared/regras-usuarios.ts";

type Pedido = { acao?: string; cliente_id?: string; usuario_id?: string; nome?: string; email?: string; papel?: string };
type LinhaUsuario = { id: string; nome: string; email: string; papel: "admin" | "membro"; plataforma: boolean; cliente_id: string | null; ativo: boolean; criado_em: string };

// 100 anos: o Auth não tem "banido para sempre"
const BANIDO = "876000h";

function exigir(d: Decisao) {
  if (!d.ok) throw new Falha(d.motivo, 403);
}

async function infoAuth(id: string) {
  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error || !data.user) throw new Falha(`Não achei a conta no Auth (${error?.message ?? "sem usuário"}).`, 404);
  return data.user;
}

async function carregarAlvo(usuarioId: unknown): Promise<{ linha: LinhaUsuario; alvo: Alvo }> {
  if (!ehUuid(usuarioId)) throw new Falha("Conta inválida.", 400);
  const { data, error } = await admin.from("usuarios")
    .select("id, nome, email, papel, plataforma, cliente_id, ativo, criado_em")
    .eq("id", usuarioId).is("deleted_at", null).maybeSingle();
  if (error) throw new Falha(`Não consegui ler a conta (${error.message}).`, 500);
  if (!data) throw new Falha("Conta não encontrada.", 404);
  const u = await infoAuth(usuarioId);
  const linha = data as LinhaUsuario;
  return { linha, alvo: { ...linha, ja_entrou: !!u.last_sign_in_at } };
}

async function auditar(clienteId: string | null, alvoId: string, quem: string, acao: "insert" | "update", campos: string[]) {
  if (!clienteId) return;
  const { error } = await admin.from("auditoria").insert({
    cliente_id: clienteId, tabela: "usuarios", registro_id: alvoId, acao, usuario_id: quem, campos,
  });
  if (error) throw new Falha(`A ação foi feita, mas a auditoria falhou (${error.message}).`, 500);
}

/** Link de primeiro acesso: o hash do token vai para /auth/confirm da DashMed,
 *  que troca pela sessão. O navegador monta o endereço com a própria origem. */
async function gerarLink(email: string): Promise<{ token_hash: string; tipo: string; vale_minutos: number }> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw new Falha(`Não consegui gerar o link (${error?.message ?? "sem token"}).`, 500);
  return { token_hash: data.properties.hashed_token, tipo: data.properties.verification_type ?? "magiclink", vale_minutos: 60 };
}

async function atender(req: Request) {
  const eu = await quemPediu(req);
  const p = await corpoJson<Pedido>(req);

  switch (p.acao) {
    case "listar": {
      if (!ehUuid(p.cliente_id)) throw new Falha("Cliente inválido.", 400);
      exigir(podeCriar(eu, p.cliente_id));
      const { data, error } = await admin.from("usuarios")
        .select("id, nome, email, papel, plataforma, cliente_id, ativo, criado_em")
        .eq("cliente_id", p.cliente_id).is("deleted_at", null).order("nome");
      if (error) throw new Falha(`Não consegui listar as contas (${error.message}).`, 500);
      const { data: auth, error: e2 } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (e2) throw new Falha(`Não consegui ler o Auth (${e2.message}).`, 500);
      const porId = new Map(auth.users.map((u) => [u.id, u]));
      return {
        usuarios: (data as LinhaUsuario[]).map((u) => {
          const a = porId.get(u.id);
          const banido = !!a?.banned_until && new Date(a.banned_until) > new Date();
          return { ...u, ultimo_acesso: a?.last_sign_in_at ?? null, ja_entrou: !!a?.last_sign_in_at, bloqueado_no_auth: banido };
        }),
      };
    }

    case "criar": {
      const cliente = ehUuid(p.cliente_id) ? p.cliente_id : null;
      exigir(podeCriar(eu, cliente));
      const v = validarNovaConta(p.nome, p.email, p.papel);
      if (!v.ok) throw new Falha(v.motivo, 400);
      const { data: ja } = await admin.from("usuarios").select("id, ativo").eq("email", v.email).is("deleted_at", null).maybeSingle();
      if (ja) throw new Falha(ja.ativo ? "Já existe uma conta com este e-mail." : "Já existe uma conta desativada com este e-mail: use Reativar.", 409);

      const { data: criado, error } = await admin.auth.admin.createUser({ email: v.email, email_confirm: true, user_metadata: { nome: v.nome } });
      if (error || !criado.user) {
        const msg = error?.message ?? "";
        throw new Falha(/already|registered|exists/i.test(msg) ? "Este e-mail já tem conta no Auth, mas sem cadastro na DashMed. Fale com a equipe da plataforma." : `Não consegui criar a conta (${msg}).`, 409);
      }
      const { error: e2 } = await admin.from("usuarios").insert({
        id: criado.user.id, nome: v.nome, email: v.email, papel: v.papel, plataforma: false, cliente_id: cliente, ativo: true,
      });
      if (e2) {
        // Desfaz a conta recém-criada no Auth: ninguém entrou nem há histórico
        // apontando para ela (é a única exceção ao "nunca deleteUser").
        await admin.auth.admin.deleteUser(criado.user.id);
        throw new Falha(e2.code === VIOLACAO_UNICA ? "Já existe uma conta com este e-mail." : `Não consegui cadastrar (${e2.message}).`, e2.code === VIOLACAO_UNICA ? 409 : 500);
      }
      await auditar(cliente, criado.user.id, eu.id, "insert", ["nome", "email", "papel"]);
      return { ok: true, id: criado.user.id, nome: v.nome, mensagem: `Conta de ${v.nome} criada.`, link: await gerarLink(v.email) };
    }

    case "link": {
      const { linha, alvo } = await carregarAlvo(p.usuario_id);
      exigir(podeGerarLink(eu, alvo));
      const link = await gerarLink(linha.email);
      await auditar(linha.cliente_id, linha.id, eu.id, "update", ["link de acesso gerado"]);
      return { ok: true, nome: linha.nome, link };
    }

    case "papel": {
      const { linha, alvo } = await carregarAlvo(p.usuario_id);
      exigir(podeMudarPapel(eu, alvo));
      if (p.papel !== "admin" && p.papel !== "membro") throw new Falha("Papel inválido.", 400);
      if (p.papel === linha.papel) return { ok: true, mensagem: "Nada mudou." };
      const { error } = await admin.from("usuarios").update({ papel: p.papel }).eq("id", linha.id);
      if (error) throw new Falha(`Não consegui mudar o papel (${error.message}).`, 500);
      await auditar(linha.cliente_id, linha.id, eu.id, "update", ["papel"]);
      return { ok: true, mensagem: `${linha.nome} agora é ${p.papel === "admin" ? "administrador(a)" : "membro"}.` };
    }

    case "desativar": {
      const { linha, alvo } = await carregarAlvo(p.usuario_id);
      exigir(podeDesativar(eu, alvo));
      // primeiro o Auth (corta a entrada), depois o cadastro
      const { error } = await admin.auth.admin.updateUserById(linha.id, { ban_duration: BANIDO });
      if (error) throw new Falha(`Não consegui bloquear a entrada (${error.message}).`, 500);
      const { error: e2 } = await admin.from("usuarios").update({ ativo: false }).eq("id", linha.id);
      if (e2) throw new Falha(`A entrada foi bloqueada, mas o cadastro não mudou (${e2.message}). Tente de novo.`, 500);
      await auditar(linha.cliente_id, linha.id, eu.id, "update", ["ativo"]);
      return { ok: true, mensagem: `${linha.nome} não entra mais na DashMed. O histórico dela continua.` };
    }

    case "reativar": {
      const { linha, alvo } = await carregarAlvo(p.usuario_id);
      exigir(podeReativar(eu, alvo));
      const { error } = await admin.auth.admin.updateUserById(linha.id, { ban_duration: "none" });
      if (error) throw new Falha(`Não consegui liberar a entrada (${error.message}).`, 500);
      const { error: e2 } = await admin.from("usuarios").update({ ativo: true }).eq("id", linha.id);
      if (e2) throw new Falha(`A entrada foi liberada, mas o cadastro não mudou (${e2.message}). Tente de novo.`, 500);
      await auditar(linha.cliente_id, linha.id, eu.id, "update", ["ativo"]);
      return { ok: true, mensagem: `${linha.nome} pode entrar de novo.` };
    }

    default:
      throw new Falha("Ação desconhecida.", 400);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ erro: "Use POST." }, 405);
  try {
    return responder(await atender(req));
  } catch (e) {
    return respostaDeErro(e);
  }
});
