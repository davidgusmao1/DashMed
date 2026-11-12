// Publicar no YouTube a resposta que o médico aprovou, e refazer a sugestão
// (YouTube Seller, David, 12/11/26: "responder em meu nome").
//
// publicar: só com a sessão de quem revisou (as políticas da API do YouTube
//   exigem o consentimento expresso de quem publica). Antes de publicar:
//   - troca de estado atômica (clique duplo não publica duas vezes — regra 1);
//   - limite diário (política de spam do YouTube);
//   - confere no YouTube se o canal já respondeu à mão (humano ganha — regra 4).
//   Publicada a resposta, o lead vai para "respondido" e o histórico registra.
// refazer: a IA escreve outra sugestão (com o pedido do médico, se houver).
import { admin, CORS, corpoJson, ehUuid, enxerga, Falha, quemPediu, responder, respostaDeErro } from "../_shared/base.ts";
import { carregarConfig, gravarRedacao, paraRedigir, redigir } from "../_shared/seller.ts";
import { canalConectado, canalJaRespondeu, gastarCota, publicarResposta, tokenDeAcesso } from "../_shared/youtube.ts";

type Pedido = { acao?: string; comentario_id?: string; texto?: string; instrucao?: string; sobrescrever?: boolean };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") throw new Falha("Use POST.", 405);
    const eu = await quemPediu(req);
    const p = await corpoJson<Pedido>(req);
    if (!ehUuid(p.comentario_id)) throw new Falha("Comentário inválido.");
    const { data: c } = await admin.from("yt_comentarios")
      .select("id, cliente_id, comentario_id, resposta, rascunho, rascunho_editado, lead_id, pode_responder")
      .eq("id", p.comentario_id).is("deleted_at", null).maybeSingle();
    if (!c || !enxerga(eu, c.cliente_id)) throw new Falha("Comentário não encontrado.", 404);

    if (p.acao === "publicar") {
      const texto = String(p.texto ?? "").trim();
      if (texto.length < 2) throw new Falha("A resposta está vazia.");
      if (texto.length > 2000) throw new Falha("Resposta longa demais (até 2.000 caracteres).");
      if (c.resposta === "publicada") throw new Falha("Este comentário já foi respondido pela DashMed.", 409);
      if (!["rascunho", "falhou"].includes(c.resposta)) throw new Falha("Este comentário não está na fila de resposta.", 409);
      if (!c.pode_responder) throw new Falha("O YouTube não deixa responder este comentário.", 409);

      const config = await carregarConfig(c.cliente_id);
      const inicioDoDia = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
      inicioDoDia.setHours(0, 0, 0, 0);
      // início do dia em São Paulo, em UTC (Brasília é UTC−3, sem horário de verão)
      const desde = new Date(inicioDoDia.getTime() + 3 * 3600_000).toISOString();
      const { count } = await admin.from("yt_comentarios").select("id", { count: "exact", head: true })
        .eq("cliente_id", c.cliente_id).eq("resposta", "publicada").gte("publicada_em", desde);
      if ((count ?? 0) >= config.limite_diario) {
        throw new Falha(`Limite de ${config.limite_diario} respostas por dia atingido (proteção contra spam no YouTube). Ajuste em Configurações → YouTube Seller.`, 429);
      }

      // trava: só um "publicar" passa
      const { data: travou } = await admin.from("yt_comentarios").update({
        resposta: "publicando", rascunho: texto, rascunho_editado: c.rascunho_editado || texto !== (c.rascunho ?? "").trim(), resposta_msg: null,
      }).eq("id", c.id).in("resposta", ["rascunho", "falhou"]).select("id");
      if (!travou?.length) throw new Falha("Esta resposta já está sendo publicada.", 409);

      try {
        const canal = await canalConectado(c.cliente_id);
        const token = await tokenDeAcesso(c.cliente_id);
        await gastarCota(c.cliente_id, 1);
        if (await canalJaRespondeu(token, c.comentario_id, canal.canal_id)) {
          await admin.from("yt_comentarios").update({
            resposta: "ignorada", ja_respondido: true, resposta_msg: "Você já respondeu este comentário direto no YouTube; a DashMed não publicou nada.",
          }).eq("id", c.id);
          if (c.lead_id) await admin.from("leads").update({ etapa: "respondido" }).eq("id", c.lead_id).eq("etapa", "novo");
          throw new Falha("Você já respondeu este comentário direto no YouTube. Nada foi publicado.", 409);
        }
        await gastarCota(c.cliente_id, 51);
        const idYoutube = await publicarResposta(token, c.comentario_id, texto);
        const agora = new Date().toISOString();
        await admin.from("yt_comentarios").update({
          resposta: "publicada", resposta_youtube_id: idYoutube, publicada_em: agora, publicada_por: eu.id, resposta_msg: null,
        }).eq("id", c.id);
        if (c.lead_id) {
          await admin.from("lead_eventos").insert({ cliente_id: c.cliente_id, lead_id: c.lead_id, tipo: "resposta", texto: texto.slice(0, 4000), comentario_id: c.id, feito_por: eu.id });
          await admin.from("leads").update({ etapa: "respondido" }).eq("id", c.lead_id).eq("etapa", "novo");
        }
        return responder({ ok: true, mensagem: "Resposta publicada no YouTube." });
      } catch (e) {
        // se não foi o "já respondeu" (que já gravou o motivo), volta para a
        // fila com o motivo; a publicação não aconteceu
        const msg = e instanceof Error ? e.message : String(e);
        await admin.from("yt_comentarios").update({ resposta: "falhou", resposta_msg: msg })
          .eq("id", c.id).eq("resposta", "publicando");
        throw e;
      }
    }

    if (p.acao === "refazer") {
      if (["publicada", "publicando"].includes(c.resposta)) throw new Falha("Esta resposta já foi publicada.", 409);
      if (c.rascunho_editado && !p.sobrescrever) {
        throw new Falha("Você editou esta resposta. Confirme que quer trocar o seu texto pela nova sugestão da IA.", 409);
      }
      if (!c.lead_id) throw new Falha("Este comentário não virou lead; não há resposta a sugerir.", 409);
      const config = await carregarConfig(c.cliente_id);
      const itens = await paraRedigir({ clienteId: c.cliente_id, ids: [c.id], limite: 1 });
      const r = await gravarRedacao(itens, await redigir(c.cliente_id, itens, config, (p.instrucao ?? "").slice(0, 500) || undefined));
      return responder({ ok: true, mensagem: r.ok ? "Nova sugestão pronta." : "A IA escreveu, mas há um problema na sugestão (veja o motivo)." });
    }

    throw new Falha("Ação desconhecida.", 400);
  } catch (e) {
    return respostaDeErro(e);
  }
});
