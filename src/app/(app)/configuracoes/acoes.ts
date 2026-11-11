"use server";

import { revalidatePath } from "next/cache";
import { clientesDe, supabaseServidor, usuarioAtual } from "@/lib/supabase/server";

export type EstadoForm = { ok: boolean; msg: string } | null;

const CAMPOS = ["nome_exibicao", "especialidade", "crm", "rqe", "publico", "tom", "chamada_final"] as const;

/** Perfil do médico para os roteiros, no cliente em foco. Quem pode mudar, a
 *  RLS decide (admin do cliente ou plataforma). */
export async function salvarPerfil(_: EstadoForm, form: FormData): Promise<EstadoForm> {
  const eu = await usuarioAtual();
  if (!eu) return { ok: false, msg: "Sessão vencida. Entre de novo." };
  const { emFoco } = await clientesDe(eu);
  if (!emFoco) return { ok: false, msg: "Nenhum cliente em foco." };
  const linha: Record<string, string> = { cliente_id: emFoco.id };
  for (const c of CAMPOS) linha[c] = String(form.get(c) ?? "").trim().slice(0, c === "publico" || c === "tom" || c === "chamada_final" ? 400 : 120);
  const supabase = await supabaseServidor();
  const { error } = await supabase.from("perfis_conteudo").upsert(linha, { onConflict: "cliente_id" });
  if (error) {
    return { ok: false, msg: /row-level security|permission/i.test(error.message) ? "Só o administrador do cliente ou a equipe da plataforma muda o perfil." : error.message };
  }
  revalidatePath("/configuracoes");
  return { ok: true, msg: "Perfil salvo." };
}
