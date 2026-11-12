// Chaves de API do cliente (Configurações → Chaves de API). O valor vai para o
// Vault e nunca volta para o navegador; a tela recebe só se existe, os 4
// últimos caracteres e o resultado do último teste (David, 10/11/26: "nas
// configurações do sistema faça um local onde eu posso colocar as APIs/tokens").
import {
  administra, admin, CORS, corpoJson, ehUuid, enxerga, Falha, lerSegredo, type Provedor, quemPediu, responder,
  respostaDeErro, type Usuario,
} from "../_shared/base.ts";
import { testarChaveAnthropic } from "../_shared/claude.ts";
import { listarLooksProprios, listarVozesPortugues, listarVozesProprias, saldoEmTexto, usuarioHeygen } from "../_shared/heygen.ts";
import { canalDoToken, revogar, tokenDeAcesso } from "../_shared/youtube.ts";

const PROVEDORES: Provedor[] = ["anthropic", "heygen", "google", "youtube"];
// o canal do YouTube (refresh token) só entra pelo OAuth (edge youtube-oauth)
const SALVAVEIS: Provedor[] = ["anthropic", "heygen", "google"];
const MOTORES = ["avatar_iv", "avatar_iii", "avatar_v"];

type Pedido = {
  acao?: string;
  cliente_id?: string;
  provedor?: string;
  chave?: string;
  avatar_id?: string;
  avatar_nome?: string;
  voz_id?: string;
  voz_nome?: string;
  motor?: string | null;
  client_id?: string;
};

async function testar(provedor: Provedor, chave: string, clienteId: string): Promise<string> {
  if (provedor === "anthropic") return await testarChaveAnthropic(chave);
  if (provedor === "heygen") {
    const u = await usuarioHeygen(chave);
    return `Chave válida. ${saldoEmTexto(u).replace(/^./, (c) => c.toUpperCase())}.`;
  }
  // Google e YouTube: o teste de verdade é renovar o acesso e ler o canal
  const { data } = await admin.from("integracoes").select("provedor").eq("cliente_id", clienteId).eq("provedor", "youtube").maybeSingle();
  if (provedor === "google" && !data) return "Credenciais guardadas. O teste acontece ao conectar o canal.";
  const canal = await canalDoToken(await tokenDeAcesso(clienteId));
  if (!canal) throw new Falha("O acesso funciona, mas a conta não tem canal do YouTube.", 409);
  return `Acesso ao YouTube funcionando: canal "${canal.titulo}".`;
}

function exigir(cond: boolean, msg: string, status = 403) {
  if (!cond) throw new Falha(msg, status);
}

async function atender(eu: Usuario, p: Pedido) {
  exigir(ehUuid(p.cliente_id), "Cliente inválido.", 400);
  const clienteId = p.cliente_id!;
  exigir(enxerga(eu, clienteId), "Você não tem acesso a este cliente.");

  switch (p.acao) {
    case "salvar_chave": {
      exigir(administra(eu, clienteId), "Só o administrador do cliente ou a equipe da plataforma muda as chaves.");
      const provedor = p.provedor as Provedor;
      exigir(SALVAVEIS.includes(provedor), "Provedor desconhecido.", 400);
      const chave = (p.chave ?? "").trim();
      exigir(chave.length >= 20 && chave.length <= 500 && !/\s/.test(chave), "Essa chave não parece válida (curta demais, longa demais ou com espaços).", 400);
      let parametros: Record<string, unknown> | undefined;
      let msg: string;
      if (provedor === "google") {
        // Google: não há como testar o secret sem a ida e volta do OAuth
        const clientId = (p.client_id ?? "").trim();
        exigir(/^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(clientId), "O Client ID deve terminar em .apps.googleusercontent.com.", 400);
        parametros = { client_id: clientId };
        msg = "Credenciais do Google guardadas. Agora clique em \"Conectar canal do YouTube\".";
      } else {
        // testa ANTES de guardar: chave recusada não entra
        msg = await testar(provedor, chave, clienteId);
      }
      const { error: e1 } = await admin.rpc("guardar_segredo", { p_cliente: clienteId, p_provedor: provedor, p_valor: chave });
      if (e1) throw new Falha(`Não consegui guardar a chave no cofre (${e1.message}).`, 500);
      const agora = new Date().toISOString();
      const { error: e2 } = await admin.from("integracoes").upsert({
        cliente_id: clienteId, provedor, final: chave.slice(-4), teste_ok: true, teste_msg: msg, testada_em: agora, atualizado_por: eu.id,
        ...(parametros ? { parametros } : {}),
      }, { onConflict: "cliente_id,provedor" });
      if (e2) throw new Falha(`A chave foi para o cofre, mas o registro falhou (${e2.message}).`, 500);
      return { ok: true, mensagem: msg };
    }

    case "apagar_chave": {
      exigir(administra(eu, clienteId), "Só o administrador do cliente ou a equipe da plataforma remove chaves.");
      const provedor = p.provedor as Provedor;
      exigir(PROVEDORES.includes(provedor), "Provedor desconhecido.", 400);
      // desconectar o canal: revoga também no Google
      if (provedor === "youtube") {
        const refresh = await lerSegredo(clienteId, "youtube");
        if (refresh) await revogar(refresh);
      }
      // segredo se apaga de verdade (regra 6)
      const { error: e1 } = await admin.rpc("apagar_segredo", { p_cliente: clienteId, p_provedor: provedor });
      if (e1) throw new Falha(`Não consegui apagar a chave do cofre (${e1.message}).`, 500);
      const { error: e2 } = await admin.from("integracoes").delete().eq("cliente_id", clienteId).eq("provedor", provedor);
      if (e2) throw new Falha(`A chave saiu do cofre, mas o registro ficou (${e2.message}).`, 500);
      return { ok: true, mensagem: "Chave removida." };
    }

    case "testar": {
      const provedor = p.provedor as Provedor;
      exigir(PROVEDORES.includes(provedor), "Provedor desconhecido.", 400);
      const chave = await lerSegredo(clienteId, provedor);
      exigir(!!chave, "Não há chave guardada para este provedor.", 404);
      let ok = true;
      let msg: string;
      try {
        msg = await testar(provedor, chave!, clienteId);
      } catch (e) {
        ok = false;
        msg = e instanceof Error ? e.message : String(e);
      }
      await admin.from("integracoes").update({ teste_ok: ok, teste_msg: msg, testada_em: new Date().toISOString() })
        .eq("cliente_id", clienteId).eq("provedor", provedor);
      return { ok, mensagem: msg };
    }

    case "heygen_opcoes": {
      exigir(administra(eu, clienteId), "Só o administrador do cliente ou a equipe da plataforma escolhe o avatar.");
      const chave = await lerSegredo(clienteId, "heygen");
      exigir(!!chave, "Salve primeiro a chave da HeyGen.", 412);
      const [looks, proprias, portugues] = await Promise.all([
        listarLooksProprios(chave!), listarVozesProprias(chave!), listarVozesPortugues(chave!),
      ]);
      return {
        ok: true,
        avatares: looks.map((l) => ({
          id: l.id, nome: l.name, tipo: l.avatar_type, imagem: l.preview_image_url ?? null,
          voz_padrao: l.default_voice_id ?? null, motores: l.supported_api_engines ?? [], estado: l.status ?? null,
        })),
        vozes: [
          ...proprias.map((v) => ({ id: v.voice_id, nome: v.name, idioma: v.language ?? null, propria: true, estado: v.status ?? null })),
          ...portugues.map((v) => ({ id: v.voice_id, nome: v.name, idioma: v.language ?? null, propria: false, estado: v.status ?? null })),
        ],
      };
    }

    case "salvar_heygen": {
      exigir(administra(eu, clienteId), "Só o administrador do cliente ou a equipe da plataforma escolhe o avatar.");
      exigir(!!p.avatar_id && !!p.voz_id, "Escolha o avatar e a voz.", 400);
      exigir(p.motor == null || MOTORES.includes(p.motor), "Motor de avatar desconhecido.", 400);
      const { data: linha } = await admin.from("integracoes").select("id")
        .eq("cliente_id", clienteId).eq("provedor", "heygen").maybeSingle();
      exigir(!!linha, "Salve primeiro a chave da HeyGen.", 412);
      // confere na HeyGen que o avatar é mesmo desta conta (fonte da verdade)
      const chave = await lerSegredo(clienteId, "heygen");
      const looks = await listarLooksProprios(chave!);
      const look = looks.find((l) => l.id === p.avatar_id);
      exigir(!!look, "Esse avatar não está na sua conta da HeyGen.", 400);
      if (p.motor && look!.supported_api_engines?.length) {
        exigir(look!.supported_api_engines.includes(p.motor), `Esse avatar não aceita o motor ${p.motor} pela API.`, 400);
      }
      const parametros = {
        avatar_id: p.avatar_id, avatar_nome: (p.avatar_nome ?? look!.name).slice(0, 120),
        avatar_tipo: look!.avatar_type, voz_id: p.voz_id, voz_nome: (p.voz_nome ?? "").slice(0, 120), motor: p.motor ?? null,
      };
      const { error } = await admin.from("integracoes").update({ parametros, atualizado_por: eu.id })
        .eq("cliente_id", clienteId).eq("provedor", "heygen");
      if (error) throw new Falha(`Não consegui salvar a escolha (${error.message}).`, 500);
      return { ok: true, mensagem: "Avatar e voz salvos." };
    }

    default:
      throw new Falha("Ação desconhecida.", 400);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") throw new Falha("Use POST.", 405);
    const eu = await quemPediu(req);
    return responder(await atender(eu, await corpoJson<Pedido>(req)));
  } catch (e) {
    return respostaDeErro(e);
  }
});
