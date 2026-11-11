// Retorno (webhook) da HeyGen quando o vídeo termina ou falha. Sem JWT (quem
// chama é a HeyGen), então a URL leva um token por vídeo; e o corpo recebido
// não é confiado: só "cutuca", e o estado é conferido na API da HeyGen com a
// chave do cliente (regra 3). Responde rápido (a HeyGen espera 2xx em 10 s).
import { admin, CORS, Falha, responder, respostaDeErro } from "../_shared/base.ts";
import { type LinhaVideo, sincronizar } from "../_shared/videos.ts";

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("v") ?? "";
    const t = url.searchParams.get("t") ?? "";
    await req.body?.cancel();
    if (!/^[0-9a-f-]{36}$/i.test(id) || !t) throw new Falha("Retorno sem identificação.", 400);
    const { data: v } = await admin.from("videos").select("id, cliente_id, estado, provedor_video_id, retorno_token")
      .eq("id", id).maybeSingle();
    if (!v || !iguais(v.retorno_token, t)) throw new Falha("Retorno não reconhecido.", 401);
    if (v.estado === "processando" || v.estado === "enviando") await sincronizar(v as LinhaVideo);
    return responder({ ok: true });
  } catch (e) {
    return respostaDeErro(e);
  }
});
