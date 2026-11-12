// API do YouTube (Data API v3, developers.google.com/youtube/v3, consultada em
// 12/11/26) com o OAuth do próprio canal do médico.
// - ler comentários: commentThreads.list (allThreadsRelatedToChannelId,
//   order=time, 100 por página) = 1 unidade;
// - responder: comments.insert (snippet.parentId) = 50 unidades, escopo
//   youtube.force-ssl;
// - cota padrão: 10.000 unidades por dia por projeto do Google.
import { admin, Falha, lerSegredo } from "./base.ts";

const API = "https://www.googleapis.com/youtube/v3";
export const ESCOPO_YOUTUBE = "https://www.googleapis.com/auth/youtube.force-ssl";
export const REDIRECT_OAUTH = `${Deno.env.get("SUPABASE_URL")}/functions/v1/youtube-oauth`;

export type ParametrosYoutube = { canal_id?: string; canal_titulo?: string; canal_foto?: string | null; conectado_em?: string };

export async function credenciaisGoogle(clienteId: string): Promise<{ clientId: string; clientSecret: string }> {
  const { data } = await admin.from("integracoes").select("parametros").eq("cliente_id", clienteId).eq("provedor", "google").maybeSingle();
  const clientId = (data?.parametros as { client_id?: string } | undefined)?.client_id;
  const clientSecret = await lerSegredo(clienteId, "google");
  if (!clientId || !clientSecret) {
    throw new Falha("Faltam o Client ID e o Client Secret do Google. Coloque em Configurações → YouTube Seller.", 412);
  }
  return { clientId, clientSecret };
}

export async function canalConectado(clienteId: string): Promise<ParametrosYoutube & { canal_id: string }> {
  const { data } = await admin.from("integracoes").select("parametros").eq("cliente_id", clienteId).eq("provedor", "youtube").maybeSingle();
  const p = (data?.parametros ?? {}) as ParametrosYoutube;
  if (!p.canal_id) throw new Falha("O canal do YouTube não está conectado. Conecte em Configurações → YouTube Seller.", 412);
  return p as ParametrosYoutube & { canal_id: string };
}

async function postToken(corpo: Record<string, string>): Promise<Record<string, string>> {
  let resp: Response;
  try {
    resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(corpo),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new Falha(`O Google não respondeu (${e instanceof Error ? e.message : e}).`, 502);
  }
  const j = await resp.json().catch(() => ({})) as Record<string, string>;
  if (!resp.ok) {
    if (j.error === "invalid_grant") {
      throw new Falha("A autorização do YouTube venceu ou foi revogada. Conecte o canal de novo em Configurações → YouTube Seller.", 412);
    }
    if (j.error === "invalid_client" || j.error === "unauthorized_client") {
      throw new Falha("O Google recusou o Client ID/Client Secret. Confira em Configurações → YouTube Seller.", 412);
    }
    throw new Falha(`O Google recusou o pedido de acesso (${j.error ?? resp.status}${j.error_description ? `: ${j.error_description}` : ""}).`, 502);
  }
  return j;
}

/** Troca o código da volta do OAuth pelos tokens. */
export async function trocarCodigo(clientId: string, clientSecret: string, codigo: string) {
  return await postToken({ client_id: clientId, client_secret: clientSecret, code: codigo, grant_type: "authorization_code", redirect_uri: REDIRECT_OAUTH });
}

/** Token de acesso de 1 hora, renovado pelo refresh token guardado no Vault. */
export async function tokenDeAcesso(clienteId: string): Promise<string> {
  const { clientId, clientSecret } = await credenciaisGoogle(clienteId);
  const refresh = await lerSegredo(clienteId, "youtube");
  if (!refresh) throw new Falha("O canal do YouTube não está conectado. Conecte em Configurações → YouTube Seller.", 412);
  const j = await postToken({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: "refresh_token" });
  if (!j.access_token) throw new Falha("O Google não devolveu o token de acesso ao YouTube.", 502);
  return j.access_token;
}

/** Reserva unidades da cota do dia antes de chamar a API. */
export async function gastarCota(clienteId: string, unidades: number): Promise<void> {
  const { data, error } = await admin.rpc("gastar_cota_youtube", { p_cliente: clienteId, p_unidades: unidades });
  if (error) throw new Falha(`Não consegui conferir a cota do YouTube (${error.message}).`, 500);
  if (!data) {
    throw new Falha("A cota do dia da API do YouTube chegou ao teto (9.000 de 10.000 unidades). Volta depois da meia-noite do horário do Pacífico (5h em Brasília).", 429);
  }
}

const MOTIVOS: Record<string, string> = {
  quotaExceeded: "Acabou a cota do dia da API do YouTube. Volta depois da meia-noite do horário do Pacífico (5h em Brasília).",
  commentsDisabled: "Os comentários deste vídeo estão desativados.",
  parentCommentIsPrivate: "O comentário é privado: a API não deixa responder.",
  commentNotFound: "O comentário não existe mais no YouTube (foi apagado).",
  forbidden: "O YouTube não deixou: a conta conectada não pode responder aqui.",
  insufficientPermissions: "A autorização não inclui responder comentários. Conecte o canal de novo.",
  ineligibleAccount: "A conta conectada não tem canal do YouTube.",
  channelNotFound: "Canal não encontrado no YouTube.",
  processingFailure: "O YouTube falhou ao processar o pedido. Tente de novo.",
};

async function yt<T>(token: string, caminho: string, init: RequestInit = {}): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(API + caminho, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new Falha(`O YouTube não respondeu (${e instanceof Error ? e.message : e}).`, 502);
  }
  const j = await resp.json().catch(() => ({})) as { error?: { message?: string; errors?: { reason?: string }[] } };
  if (!resp.ok) {
    const motivo = j.error?.errors?.[0]?.reason ?? "";
    throw new Falha(MOTIVOS[motivo] ?? `O YouTube respondeu com erro ${resp.status}: ${j.error?.message ?? motivo}`, resp.status === 403 || resp.status === 404 ? 409 : 502);
  }
  return j as T;
}

export async function canalDoToken(token: string): Promise<{ id: string; titulo: string; foto: string | null } | null> {
  const r = await yt<{ items?: { id: string; snippet: { title: string; thumbnails?: { default?: { url: string } } } }[] }>(token, "/channels?part=snippet&mine=true");
  const c = r.items?.[0];
  return c ? { id: c.id, titulo: c.snippet.title, foto: c.snippet.thumbnails?.default?.url ?? null } : null;
}

export type ComentarioLido = {
  thread_id: string;
  comentario_id: string;
  video_id: string;
  autor_nome: string;
  autor_canal_id: string | null;
  autor_foto_url: string | null;
  texto: string;
  publicado_em: string;
  curtidas: number;
  respostas_qtd: number;
  ja_respondido: boolean;
  pode_responder: boolean;
};

type Thread = {
  id: string;
  snippet: {
    videoId?: string;
    canReply?: boolean;
    totalReplyCount?: number;
    topLevelComment: {
      id: string;
      snippet: {
        authorDisplayName?: string;
        authorProfileImageUrl?: string;
        authorChannelId?: { value?: string };
        textOriginal?: string;
        textDisplay?: string;
        likeCount?: number;
        publishedAt: string;
      };
    };
  };
  replies?: { comments?: { snippet: { authorChannelId?: { value?: string } } }[] };
};

/** Uma página (até 100) de conversas do canal, da mais nova para a mais antiga. */
export async function lerPagina(token: string, canalId: string, pagina: string | null): Promise<{ itens: ComentarioLido[]; proxima: string | null }> {
  const q = new URLSearchParams({
    part: "snippet,replies", allThreadsRelatedToChannelId: canalId, maxResults: "100", order: "time", textFormat: "plainText",
  });
  if (pagina) q.set("pageToken", pagina);
  const r = await yt<{ items?: Thread[]; nextPageToken?: string }>(token, `/commentThreads?${q}`);
  const itens = (r.items ?? []).filter((t) => t.snippet?.topLevelComment?.snippet?.publishedAt).map((t) => {
    const s = t.snippet.topLevelComment.snippet;
    const respostas = t.replies?.comments ?? [];
    return {
      thread_id: t.id,
      comentario_id: t.snippet.topLevelComment.id,
      video_id: t.snippet.videoId ?? "",
      autor_nome: (s.authorDisplayName ?? "").replace(/^@/, "").slice(0, 200) || "Sem nome",
      autor_canal_id: s.authorChannelId?.value ?? null,
      autor_foto_url: s.authorProfileImageUrl ?? null,
      texto: (s.textOriginal ?? s.textDisplay ?? "").slice(0, 10_000),
      publicado_em: s.publishedAt,
      curtidas: s.likeCount ?? 0,
      respostas_qtd: t.snippet.totalReplyCount ?? 0,
      ja_respondido: respostas.some((c) => c.snippet.authorChannelId?.value === canalId),
      pode_responder: t.snippet.canReply !== false,
    };
  });
  return { itens, proxima: r.nextPageToken ?? null };
}

/** Títulos dos vídeos (até 50 por chamada, 1 unidade). */
export async function titulosDosVideos(token: string, ids: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    const r = await yt<{ items?: { id: string; snippet: { title: string } }[] }>(token, `/videos?part=snippet&id=${lote.map(encodeURIComponent).join(",")}`);
    for (const v of r.items ?? []) mapa.set(v.id, v.snippet.title);
  }
  return mapa;
}

/** O canal do médico já respondeu este comentário? (confere na hora de publicar) */
export async function canalJaRespondeu(token: string, comentarioId: string, canalId: string): Promise<boolean> {
  const r = await yt<{ items?: { snippet: { authorChannelId?: { value?: string } } }[] }>(
    token, `/comments?part=snippet&maxResults=100&textFormat=plainText&parentId=${encodeURIComponent(comentarioId)}`,
  );
  return (r.items ?? []).some((c) => c.snippet.authorChannelId?.value === canalId);
}

/** Publica a resposta como o canal conectado. */
export async function publicarResposta(token: string, comentarioId: string, texto: string): Promise<string> {
  const r = await yt<{ id: string }>(token, "/comments?part=snippet", {
    method: "POST",
    body: JSON.stringify({ snippet: { parentId: comentarioId, textOriginal: texto } }),
  });
  return r.id;
}

/** Desconectar: revoga no Google (melhor esforço; o que vale é apagar o token). */
export async function revogar(refresh: string): Promise<void> {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(10_000),
    });
  } catch { /* o token sai do cofre de qualquer jeito */ }
}
