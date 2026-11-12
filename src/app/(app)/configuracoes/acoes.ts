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

/** Configuração do YouTube Seller (David, 12/11/26): opções de atendimento que
 *  a resposta oferece, procedimentos que interessam e limites. A RLS decide
 *  quem pode mudar (admin do cliente ou plataforma). */
export async function salvarSeller(_: EstadoForm, form: FormData): Promise<EstadoForm> {
  const eu = await usuarioAtual();
  if (!eu) return { ok: false, msg: "Sessão vencida. Entre de novo." };
  const { emFoco } = await clientesDe(eu);
  if (!emFoco) return { ok: false, msg: "Nenhum cliente em foco." };
  const texto = (n: string, max = 400) => String(form.get(n) ?? "").trim().slice(0, max);
  const procedimentos = texto("procedimentos", 2000).split("\n").map((p) => p.trim()).filter(Boolean).slice(0, 20);
  if (!procedimentos.length) return { ok: false, msg: "Liste pelo menos um procedimento (um por linha)." };
  const prob = Number(form.get("prob_minima"));
  const limite = Number(form.get("limite_diario"));
  if (!Number.isInteger(prob) || prob < 0 || prob > 100) return { ok: false, msg: "Probabilidade mínima entre 0 e 100." };
  if (!Number.isInteger(limite) || limite < 1 || limite > 150) return { ok: false, msg: "Limite diário entre 1 e 150 respostas." };
  const supabase = await supabaseServidor();
  const { error } = await supabase.from("seller_config").upsert({
    cliente_id: emFoco.id,
    automatico: form.get("automatico") === "on",
    procedimentos,
    telemedicina: texto("telemedicina"),
    porto_alegre: texto("porto_alegre"),
    sao_paulo: texto("sao_paulo"),
    telefone_estimativa: texto("telefone_estimativa"),
    instrucoes: texto("instrucoes", 1500),
    prob_minima: prob,
    limite_diario: limite,
  }, { onConflict: "cliente_id" });
  if (error) {
    return { ok: false, msg: /row-level security|permission/i.test(error.message) ? "Só o administrador do cliente ou a equipe da plataforma muda esta configuração." : error.message };
  }
  revalidatePath("/configuracoes");
  revalidatePath("/youtube");
  return { ok: true, msg: "Configuração do YouTube Seller salva." };
}
