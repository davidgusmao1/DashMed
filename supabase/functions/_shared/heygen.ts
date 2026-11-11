// API da HeyGen (v3, developers.heygen.com, consultada em 10/11/26): o avatar
// digital do próprio médico fala o roteiro. Autenticação pelo cabeçalho
// x-api-key; vídeo assíncrono (POST /v3/videos e depois GET /v3/videos/{id}).
import { Falha } from "./base.ts";

const BASE = "https://api.heygen.com";

async function heygen<T>(chave: string, caminho: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(BASE + caminho, {
      ...init,
      headers: { "x-api-key": chave, "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
    });
  } catch (e) {
    throw new Falha(`A HeyGen não respondeu (${e instanceof Error ? e.message : e}).`, 502);
  }
  const texto = await resp.text();
  let corpo: Record<string, unknown> = {};
  try {
    corpo = texto ? JSON.parse(texto) : {};
  } catch { /* corpo não-JSON: fica o status */ }
  if (!resp.ok) {
    const err = corpo.error as { message?: string; code?: string } | string | undefined;
    const motivo = typeof err === "string" ? err : err?.message ?? (corpo.message as string | undefined) ?? texto.slice(0, 200);
    if (resp.status === 401) throw new Falha("A HeyGen recusou a chave de API (401). Confira a chave em Configurações.", 412);
    if (resp.status === 429) throw new Falha("A HeyGen limitou os pedidos agora (429). Espere um pouco e tente de novo.", 429);
    throw new Falha(`A HeyGen respondeu com erro ${resp.status}: ${motivo}`, 502);
  }
  return corpo as T;
}

/** As respostas da v3 vêm como {data: ...}. */
async function dados<T>(chave: string, caminho: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const corpo = await heygen<{ data?: T }>(chave, caminho, init);
  if (corpo.data === undefined) throw new Falha("A HeyGen respondeu num formato inesperado (sem \"data\").", 502);
  return corpo.data;
}

type Pagina<T> = { data?: T[]; has_more?: boolean; next_token?: string | null };

export type UsuarioHeygen = {
  billing_type?: string;
  wallet?: { currency?: string; remaining_balance?: number | null };
  subscription?: { plan?: string; credits?: { premium_credits?: { remaining?: number }; add_on_credits?: { remaining?: number } } };
  usage_based?: { remaining_credits?: number | null };
};

export async function usuarioHeygen(chave: string): Promise<UsuarioHeygen> {
  return await dados<UsuarioHeygen>(chave, "/v3/users/me");
}

/** Saldo em texto curto, do jeito que a HeyGen cobra esta conta. */
export function saldoEmTexto(u: UsuarioHeygen): string {
  if (u.wallet && u.wallet.remaining_balance != null) {
    const v = u.wallet.remaining_balance;
    return u.wallet.currency === "usd" ? `saldo da carteira de API: US$ ${v.toFixed(2)}` : `saldo da carteira: ${v} créditos`;
  }
  if (u.subscription?.credits) {
    const c = u.subscription.credits;
    const total = (c.premium_credits?.remaining ?? 0) + (c.add_on_credits?.remaining ?? 0);
    return `plano ${u.subscription.plan ?? "?"}, ${total} créditos restantes`;
  }
  if (u.usage_based?.remaining_credits != null) return `${u.usage_based.remaining_credits} créditos restantes`;
  return "saldo não informado pela HeyGen";
}

export type LookHeygen = {
  id: string;
  name: string;
  avatar_type: "studio_avatar" | "digital_twin" | "photo_avatar";
  preview_image_url?: string | null;
  default_voice_id?: string | null;
  supported_api_engines?: string[];
  status?: string | null;
};

/** Os avatares PRÓPRIOS da conta (gêmeo digital e foto), já prontos. */
export async function listarLooksProprios(chave: string): Promise<LookHeygen[]> {
  const todos: LookHeygen[] = [];
  let token: string | null = null;
  for (let pagina = 0; pagina < 5; pagina++) {
    const q = new URLSearchParams({ ownership: "private", limit: "50" });
    if (token) q.set("token", token);
    const r = await heygen<Pagina<LookHeygen>>(chave, `/v3/avatars/looks?${q}`);
    todos.push(...(r.data ?? []));
    if (!r.has_more || !r.next_token) break;
    token = r.next_token;
  }
  return todos;
}

export type VozHeygen = { voice_id: string; name: string; language?: string | null; mode?: string; status?: string };

/** As vozes próprias (clonadas) da conta. */
export async function listarVozesProprias(chave: string): Promise<VozHeygen[]> {
  const r = await heygen<Pagina<VozHeygen>>(chave, "/v3/models/audio/voices?type=private&limit=100");
  return r.data ?? [];
}

/** Vozes públicas em português, para quem ainda não clonou a própria. */
export async function listarVozesPortugues(chave: string): Promise<VozHeygen[]> {
  const r = await heygen<Pagina<VozHeygen>>(chave, "/v3/models/audio/voices?type=public&language=pt&limit=50");
  return r.data ?? [];
}

export type PedidoVideo = {
  titulo: string;
  avatarId: string;
  vozId: string;
  motor: string | null;
  formato: "16:9" | "9:16";
  cenas: string[];
  retornoUrl: string;
  retornoId: string;
  idempotencia: string;
};

/** Vídeo "studio": uma cena de avatar por trecho do roteiro (até 5.000
 *  caracteres cada, até 50 cenas). Legenda SRT sempre vem à parte. */
export async function criarVideo(chave: string, p: PedidoVideo): Promise<{ video_id: string; status: string }> {
  const corpo = {
    type: "studio",
    title: p.titulo.slice(0, 200),
    aspect_ratio: p.formato,
    resolution: "1080p",
    caption: { file_format: "srt" },
    callback_url: p.retornoUrl,
    callback_id: p.retornoId,
    scenes: p.cenas.map((script) => ({
      type: "avatar_video",
      input: {
        type: "avatar",
        avatar_id: p.avatarId,
        script,
        voice_id: p.vozId,
        ...(p.motor ? { engine: { type: p.motor } } : {}),
      },
    })),
  };
  return await dados<{ video_id: string; status: string }>(chave, "/v3/videos", {
    method: "POST",
    body: JSON.stringify(corpo),
    // a mesma chave em até 24 h devolve a resposta original: reenvio não paga duas vezes
    headers: { "Idempotency-Key": p.idempotencia },
    timeoutMs: 30_000,
  });
}

export type VideoHeygen = {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  video_url?: string | null;
  captioned_video_url?: string | null;
  subtitle_url?: string | null;
  thumbnail_url?: string | null;
  duration?: number | null;
  failure_code?: string | null;
  failure_message?: string | null;
  video_page_url?: string | null;
};

export async function consultarVideo(chave: string, videoId: string): Promise<VideoHeygen> {
  return await dados<VideoHeygen>(chave, `/v3/videos/${encodeURIComponent(videoId)}`);
}
