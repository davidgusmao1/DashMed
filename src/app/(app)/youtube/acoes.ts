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

/** Treinamento da IA (David, 12/11/26). Fica gravado até ser desativado; os
 *  ativos entram em toda triagem e resposta nova. A RLS decide quem pode
 *  (admin do cliente ou plataforma: a voz da resposta é a do médico). */
export async function salvarTreino(clienteId: string, texto: string, origem: "texto" | "voz" | "edicao", comentarioId: string | null): Promise<Resultado> {
  const t = texto.trim();
  if (t.length < 3) return { ok: false, msg: "Escreva (ou fale) o que a IA deve aprender." };
  if (t.length > 2000) return { ok: false, msg: "Treinamento longo demais (até 2.000 caracteres). Divida em mais de um." };
  const supabase = await supabaseServidor();
  const { error } = await supabase.from("seller_treinos").insert({ cliente_id: clienteId, texto: t, origem, comentario_id: comentarioId });
  if (error) return { ok: false, msg: /row-level security|permission/i.test(error.message) ? "Só o administrador do cliente ou a equipe da plataforma treina a IA." : error.message };
  revalidatePath("/configuracoes");
  return { ok: true, msg: "Treinamento salvo. Vale para as próximas triagens e respostas." };
}

export async function mudarTreino(id: string, campos: { ativo?: boolean; texto?: string }): Promise<Resultado> {
  const mudanca: { ativo?: boolean; texto?: string } = {};
  if (typeof campos.ativo === "boolean") mudanca.ativo = campos.ativo;
  if (typeof campos.texto === "string") {
    const t = campos.texto.trim();
    if (t.length < 3 || t.length > 2000) return { ok: false, msg: "O treinamento precisa ter entre 3 e 2.000 caracteres." };
    mudanca.texto = t;
  }
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.from("seller_treinos").update(mudanca).eq("id", id).select("id");
  const f = falha(error, data);
  if (f) return f;
  revalidatePath("/configuracoes");
  return { ok: true, msg: mudanca.ativo === false ? "Desativado: a IA deixa de usar." : mudanca.ativo ? "Reativado." : "Salvo." };
}

/** A secretária acha o lead pelo código que a pessoa disse no WhatsApp
 *  ("YT1234", "yt 1234" ou só "1234") ou pelo nome (David, 14/11/26: código YT
 *  na mão da secretária). */
export async function buscarLeads(clienteId: string, termo: string): Promise<{ id: string; nome: string; codigo: string; etapa: string }[]> {
  const t = termo.trim();
  if (t.length < 2) return [];
  const supabase = await supabaseServidor();
  const codigo = t.replace(/\s+/g, "").match(/^(?:yt)?(\d{4})$/i);
  let q = supabase.from("leads").select("id, nome, codigo, etapa").eq("cliente_id", clienteId).is("deleted_at", null);
  q = codigo ? q.eq("codigo", `YT${codigo[1]}`) : q.ilike("nome", `%${t.replace(/[%_\\]/g, "")}%`);
  const { data } = await q.order("atualizado_em", { ascending: false }).limit(8);
  return (data ?? []) as { id: string; nome: string; codigo: string; etapa: string }[];
}

const MARCOS = {
  contato: { etapa: "conversando", avanca: ["novo", "respondido"], tipo: "whatsapp", texto: "Entrou em contato (WhatsApp ou ligação) com o código." },
  consulta: { etapa: "agendado", avanca: ["novo", "respondido", "conversando"], tipo: "consulta", texto: "Consulta agendada." },
  tratamento: { etapa: "tratamento", avanca: ["novo", "respondido", "conversando", "agendado"], tipo: "nota", texto: "Fez o procedimento / iniciou o tratamento." },
  perdido: { etapa: "perdido", avanca: ["novo", "respondido", "conversando", "agendado"], tipo: "nota", texto: "Não vai seguir." },
} as const;
export type Marco = keyof typeof MARCOS;

/** Um clique da equipe: registra o que aconteceu e anda a etapa (só para a
 *  frente: marcar "chamou" num lead já agendado não o faz voltar). */
export async function marcarLead(leadId: string, marco: Marco, obs: string): Promise<Resultado & { etapa?: string }> {
  const m = MARCOS[marco];
  if (!m) return { ok: false, msg: "Marco desconhecido." };
  const supabase = await supabaseServidor();
  const { data: lead } = await supabase.from("leads").select("cliente_id, etapa").eq("id", leadId).maybeSingle();
  if (!lead) return { ok: false, msg: "Lead não encontrado." };
  const texto = obs.trim() ? `${m.texto} ${obs.trim()}` : m.texto;
  const { error: e1 } = await supabase.from("lead_eventos").insert({ cliente_id: lead.cliente_id, lead_id: leadId, tipo: m.tipo, texto: texto.slice(0, 4000) });
  if (e1) return { ok: false, msg: e1.message };
  let etapa: string = lead.etapa;
  if ((m.avanca as readonly string[]).includes(lead.etapa)) {
    const { error: e2 } = await supabase.from("leads").update({ etapa: m.etapa }).eq("id", leadId);
    if (e2) return { ok: false, msg: `Registrado no histórico, mas a etapa não mudou: ${e2.message}` };
    etapa = m.etapa;
  }
  revalidatePath(`/youtube/leads/${leadId}`);
  revalidatePath("/youtube");
  return { ok: true, msg: etapa === lead.etapa ? "Registrado no histórico (a etapa já estava adiante)." : "Registrado e etapa atualizada.", etapa };
}

/** A pauta (perguntas frequentes dos comentários) vira um conteúdo em
 *  Conteúdos; clique duplo devolve o mesmo conteúdo (criar_conteudo_da_pauta, 0015). */
export async function criarConteudoDaPauta(pautaId: string): Promise<Resultado & { conteudoId?: string }> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc("criar_conteudo_da_pauta", { p_pauta: pautaId });
  if (error) return { ok: false, msg: error.message };
  revalidatePath("/youtube");
  revalidatePath("/conteudos");
  return { ok: true, msg: "Conteúdo criado.", conteudoId: data as string };
}

/** Tirar uma pauta da lista (fica arquivada, não é apagada — regra 6). */
export async function descartarPauta(pautaId: string): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { error } = await supabase.rpc("descartar_pauta", { p_pauta: pautaId });
  if (error) return { ok: false, msg: error.message };
  revalidatePath("/youtube");
  return { ok: true, msg: "Pauta descartada." };
}

/** LGPD: a pessoa pediu para apagar os dados. Só o administrador do cliente;
 *  a função faz tudo de uma vez e bloqueia novas leituras (anonimizar_lead, 0018). */
export async function anonimizarLead(leadId: string): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc("anonimizar_lead", { p_lead: leadId });
  if (error) return { ok: false, msg: error.message };
  const r = (data ?? {}) as { ja_estava?: boolean; comentarios?: number; eventos?: number };
  revalidatePath(`/youtube/leads/${leadId}`);
  revalidatePath("/youtube");
  return {
    ok: true,
    msg: r.ja_estava ? "Este lead já estava anonimizado." : `Lead anonimizado: ${r.comentarios ?? 0} comentário(s) e ${r.eventos ?? 0} registro(s) do histórico apagados no DashMed.`,
  };
}
