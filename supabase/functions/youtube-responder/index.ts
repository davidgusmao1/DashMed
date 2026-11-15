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
// Publicar e refazer valem também para o comentário achado na busca, mesmo
//   fora da fila e sem lead (David, 15/11/26: "responder com IA" na busca).
// Quem o médico responde vira lead (David, 15/11/26: "Sim, virar lead"):
//   antes de a IA escrever, ao pôr o código no texto (ação lead) e depois de
//   publicar, o comentário é ligado ao lead da pessoa (ligar_lead_ao_comentario,
//   0021). Assim a resposta leva o código YT que a secretária usa. Menos o
//   agradecimento de elogio: não é oferta de consulta, a pessoa não vira lead.
// Enviar para revisar (15/11/26): refazer com `marcar` escreve e já deixa a
//   resposta com a barra verde na fila (revisada_em, 0021).
// aprender / pautas: a IA propõe (regras de treinamento, temas de vídeo); a
//   equipe decide na tela o que fica.
// buscar: a IA traduz a frase de busca em critérios; quem acha é o banco
//   (buscar_comentarios, 0020) e a tela mostra os critérios para conferir.
// buscar_youtube: com os critérios, busca direto no YouTube e grava no DashMed
//   o que ainda não estava (só lê; não responde nada).
import { administra, admin, CORS, corpoJson, ehUuid, enxerga, Falha, quemPediu, responder, respostaDeErro } from "../_shared/base.ts";
import { buscarNoYoutube, interpretarBusca } from "../_shared/busca.ts";
import { acharPautas, aprenderComEdicoes, carregarConfig, ESTADOS_RESPONDIVEIS, gravarRedacao, paraRedigir, redigir } from "../_shared/seller.ts";
import { canalConectado, canalJaRespondeu, gastarCota, publicarResposta, tokenDeAcesso } from "../_shared/youtube.ts";

type Pedido = {
  acao?: string; comentario_id?: string; cliente_id?: string; texto?: string; instrucao?: string; sobrescrever?: boolean;
  marcar?: boolean; filtro?: Record<string, unknown>;
};

type Ligacao = { lead_id: string | null; codigo: string | null; motivo: string | null; descartados: number };

/** Liga o comentário ao lead da pessoa (cria o lead se preciso) e põe o
 *  comentário e a resposta publicada no histórico (0021). Repetir não muda nada. */
async function ligarLead(comentarioId: string): Promise<Ligacao> {
  const { data, error } = await admin.rpc("ligar_lead_ao_comentario", { p_comentario: comentarioId });
  if (error) throw new Falha(`Não consegui criar o lead desta pessoa (${error.message}).`, 500);
  const r = data as Ligacao;
  // regra 1: o que já estava no histórico do lead não entra de novo
  if (r.descartados) console.warn(`youtube-responder: ${r.descartados} registro(s) repetido(s) do histórico do lead descartado(s) (comentário ${comentarioId})`);
  return r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") throw new Falha("Use POST.", 405);
    const eu = await quemPediu(req);
    const p = await corpoJson<Pedido>(req);

    // aprender com as edições (14/11/26): a IA PROPÕE regras; quem salva como
    // treinamento é o médico, na tela
    if (p.acao === "aprender") {
      if (!ehUuid(p.cliente_id)) throw new Falha("Cliente inválido.");
      if (!administra(eu, p.cliente_id)) throw new Falha("Só o administrador do cliente ou a equipe da plataforma treina a IA.", 403);
      return responder({ ok: true, ...(await aprenderComEdicoes(p.cliente_id)) });
    }

    // pautas (14/11/26): a IA agrupa as perguntas dos comentários em temas de
    // vídeo; quem decide o que vira conteúdo é a equipe, na tela
    if (p.acao === "pautas") {
      if (!ehUuid(p.cliente_id)) throw new Falha("Cliente inválido.");
      if (!enxerga(eu, p.cliente_id)) throw new Falha("Cliente não encontrado.", 404);
      const r = await acharPautas(p.cliente_id);
      return responder({ ok: true, mensagem: `${r.pautas} pauta(s) a partir de ${r.analisados} pergunta(s) dos comentários.` });
    }

    // busca por frase (15/11/26): só traduz; não lê nem muda comentário
    if (p.acao === "buscar") {
      if (!ehUuid(p.cliente_id)) throw new Falha("Cliente inválido.");
      if (!enxerga(eu, p.cliente_id)) throw new Falha("Cliente não encontrado.", 404);
      const frase = String(p.texto ?? "").replace(/\s+/g, " ").trim();
      if (frase.length < 2) throw new Falha("Escreva o que você quer buscar.");
      if (frase.length > 300) throw new Falha("A busca passou de 300 caracteres; encurte a frase.");
      return responder({ ok: true, ...(await interpretarBusca(p.cliente_id, frase)) });
    }

    // busca direto no YouTube (15/11/26): pergunta ao YouTube com os critérios
    // e grava no DashMed o que ainda não estava; a tela busca no banco depois
    if (p.acao === "buscar_youtube") {
      if (!ehUuid(p.cliente_id)) throw new Falha("Cliente inválido.");
      if (!enxerga(eu, p.cliente_id)) throw new Falha("Cliente não encontrado.", 404);
      if (!p.filtro || typeof p.filtro !== "object" || Array.isArray(p.filtro)) throw new Falha("Critérios de busca inválidos.");
      return responder({ ok: true, youtube: await buscarNoYoutube(p.cliente_id, p.filtro) });
    }

    if (!ehUuid(p.comentario_id)) throw new Falha("Comentário inválido.");
    const { data: c } = await admin.from("yt_comentarios")
      .select("id, cliente_id, comentario_id, resposta, rascunho, rascunho_editado, lead_id, pode_responder, conversa_de, publicado_em, texto, autor_canal_id, ja_respondido, categoria")
      .eq("id", p.comentario_id).is("deleted_at", null).maybeSingle();
    if (!c || !enxerga(eu, c.cliente_id)) throw new Falha("Comentário não encontrado.", 404);

    // da fila ou da busca (15/11/26): qualquer comentário ainda sem resposta
    // publicada, menos o de quem pediu para sair (LGPD, marca da 0018)
    const podeGanharResposta = () => {
      if (c.resposta === "publicada") throw new Falha("Este comentário já foi respondido pela DashMed.", 409);
      if (c.resposta === "publicando") throw new Falha("Esta resposta já está sendo publicada.", 409);
      if (!ESTADOS_RESPONDIVEIS.includes(c.resposta)) throw new Falha("Este comentário não pode ser respondido agora.", 409);
      if (!c.autor_canal_id && String(c.texto).startsWith("[comentário anonimizado")) {
        throw new Falha("Esta pessoa pediu para apagar os dados (LGPD): o comentário não recebe resposta.", 409);
      }
      if (!c.pode_responder) throw new Falha("O YouTube não deixa responder este comentário.", 409);
    };

    // agradecer elogio não faz de ninguém lead (15/11/26: elogios entram na
    // fila para um agradecimento simples); o CRM e o funil ficam com quem pode
    // virar consulta
    const viraLead = !!c.lead_id || c.categoria !== "elogio";

    // "Pôr o código no texto" (15/11/26): a pessoa vira lead já, para o médico
    // escrever o código na resposta dele
    if (p.acao === "lead") {
      podeGanharResposta();
      const r = await ligarLead(c.id);
      if (!r.lead_id) throw new Falha(r.motivo ?? "Não consegui criar o lead desta pessoa.", 409);
      return responder({ ok: true, mensagem: c.lead_id ? `Lead ${r.codigo}.` : `A pessoa virou lead (${r.codigo}).`, lead_id: r.lead_id, codigo: r.codigo });
    }

    if (p.acao === "publicar") {
      const texto = String(p.texto ?? "").trim();
      if (texto.length < 2) throw new Falha("A resposta está vazia.");
      if (texto.length > 2000) throw new Falha("Resposta longa demais (até 2.000 caracteres).");
      podeGanharResposta();

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
      }).eq("id", c.id).in("resposta", ESTADOS_RESPONDIVEIS).select("id");
      if (!travou?.length) throw new Falha("Esta resposta já está sendo publicada.", 409);

      try {
        const canal = await canalConectado(c.cliente_id);
        const token = await tokenDeAcesso(c.cliente_id);
        await gastarCota(c.cliente_id, 1);
        // continuação de conversa: só conta resposta do canal depois da mensagem
        if (await canalJaRespondeu(token, c.comentario_id, canal.canal_id, c.conversa_de ? c.publicado_em : undefined)) {
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
        // a resposta já saiu: o lead (criar, histórico, "respondido") não
        // desfaz a publicação; se falhar, avisa e o vigia liga em 10 minutos
        let sobreLead = "";
        if (viraLead) try {
          const l = await ligarLead(c.id);
          if (!c.lead_id && l.lead_id) sobreLead = ` A pessoa virou lead (${l.codigo}).`;
          else if (!l.lead_id && l.motivo) sobreLead = ` ${l.motivo}`;
        } catch (e) {
          sobreLead = ` Mas não consegui ligar o lead (${e instanceof Error ? e.message : String(e)}); o vigia tenta de novo em 10 minutos.`;
        }
        return responder({ ok: true, mensagem: `Resposta publicada no YouTube.${sobreLead}` });
      } catch (e) {
        // se não foi o "já respondeu" (que já gravou o motivo), volta para a
        // fila com o motivo; a publicação não aconteceu
        const msg = e instanceof Error ? e.message : String(e);
        await admin.from("yt_comentarios").update({ resposta: "falhou", resposta_msg: msg })
          .eq("id", c.id).eq("resposta", "publicando");
        throw e;
      }
    }

    // refazer (fila) e "Responder com IA" (busca, 15/11/26): a IA escreve a
    // sugestão; ela vai para a fila e volta para a tela. Nada é publicado.
    if (p.acao === "refazer") {
      podeGanharResposta();
      if (c.ja_respondido) throw new Falha("Você já respondeu este comentário direto no YouTube.", 409);
      if (c.rascunho_editado && c.rascunho && !p.sobrescrever) {
        throw new Falha("Você editou esta resposta. Confirme que quer trocar o seu texto pela nova sugestão da IA.", 409);
      }
      // vira lead antes de a IA escrever: a resposta já sai com o código YT
      const ligacao = c.lead_id || !viraLead ? null : await ligarLead(c.id);
      const config = await carregarConfig(c.cliente_id);
      const itens = await paraRedigir({ clienteId: c.cliente_id, ids: [c.id], limite: 1 });
      const r = await gravarRedacao(itens, await redigir(c.cliente_id, itens, config, (p.instrucao ?? "").slice(0, 500) || undefined));
      if (r.pulados) throw new Falha("O comentário mudou enquanto a IA escrevia (foi publicado ou está sendo). Atualize a página.", 409);
      // "Enviar para revisar": a resposta boa já fica com a barra verde; a com
      // problema fica na fila sem a barra, com o motivo, para corrigir
      if (p.marcar && r.ok) {
        const { error } = await admin.from("yt_comentarios").update({ revisada_em: new Date().toISOString() }).eq("id", c.id).eq("resposta", "rascunho");
        if (error) throw new Falha(`A IA escreveu, mas não consegui marcar como revisada (${error.message}).`, 500);
      }
      const { data: novo } = await admin.from("yt_comentarios").select("rascunho, resposta_msg, video_sugerido, lead_id, revisada_em").eq("id", c.id).maybeSingle();
      const { data: lead } = novo?.lead_id ? await admin.from("leads").select("codigo").eq("id", novo.lead_id).maybeSingle() : { data: null };
      const virouLead = ligacao?.lead_id ? ` A pessoa virou lead (${ligacao.codigo}).` : ligacao?.motivo ? ` ${ligacao.motivo}` : "";
      return responder({
        ok: true, mensagem: `${r.ok ? "Nova sugestão pronta." : "A IA escreveu, mas há um problema na sugestão (veja o motivo)."}${virouLead}`,
        texto: novo?.rascunho ?? "", problema: novo?.resposta_msg ?? null, video_sugerido: novo?.video_sugerido ?? null,
        lead_id: novo?.lead_id ?? null, codigo: lead?.codigo ?? null, revisada: !!novo?.revisada_em,
      });
    }

    throw new Falha("Ação desconhecida.", 400);
  } catch (e) {
    return respostaDeErro(e);
  }
});
