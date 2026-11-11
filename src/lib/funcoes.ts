import { supabase } from "@/lib/supabase/client";

export type Resposta<T> = { ok: true; dados: T } | { ok: false; erro: string };

/** Chama uma edge function com a sessão de quem está logado. Quando a função
 *  recusa, devolve o motivo que ela deu ({erro: "..."}), nunca um erro mudo. */
export async function chamarFuncao<T = { mensagem?: string }>(nome: string, corpo: Record<string, unknown>): Promise<Resposta<T>> {
  const { data, error } = await supabase.functions.invoke(nome, { body: corpo });
  if (!error) return { ok: true, dados: data as T };
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) {
    try {
      const j = await ctx.json();
      if (j && typeof j.erro === "string") return { ok: false, erro: j.erro };
    } catch {
      /* sem corpo JSON: fica a mensagem genérica */
    }
  }
  return { ok: false, erro: error.message || "Não consegui falar com o servidor. Tente de novo." };
}
