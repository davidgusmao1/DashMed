"use server";

// Escritas do médico no módulo Conteúdos, pela sessão dele (a RLS confere o
// cliente). O que é trabalho da IA ou da HeyGen vai pelas edge functions.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clientesDe, supabaseServidor, usuarioAtual } from "@/lib/supabase/server";

export type EstadoForm = { ok: boolean; msg: string } | null;

export async function criarConteudo(_: EstadoForm, form: FormData): Promise<EstadoForm> {
  const eu = await usuarioAtual();
  if (!eu) return { ok: false, msg: "Sessão vencida. Entre de novo." };
  const { emFoco } = await clientesDe(eu);
  if (!emFoco) return { ok: false, msg: "Nenhum cliente em foco." };
  const assunto = String(form.get("assunto") ?? "").trim();
  const orientacoes = String(form.get("orientacoes") ?? "").trim();
  if (assunto.length < 3) return { ok: false, msg: "Escreva o assunto (pelo menos 3 letras)." };
  if (assunto.length > 300) return { ok: false, msg: "Assunto longo demais (até 300 caracteres). Detalhes vão nas orientações." };
  if (orientacoes.length > 2000) return { ok: false, msg: "Orientações longas demais (até 2.000 caracteres)." };
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.from("conteudos").insert({ cliente_id: emFoco.id, assunto, orientacoes }).select("id").single();
  if (error) return { ok: false, msg: `Não consegui criar o conteúdo: ${error.message}` };
  redirect(`/conteudos/${data.id}`);
}

export async function arquivarConteudo(id: string): Promise<EstadoForm> {
  const supabase = await supabaseServidor();
  const { error } = await supabase.rpc("arquivar_conteudo", { p_id: id });
  if (error) return { ok: false, msg: error.message };
  revalidatePath("/conteudos");
  redirect("/conteudos");
}

export async function salvarOrientacoes(id: string, assunto: string, orientacoes: string): Promise<EstadoForm> {
  if (assunto.trim().length < 3 || assunto.length > 300) return { ok: false, msg: "Assunto entre 3 e 300 caracteres." };
  if (orientacoes.length > 2000) return { ok: false, msg: "Orientações até 2.000 caracteres." };
  const supabase = await supabaseServidor();
  const { error } = await supabase.from("conteudos").update({ assunto: assunto.trim(), orientacoes: orientacoes.trim() }).eq("id", id);
  if (error) return { ok: false, msg: error.message };
  revalidatePath(`/conteudos/${id}`);
  return { ok: true, msg: "Salvo." };
}

/** O médico escolhe as referências (regra 4: a IA só sugere). */
export async function marcarReferencia(id: string, selecionada: boolean): Promise<EstadoForm> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.from("referencias").update({ selecionada }).eq("id", id).select("id");
  if (error) return { ok: false, msg: error.message };
  if (!data?.length) return { ok: false, msg: "Referência não encontrada." };
  return { ok: true, msg: "" };
}

/** Texto do bloco editado pelo médico: daqui para frente a IA não troca sem
 *  ele confirmar. */
export async function salvarBloco(id: string, titulo: string, fala: string, naTela: string): Promise<EstadoForm> {
  if (!fala.trim()) return { ok: false, msg: "A fala do bloco não pode ficar vazia." };
  if (fala.length > 12000) return { ok: false, msg: "Bloco longo demais (até 12.000 caracteres)." };
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.from("roteiro_blocos")
    .update({ titulo: titulo.trim().slice(0, 120) || "Bloco", fala: fala.trim(), na_tela: naTela.trim(), editado: true })
    .eq("id", id).select("id");
  if (error) return { ok: false, msg: error.message };
  if (!data?.length) return { ok: false, msg: "Bloco não encontrado." };
  return { ok: true, msg: "Bloco salvo." };
}
