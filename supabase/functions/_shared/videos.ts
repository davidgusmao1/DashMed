// Estado do vídeo vem SEMPRE da HeyGen (regra 3): o retorno (webhook) e o
// botão "atualizar" só disparam esta conferência.
import { admin, Falha, lerSegredo } from "./base.ts";
import { consultarVideo, type VideoHeygen } from "./heygen.ts";

export type LinhaVideo = {
  id: string;
  cliente_id: string;
  estado: string;
  provedor_video_id: string | null;
  retorno_token: string;
};

export async function chaveHeygen(clienteId: string): Promise<string> {
  const chave = await lerSegredo(clienteId, "heygen");
  if (!chave) throw new Falha("Falta a chave da HeyGen. Coloque em Configurações → Chaves de API.", 412);
  return chave;
}

/** Confere na HeyGen e grava o estado. Devolve o que a HeyGen disse. */
export async function sincronizar(v: LinhaVideo): Promise<VideoHeygen | null> {
  if (!v.provedor_video_id) return null;
  const h = await consultarVideo(await chaveHeygen(v.cliente_id), v.provedor_video_id);
  const mudanca: Record<string, unknown> = {};
  if (h.status === "completed") {
    mudanca.estado = "pronto";
    mudanca.msg = null;
    mudanca.duracao_seg = h.duration ?? null;
  } else if (h.status === "failed") {
    mudanca.estado = "falhou";
    mudanca.msg = `A HeyGen não conseguiu gerar o vídeo: ${h.failure_message ?? h.failure_code ?? "motivo não informado"}.`;
  } else {
    mudanca.estado = "processando";
  }
  const { error } = await admin.from("videos").update(mudanca).eq("id", v.id);
  if (error) throw new Falha(`Conferi na HeyGen, mas não consegui gravar o estado (${error.message}).`, 500);
  return h;
}
