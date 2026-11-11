"use server";

// Ações da Agenda. Toda escrita passa pela sessão de quem está logado, então a
// RLS decide o que cada um pode mudar. Toda recusa volta com motivo para a
// tela (falha silenciosa é bug duplo), inclusive o caso em que a RLS filtrou a
// linha e o update "deu certo" sem mudar nada.
import { revalidatePath } from "next/cache";
import { clientesDe, supabaseServidor, usuarioAtual } from "@/lib/supabase/server";
import { lerData, lerPlanilha, lerTelefone, resumir, type Resumo } from "@/lib/planilha";
import { ehEtapa } from "@/lib/crm";

export type Retorno = { ok: boolean; texto: string } | null;

const SESSAO = { ok: false, texto: "Sua sessão acabou. Entre de novo." } as const;

async function atualizar(tabela: "pacientes" | "terapias", id: string, valores: Record<string, unknown>): Promise<Retorno> {
  if (!(await usuarioAtual())) return SESSAO;
  if (!id) return { ok: false, texto: "Registro não informado." };
  const supabase = await supabaseServidor();
  const { error, count } = await supabase.from(tabela).update(valores, { count: "exact" }).eq("id", id);
  if (error) return { ok: false, texto: `Não salvou: ${error.message}` };
  if (!count) return { ok: false, texto: "Não salvou: o registro não existe mais ou você não tem acesso a ele." };
  revalidatePath("/agenda", "layout");
  return null;
}

export async function salvarTelefone(_: Retorno, fd: FormData): Promise<Retorno> {
  const bruto = String(fd.get("telefone") ?? "").trim();
  const telefone = bruto ? lerTelefone(bruto) : null;
  if (bruto && !telefone) return { ok: false, texto: "Telefone inválido: digite o DDD e o número." };
  return (await atualizar("pacientes", String(fd.get("paciente_id") ?? ""), { telefone }))
    ?? { ok: true, texto: telefone ? "Telefone salvo." : "Telefone apagado." };
}

export async function salvarVencimento(_: Retorno, fd: FormData): Promise<Retorno> {
  const vence = lerData(String(fd.get("vence_em") ?? ""));
  if (!vence) return { ok: false, texto: "Data de vencimento inválida." };
  // digitado por alguém: a importação não recalcula mais por cima
  return (await atualizar("terapias", String(fd.get("terapia_id") ?? ""), { vence_em: vence, vence_em_manual: true }))
    ?? { ok: true, texto: "Vencimento salvo." };
}

export async function mudarSituacao(_: Retorno, fd: FormData): Promise<Retorno> {
  const situacao = String(fd.get("situacao") ?? "");
  if (!ehEtapa(situacao)) return { ok: false, texto: "Situação inválida." };
  return (await atualizar("terapias", String(fd.get("terapia_id") ?? ""), { situacao }))
    ?? { ok: true, texto: "Situação salva." };
}

export async function confirmarIndicacao(_: Retorno, fd: FormData): Promise<Retorno> {
  return (await atualizar("terapias", String(fd.get("terapia_id") ?? ""), { revisar: false, revisar_motivo: null }))
    ?? { ok: true, texto: "Indicação confirmada: a terapia entra na lista de chamada." };
}

// ── importação ──────────────────────────────────────────────────────────

export type Previa = { ok: true; resumo: Resumo } | { ok: false; texto: string };

function arquivoDe(fd: FormData): File | null {
  const f = fd.get("arquivo");
  return f instanceof File && f.size > 0 ? f : null;
}

/** Lê a planilha e devolve o resumo, sem gravar nada. */
export async function previaImportacao(fd: FormData): Promise<Previa> {
  if (!(await usuarioAtual())) return SESSAO;
  const arquivo = arquivoDe(fd);
  if (!arquivo) return { ok: false, texto: "Escolha o arquivo da planilha." };
  try {
    return { ok: true, resumo: resumir(await lerPlanilha(arquivo)) };
  } catch (e) {
    return { ok: false, texto: e instanceof Error ? e.message : "Não consegui ler a planilha." };
  }
}

export type Resultado =
  | { ok: true; pacientes_novos: number; terapias_novas: number; indicacoes_novas: number; ja_existiam: number; para_revisar: number; com_erro: number }
  | { ok: false; texto: string };

/** Grava a planilha no cliente em foco, numa transação só (função importar_planilha). */
export async function importarPlanilha(fd: FormData): Promise<Resultado> {
  const eu = await usuarioAtual();
  if (!eu) return SESSAO;
  const { emFoco } = await clientesDe(eu);
  if (!emFoco) return { ok: false, texto: "Nenhum cliente em foco para receber a importação." };
  const arquivo = arquivoDe(fd);
  if (!arquivo) return { ok: false, texto: "Escolha o arquivo da planilha." };

  let leitura;
  try {
    leitura = await lerPlanilha(arquivo);
  } catch (e) {
    return { ok: false, texto: e instanceof Error ? e.message : "Não consegui ler a planilha." };
  }
  if (!leitura.linhas.length) return { ok: false, texto: "A planilha não tem nenhuma linha válida para importar." };

  // Prazo (em meses) de cada procedimento que tem linha sem vencimento. Em
  // branco = sem vencimento: cirurgia não "vence", o resgate é pelo CRM
  // (David, 11/11/26).
  const prazos: Record<string, number> = {};
  for (const p of resumir(leitura).procedimentos) {
    if (!p.semVencimento) continue;
    const bruto = String(fd.get(`prazo:${p.nome}`) ?? "").trim();
    if (!bruto) continue;
    const meses = Number(bruto);
    if (!Number.isInteger(meses) || meses < 0 || meses > 120) {
      return { ok: false, texto: `O prazo de "${p.nome}" tem de ser um número inteiro de meses, de 0 a 120 (ou em branco).` };
    }
    prazos[p.nome] = meses;
  }

  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc("importar_planilha", {
    p_cliente: emFoco.id,
    p_arquivo: arquivo.name.slice(0, 200),
    p_prazos: prazos,
    p_linhas: leitura.linhas,
    p_erros: leitura.erros,
  });
  if (error) return { ok: false, texto: `A importação não entrou (nada foi gravado): ${error.message}` };
  revalidatePath("/agenda", "layout");
  return { ok: true, ...(data as Omit<Extract<Resultado, { ok: true }>, "ok">) };
}
