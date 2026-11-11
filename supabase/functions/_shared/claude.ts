// Chamada à IA (Claude, da Anthropic) com a chave do próprio cliente, guardada
// no Vault. Resposta sempre em JSON validado por esquema (structured outputs),
// e recusa ou corte viram erro com motivo (regra 2).
import Anthropic from "npm:@anthropic-ai/sdk@1.6.0";
import { Falha, lerSegredo } from "./base.ts";

export const MODELO = "claude-opus-5-5";

export async function claudeDoCliente(clienteId: string, timeoutMs: number): Promise<Anthropic> {
  const chave = await lerSegredo(clienteId, "anthropic");
  if (!chave) throw new Falha("Falta a chave da Anthropic (Claude). Coloque em Configurações → Chaves de API.", 412);
  // sem nova tentativa automática: o tempo da edge function é curto (150 s no
  // plano Free) e preferimos mostrar o erro a estourar o relógio calados
  return new Anthropic({ apiKey: chave, timeout: timeoutMs, maxRetries: 0 });
}

type Esforco = "low" | "medium" | "high";

export async function pedirJson<T>(claude: Anthropic, p: {
  sistema: string;
  pedido: string;
  esquema: Record<string, unknown>;
  esforco: Esforco;
  maxTokens?: number;
  /** tempo máximo desta chamada (o relógio da edge function é curto) */
  timeoutMs?: number;
}): Promise<T> {
  let resp;
  try {
    resp = await claude.beta.messages.create({
      model: MODELO,
      max_tokens: p.maxTokens ?? 16000,
      // se o filtro de segurança recusar por engano (tema médico pode cair
      // nisso), a própria API refaz o pedido no modelo reserva recomendado
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: p.esforco, format: { type: "json_schema", schema: p.esquema } },
      system: p.sistema,
      messages: [{ role: "user", content: p.pedido }],
    }, p.timeoutMs ? { timeout: p.timeoutMs } : undefined);
  } catch (e) {
    throw traduzirErro(e);
  }
  if (resp.stop_reason === "refusal") {
    throw new Falha("A IA recusou este pedido. Reformule o assunto ou as orientações e tente de novo.", 422);
  }
  if (resp.stop_reason === "max_tokens") {
    throw new Falha("A resposta da IA passou do tamanho máximo e veio cortada. Tente de novo.", 502);
  }
  const texto = resp.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new Falha("A IA devolveu uma resposta fora do formato esperado. Tente de novo.", 502);
  }
}

function traduzirErro(e: unknown): Falha {
  if (e instanceof Anthropic.AuthenticationError) {
    return new Falha("A Anthropic recusou a chave de API (401). Confira a chave em Configurações.", 412);
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return new Falha("A chave da Anthropic não tem permissão para este modelo (403). Confira o workspace da chave.", 412);
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new Falha("A Anthropic limitou os pedidos desta chave agora (429). Espere um minuto e tente de novo.", 429);
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return new Falha("A IA demorou demais para responder e o pedido foi interrompido. Tente de novo.", 504);
  }
  if (e instanceof Anthropic.APIError) {
    const saldo = /credit balance/i.test(e.message) ? " Parece faltar crédito na conta da Anthropic." : "";
    return new Falha(`A Anthropic respondeu com erro ${e.status ?? ""}.${saldo} ${e.message}`.trim(), 502);
  }
  return new Falha(`Falha ao falar com a IA: ${e instanceof Error ? e.message : String(e)}`, 502);
}

/** Teste barato da chave: consulta o modelo, sem gastar tokens. */
export async function testarChaveAnthropic(chave: string): Promise<string> {
  const claude = new Anthropic({ apiKey: chave, timeout: 15_000, maxRetries: 0 });
  try {
    const m = await claude.models.retrieve(MODELO);
    return `Chave válida. Modelo ${m.display_name ?? MODELO} disponível.`;
  } catch (e) {
    throw traduzirErro(e);
  }
}
