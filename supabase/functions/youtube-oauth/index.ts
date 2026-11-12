// Conectar o canal do YouTube (OAuth do Google), para o YouTube Seller ler os
// comentários e publicar as respostas que o médico aprovar (David, 12/11/26).
//
// POST {acao: "iniciar", cliente_id, retorno} (com a sessão): devolve a URL do
//   Google. O "state" é uma linha em oauth_estados (vale 15 min, uma vez só).
// GET ?code&state (volta do Google): troca o código pelos tokens, guarda o
//   refresh token no Vault, descobre o canal e volta para a DashMed.
// Sem JWT no gateway (quem volta é o navegador vindo do Google); a proteção é o
// state, que só a edge conhece e que expira.
import { administra, admin, CORS, corpoJson, ehUuid, enxerga, Falha, quemPediu, responder, respostaDeErro } from "../_shared/base.ts";
import { canalDoToken, credenciaisGoogle, ESCOPO_YOUTUBE, REDIRECT_OAUTH, trocarCodigo } from "../_shared/youtube.ts";

const ORIGENS = ["https://dashmed-app.vercel.app", "http://localhost:3000"];
const PADRAO_RETORNO = "https://dashmed-app.vercel.app/configuracoes";

function retornoSeguro(r: unknown): string {
  if (typeof r !== "string") return PADRAO_RETORNO;
  try {
    const u = new URL(r);
    return ORIGENS.includes(u.origin) ? `${u.origin}${u.pathname}` : PADRAO_RETORNO;
  } catch {
    return PADRAO_RETORNO;
  }
}

function voltar(retorno: string, resultado: "ok" | "erro", msg?: string): Response {
  const u = new URL(retorno);
  u.searchParams.set("youtube", resultado);
  if (msg) u.searchParams.set("msg", msg.slice(0, 300));
  return new Response(null, { status: 302, headers: { Location: u.toString() } });
}

async function iniciar(req: Request): Promise<Response> {
  const eu = await quemPediu(req);
  const p = await corpoJson<{ cliente_id?: string; retorno?: string }>(req);
  if (!ehUuid(p.cliente_id) || !enxerga(eu, p.cliente_id)) throw new Falha("Cliente inválido.", 403);
  if (!administra(eu, p.cliente_id)) throw new Falha("Só o administrador do cliente ou a equipe da plataforma conecta o canal.", 403);
  const { clientId } = await credenciaisGoogle(p.cliente_id);
  const { data: estado, error } = await admin.from("oauth_estados")
    .insert({ cliente_id: p.cliente_id, usuario_id: eu.id, provedor: "youtube", retorno: retornoSeguro(p.retorno) })
    .select("id").single();
  if (error) throw new Falha(`Não consegui começar a conexão (${error.message}).`, 500);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: REDIRECT_OAUTH, response_type: "code", scope: ESCOPO_YOUTUBE,
    // offline + consent: o Google manda o refresh token (acesso contínuo)
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state: estado.id,
  }).toString();
  return responder({ ok: true, url: url.toString() });
}

async function volta(url: URL): Promise<Response> {
  const state = url.searchParams.get("state") ?? "";
  if (!ehUuid(state)) return new Response("Conexão sem identificação. Volte à DashMed e tente de novo.", { status: 400 });
  // usa o estado uma vez só, e só se for recente
  const limite = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: estado } = await admin.from("oauth_estados").update({ usado_em: new Date().toISOString() })
    .eq("id", state).is("usado_em", null).gt("criado_em", limite)
    .select("cliente_id, usuario_id, retorno").maybeSingle();
  if (!estado) return voltar(PADRAO_RETORNO, "erro", "A conexão expirou ou já foi usada. Clique em \"Conectar canal\" de novo.");
  const retorno = estado.retorno as string;
  try {
    const erroGoogle = url.searchParams.get("error");
    if (erroGoogle) {
      return voltar(retorno, "erro", erroGoogle === "access_denied" ? "Você não autorizou o acesso ao YouTube." : `O Google recusou: ${erroGoogle}.`);
    }
    const codigo = url.searchParams.get("code");
    if (!codigo) return voltar(retorno, "erro", "O Google não devolveu o código de autorização.");
    const { clientId, clientSecret } = await credenciaisGoogle(estado.cliente_id);
    const tokens = await trocarCodigo(clientId, clientSecret, codigo);
    if (!tokens.refresh_token) {
      return voltar(retorno, "erro", "O Google não mandou o acesso contínuo. Remova o app em myaccount.google.com/permissions e conecte de novo.");
    }
    if (tokens.scope && !tokens.scope.includes("youtube.force-ssl")) {
      return voltar(retorno, "erro", "A permissão para gerenciar comentários não foi concedida. Conecte de novo e marque a permissão do YouTube.");
    }
    const canal = await canalDoToken(tokens.access_token);
    if (!canal) return voltar(retorno, "erro", "Essa conta do Google não tem canal do YouTube. Entre com a conta do canal.");

    const { error: e1 } = await admin.rpc("guardar_segredo", { p_cliente: estado.cliente_id, p_provedor: "youtube", p_valor: tokens.refresh_token });
    if (e1) throw new Falha(`Não consegui guardar o acesso no cofre (${e1.message}).`, 500);
    const agora = new Date().toISOString();
    const { error: e2 } = await admin.from("integracoes").upsert({
      cliente_id: estado.cliente_id, provedor: "youtube", final: canal.id.slice(-4),
      parametros: { canal_id: canal.id, canal_titulo: canal.titulo, canal_foto: canal.foto, conectado_em: agora },
      teste_ok: true, teste_msg: `Canal "${canal.titulo}" conectado.`, testada_em: agora, atualizado_por: estado.usuario_id,
    }, { onConflict: "cliente_id,provedor" });
    if (e2) throw new Falha(`O acesso foi guardado, mas o registro falhou (${e2.message}).`, 500);

    // canal novo (ou trocado): a varredura começa do zero para este canal
    const { data: v } = await admin.from("yt_varreduras").select("canal_id").eq("cliente_id", estado.cliente_id).maybeSingle();
    if (!v || v.canal_id !== canal.id) {
      await admin.from("yt_varreduras").upsert({
        cliente_id: estado.cliente_id, canal_id: canal.id, estado: "parada", msg: null, mais_novo_em: null,
        historico_token: null, historico_ate: null, historico_completo: false,
      }, { onConflict: "cliente_id" });
    }
    return voltar(retorno, "ok");
  } catch (e) {
    return voltar(retorno, "erro", e instanceof Error ? e.message : String(e));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    if (req.method === "GET") return await volta(url);
    if (req.method === "POST") return await iniciar(req);
    throw new Falha("Método não aceito.", 405);
  } catch (e) {
    return respostaDeErro(e);
  }
});
