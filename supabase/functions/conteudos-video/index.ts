// Vídeo com o avatar do próprio médico na HeyGen (passo 3 do fluxo do David,
// 10/11/26: "o vídeo deve seguir a imagem, ou seja eu").
//
// gerar:     manda o roteiro pronto para a HeyGen, uma cena de avatar por
//            trecho (até 5.000 caracteres por cena). Custa dinheiro: só sai com
//            a confirmação explícita do médico (regra 4) e com chave de
//            idempotência (clique duplo não paga duas vezes — regra 1).
// atualizar: confere o estado na HeyGen.
// link:      pega na HeyGen o link (temporário) do arquivo, das legendas e da
//            miniatura. Não guardamos o link porque ele expira.
import { admin, CORS, corpoJson, ehUuid, enxerga, Falha, quemPediu, responder, respostaDeErro, SUPABASE_URL, VIOLACAO_UNICA } from "../_shared/base.ts";
import { consultarVideo, criarVideo } from "../_shared/heygen.ts";
import { contarPalavras, dividirEmCenas, MAX_CENAS, PALAVRAS_POR_MINUTO } from "../_shared/texto.ts";
import { chaveHeygen, type LinhaVideo, sincronizar } from "../_shared/videos.ts";

type Pedido = { acao?: string; roteiro_id?: string; video_id?: string; formato?: string; confirmo_custo?: boolean };

function token(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") throw new Falha("Use POST.", 405);
    const eu = await quemPediu(req);
    const p = await corpoJson<Pedido>(req);

    if (p.acao === "gerar") {
      if (!ehUuid(p.roteiro_id)) throw new Falha("Roteiro inválido.");
      const formato = p.formato === "9:16" ? "9:16" : "16:9";
      const { data: r } = await admin.from("roteiros").select("id, cliente_id, estado, titulo")
        .eq("id", p.roteiro_id).is("deleted_at", null).maybeSingle();
      if (!r || !enxerga(eu, r.cliente_id)) throw new Falha("Roteiro não encontrado.", 404);
      if (r.estado !== "pronto") throw new Falha("O roteiro ainda não está pronto.", 409);
      if (!p.confirmo_custo) throw new Falha("Confirme que sabe que o vídeo consome créditos da HeyGen.", 412);

      const chave = await chaveHeygen(r.cliente_id);
      const { data: integ } = await admin.from("integracoes").select("parametros")
        .eq("cliente_id", r.cliente_id).eq("provedor", "heygen").maybeSingle();
      const par = (integ?.parametros ?? {}) as { avatar_id?: string; voz_id?: string; motor?: string | null; avatar_nome?: string; voz_nome?: string };
      if (!par.avatar_id || !par.voz_id) throw new Falha("Escolha o seu avatar e a sua voz em Configurações → HeyGen.", 412);

      const { data: blocos } = await admin.from("roteiro_blocos").select("fala").eq("roteiro_id", r.id).order("ordem");
      const cenas = dividirEmCenas((blocos ?? []).map((b) => b.fala as string));
      if (!cenas.length) throw new Falha("O roteiro está sem texto.", 409);
      if (cenas.length > MAX_CENAS) throw new Falha(`O roteiro deu ${cenas.length} cenas; a HeyGen aceita no máximo ${MAX_CENAS}. Encurte o texto.`, 409);
      const palavras = cenas.reduce((s, c) => s + contarPalavras(c), 0);

      const retorno = token();
      const { data: v, error } = await admin.from("videos").insert({
        cliente_id: r.cliente_id, roteiro_id: r.id, formato, motor: par.motor ?? null, avatar_nome: par.avatar_nome ?? null,
        voz_nome: par.voz_nome ?? null, minutos_estimados: Math.round((palavras / PALAVRAS_POR_MINUTO) * 10) / 10,
        retorno_token: retorno, criado_por: eu.id, estado: "enviando",
      }).select("id").single();
      if (error?.code === VIOLACAO_UNICA) throw new Falha(`Já há um vídeo ${formato} deste roteiro sendo gerado. Espere ele terminar.`, 409);
      if (error) throw new Falha(`Não consegui registrar o vídeo (${error.message}).`, 500);

      try {
        const h = await criarVideo(chave, {
          titulo: r.titulo ?? "Vídeo DashMed", avatarId: par.avatar_id, vozId: par.voz_id, motor: par.motor ?? null, formato, cenas,
          retornoUrl: `${SUPABASE_URL}/functions/v1/heygen-retorno?v=${v.id}&t=${retorno}`, retornoId: v.id, idempotencia: v.id,
        });
        await admin.from("videos").update({ provedor_video_id: h.video_id, estado: "processando", msg: null }).eq("id", v.id);
        return responder({ ok: true, video_id: v.id, mensagem: `Vídeo enviado à HeyGen (${cenas.length} cenas). A HeyGen avisa quando ficar pronto.` });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await admin.from("videos").update({ estado: "falhou", msg }).eq("id", v.id);
        throw e;
      }
    }

    if (p.acao === "atualizar" || p.acao === "link") {
      if (!ehUuid(p.video_id)) throw new Falha("Vídeo inválido.");
      const { data: v } = await admin.from("videos").select("id, cliente_id, estado, provedor_video_id, retorno_token")
        .eq("id", p.video_id).is("deleted_at", null).maybeSingle();
      if (!v || !enxerga(eu, v.cliente_id)) throw new Falha("Vídeo não encontrado.", 404);
      if (!v.provedor_video_id) throw new Falha("Este vídeo não chegou a ser aceito pela HeyGen.", 409);

      if (p.acao === "atualizar") {
        const h = await sincronizar(v as LinhaVideo);
        return responder({ ok: true, estado: h?.status ?? v.estado });
      }
      if (v.estado !== "pronto") throw new Falha("O vídeo ainda não está pronto.", 409);
      const h = await consultarVideo(await chaveHeygen(v.cliente_id), v.provedor_video_id);
      if (h.status !== "completed" || !h.video_url) throw new Falha("A HeyGen não devolveu o link do vídeo agora. Tente de novo em instantes.", 502);
      return responder({
        ok: true, video_url: h.video_url, legendado_url: h.captioned_video_url ?? null, legenda_url: h.subtitle_url ?? null,
        miniatura_url: h.thumbnail_url ?? null, pagina_url: h.video_page_url ?? null,
      });
    }

    throw new Falha("Ação desconhecida.", 400);
  } catch (e) {
    return respostaDeErro(e);
  }
});
