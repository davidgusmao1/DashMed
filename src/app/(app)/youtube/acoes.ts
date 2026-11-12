"use server";

// Escritas da equipe no YouTube Seller, pela sessão (a RLS confere o
// cliente). Publicar no YouTube e pedir resposta à IA vão pela edge function.
import { revalidatePath } from "next/cache";
import { supabaseServidor } from "@/lib/supabase/server";
import { ETAPAS, LOCAIS } from "@/lib/youtube";

export type Resultado = { ok: boolean; msg: string };

function falha(error: { message: string } | null, linhas: unknown[] | null): Resultado | null {
  if (error) return { ok: false, msg: /row-level security|permission/i.test(error.message) ? "Sem permissão para isto." : error.message };
  if (!linhas?.length) return { ok: false, msg: "Não encontrado (ou mudou de estado)." };
  return null;
}

/** O médico não quer responder este comentário (pode voltar atrás). */
export async function ignorarResposta(id: string): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.from("yt_comentarios").update({ resposta: "ignorada" })
    .eq("id", id).in("resposta", ["rascunho", "falhou"]).select("id");
  const f = falha(error, data);
  if (f) return f;
  revalidatePath("/youtube");
  return { ok: true, msg: "Ignorado." };
}

export async function voltarParaFila(id: string): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.from("yt_comentarios").update({ resposta: "rascunho" })
    .eq("id", id).eq("resposta", "ignorada").not("rascunho", "is", null).select("id");
  const f = falha(error, data);
  if (f) return f;
  revalidatePath("/youtube");
  return { ok: true, msg: "Voltou para a fila." };
}

/** Texto editado pelo médico: a IA não troca sem ele confirmar (regra 4). */
export async function salvarRascunho(id: string, texto: string): Promise<Resultado> {
  const t = texto.trim();
  if (t.length < 2) return { ok: false, msg: "A resposta está vazia." };
  if (t.length > 2000) return { ok: false, msg: "Resposta longa demais (até 2.000 caracteres)." };
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.from("yt_comentarios").update({ rascunho: t, rascunho_editado: true, resposta: "rascunho" })
    .eq("id", id).in("resposta", ["rascunho", "falhou"]).select("id");
  const f = falha(error, data);
  if (f) return f;
  return { ok: true, msg: "Rascunho salvo." };
}

export async function moverLead(id: string, etapa: string): Promise<Resultado> {
  if (!ETAPAS.some((e) => e.id === etapa)) return { ok: false, msg: "Etapa desconhecida." };
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.from("leads").update({ etapa }).eq("id", id).select("id");
  const f = falha(error, data);
  if (f) return f;
  revalidatePath("/youtube");
  revalidatePath(`/youtube/leads/${id}`);
  return { ok: true, msg: "Etapa atualizada." };
}

export async function salvarLead(id: string, campos: {
  telefone: string; local_interesse: string; proximo_passo_em: string; responsavel_id: string; paciente_id: string; notas: string;
}): Promise<Resultado> {
  if (campos.local_interesse && !LOCAIS.some((l) => l.id === campos.local_interesse)) return { ok: false, msg: "Local desconhecido." };
  if (campos.proximo_passo_em && !/^\d{4}-\d{2}-\d{2}$/.test(campos.proximo_passo_em)) return { ok: false, msg: "Data inválida." };
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.from("leads").update({
    telefone: campos.telefone.trim().slice(0, 40) || null,
    local_interesse: campos.local_interesse || null,
    proximo_passo_em: campos.proximo_passo_em || null,
    responsavel_id: campos.responsavel_id || null,
    paciente_id: campos.paciente_id || null,
    notas: campos.notas.trim().slice(0, 4000),
  }).eq("id", id).select("id");
  const f = falha(error, data);
  if (f) return f;
  revalidatePath(`/youtube/leads/${id}`);
  return { ok: true, msg: "Lead salvo." };
}

/** Contato feito pela equipe (WhatsApp, ligação, consulta) ou anotação. É
 *  histórico: não se edita nem se apaga. */
export async function registrarEvento(leadId: string, tipo: string, texto: string): Promise<Resultado> {
  if (!["nota", "whatsapp", "ligacao", "consulta"].includes(tipo)) return { ok: false, msg: "Tipo desconhecido." };
  const t = texto.trim();
  if (!t) return { ok: false, msg: "Escreva o que aconteceu." };
  const supabase = await supabaseServidor();
  const { data: lead } = await supabase.from("leads").select("cliente_id").eq("id", leadId).maybeSingle();
  if (!lead) return { ok: false, msg: "Lead não encontrado." };
  const { error } = await supabase.from("lead_eventos").insert({ cliente_id: lead.cliente_id, lead_id: leadId, tipo, texto: t.slice(0, 4000) });
  if (error) return { ok: false, msg: error.message };
  revalidatePath(`/youtube/leads/${leadId}`);
  return { ok: true, msg: "Registrado." };
}

/** Para ligar o lead ao cadastro de paciente (Agenda/CRM) quando ele vira paciente. */
export async function buscarPacientes(clienteId: string, termo: string): Promise<{ id: string; nome: string }[]> {
  const t = termo.trim();
  if (t.length < 2) return [];
  const supabase = await supabaseServidor();
  const { data } = await supabase.from("pacientes").select("id, nome").eq("cliente_id", clienteId).is("deleted_at", null)
    .ilike("nome", `%${t.replace(/[%_\\]/g, "")}%`).order("nome").limit(10);
  return (data ?? []) as { id: string; nome: string }[];
}
