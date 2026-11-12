// Base comum das edge functions da DashMed: quem pediu, se pode, resposta com
// motivo claro (regra 2: nunca falha calada) e acesso aos segredos do Vault.
// A chave de serviço só existe aqui dentro (o Supabase põe no ambiente).
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

/** Erro com motivo para quem pediu e o status HTTP certo. */
export class Falha extends Error {
  constructor(mensagem: string, public status = 400) {
    super(mensagem);
  }
}

export function responder(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export type Usuario = {
  id: string;
  nome: string;
  papel: "admin" | "membro";
  plataforma: boolean;
  cliente_id: string | null;
};

/** A chave de serviço chamando a própria função (passo seguinte em segundo
 *  plano). Comparação em tempo constante. */
export function chamadaInterna(req: Request): boolean {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || token.length !== SERVICE_KEY.length) return false;
  let dif = 0;
  for (let i = 0; i < token.length; i++) dif |= token.charCodeAt(i) ^ SERVICE_KEY.charCodeAt(i);
  return dif === 0;
}

/** Confere o token do Authorization e o cadastro ativo em usuarios. */
export async function quemPediu(req: Request): Promise<Usuario> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Falha("Sessão ausente. Entre de novo na DashMed.", 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Falha("Sessão vencida. Entre de novo na DashMed.", 401);
  const { data: u } = await admin.from("usuarios")
    .select("id, nome, papel, plataforma, cliente_id, ativo")
    .eq("id", data.user.id).is("deleted_at", null).maybeSingle();
  if (!u?.ativo) throw new Falha("Esta conta não está ativa na DashMed.", 403);
  return u as Usuario;
}

export function enxerga(u: Usuario, clienteId: string): boolean {
  return u.plataforma || u.cliente_id === clienteId;
}

export function administra(u: Usuario, clienteId: string): boolean {
  return u.plataforma || (u.cliente_id === clienteId && u.papel === "admin");
}

export type Provedor = "anthropic" | "heygen" | "google" | "youtube";

export async function lerSegredo(clienteId: string, provedor: Provedor): Promise<string | null> {
  const { data, error } = await admin.rpc("ler_segredo", { p_cliente: clienteId, p_provedor: provedor });
  if (error) throw new Falha(`Não consegui ler a chave guardada (${error.message}).`, 500);
  return (data as string | null) || null;
}

/** Transforma qualquer erro em resposta com motivo. */
export function respostaDeErro(e: unknown): Response {
  if (e instanceof Falha) return responder({ erro: e.message }, e.status);
  console.error(e);
  const msg = e instanceof Error ? e.message : String(e);
  return responder({ erro: `Erro inesperado: ${msg}` }, 500);
}

/** Lê o corpo JSON, com erro claro se vier quebrado. */
export async function corpoJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Falha("Pedido sem corpo JSON válido.");
  }
}

export function ehUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Código do Postgres para violação de índice único. */
export const VIOLACAO_UNICA = "23505";

// Tarefa em segundo plano depois da resposta (supabase.com/docs/guides/functions/background-tasks).
// Não estende o relógio: no plano Free o limite total é 150 s.
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
export function emSegundoPlano(p: Promise<unknown>): void {
  EdgeRuntime.waitUntil(p);
}

export type Perfil = {
  nome_exibicao: string;
  especialidade: string;
  crm: string;
  rqe: string;
  publico: string;
  tom: string;
  chamada_final: string;
};

export async function carregarPerfil(clienteId: string): Promise<Perfil | null> {
  const { data } = await admin.from("perfis_conteudo")
    .select("nome_exibicao, especialidade, crm, rqe, publico, tom, chamada_final")
    .eq("cliente_id", clienteId).maybeSingle();
  return (data as Perfil | null) ?? null;
}

/** O perfil em texto para a IA; campo vazio fica dito como "não informado". */
export function perfilEmTexto(p: Perfil | null): string {
  const v = (s: string | undefined) => (s && s.trim()) || "não informado";
  return [
    `Nome como aparece no vídeo: ${v(p?.nome_exibicao)}`,
    `Especialidade: ${v(p?.especialidade)}`,
    `CRM: ${v(p?.crm)}`,
    `RQE: ${v(p?.rqe)}`,
    `Público do canal: ${v(p?.publico)}`,
    `Tom de voz: ${v(p?.tom)}`,
    `Chamada final preferida: ${v(p?.chamada_final)}`,
  ].join("\n");
}

/** Dispara a própria função (ou outra) para o passo seguinte, com a chave de
 *  serviço. A função chamada responde 202 na hora e trabalha em segundo plano,
 *  cada passo com o seu relógio. */
export async function chamarFuncaoInterna(nome: string, corpo: unknown): Promise<void> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${nome}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) throw new Falha(`O passo seguinte não começou (${nome} respondeu ${resp.status}).`, 502);
  await resp.body?.cancel();
}
