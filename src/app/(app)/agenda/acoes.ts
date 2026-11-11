"use server";

// Ações da Agenda. Toda escrita passa pela sessão de quem está logado, então a
// RLS decide o que cada um pode mudar. Toda recusa volta com motivo para a
// tela (falha silenciosa é bug duplo), inclusive o caso em que a RLS filtrou a
// linha e o update "deu certo" sem mudar nada.
import { revalidatePath } from "next/cache";
import { clientesDe, supabaseServidor, usuarioAtual } from "@/lib/supabase/server";
import {
  abrirPlanilha, ehListaDeRealizados, lerData, lerIndicacoes, lerRealizados, lerTelefone, resumir, resumirRealizados,
  type Aba, type Resumo, type ResumoRealizados,
} from "@/lib/planilha";
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
// Dois tipos de lista: INDICAÇÕES (quem teve tratamento indicado) e
// REALIZADOS (quem já fez — David, 11/11/26: "vamos usar essa lista para
// retirar alguns pacientes da lista original"). O tipo sai das colunas: a de
// realizados tem "Data de Realização".

/** Números que a função importar_realizados devolve (na prévia e na gravação). */
export type NumerosRealizados = {
  linhas: number; realizacoes_novas: number; ja_existiam: number; pacientes_encontrados: number;
  sem_paciente: number; homonimos: number; sem_terapia: number; cirurgias_concluidas: number;
  lado_pendente: number; ah_com_data: number; ah_vencidos: number; ah_em_dia: number;
  outras_realizadas: number; etapas_mudadas: number; mexidas_por_pessoa: number;
  outras_terapias_de_operados: number; com_erro: number; erros: { linha: number; motivo: string }[];
};

export type Previa =
  | { ok: true; tipo: "indicacoes"; resumo: Resumo }
  | { ok: true; tipo: "realizados"; resumo: ResumoRealizados; numeros: NumerosRealizados; mesesAh: number }
  | { ok: false; texto: string };

function arquivoDe(fd: FormData): File | null {
  const f = fd.get("arquivo");
  return f instanceof File && f.size > 0 ? f : null;
}

function mesesAhDe(fd: FormData): number | null {
  const bruto = String(fd.get("meses_ah") ?? "").trim();
  if (!bruto) return 6; // David, 11/11/26: "passou de 6 meses, ele é candidato a ser chamado novamente"
  const n = Number(bruto);
  return Number.isInteger(n) && n >= 1 && n <= 60 ? n : null;
}

/** Roda importar_realizados no cliente em foco; com simular, nada fica gravado. */
async function rodarRealizados(arquivo: File, abas: Aba[], mesesAh: number, simular: boolean)
  : Promise<{ ok: true; resumo: ResumoRealizados; numeros: NumerosRealizados } | { ok: false; texto: string }> {
  const eu = await usuarioAtual();
  if (!eu) return SESSAO;
  const { emFoco } = await clientesDe(eu);
  if (!emFoco) return { ok: false, texto: "Nenhum cliente em foco." };
  const leitura = lerRealizados(abas);
  if (!leitura.linhas.length) return { ok: false, texto: "A lista não tem nenhuma linha de procedimento realizado que eu entenda." };
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc("importar_realizados", {
    p_cliente: emFoco.id,
    p_arquivo: arquivo.name.slice(0, 200),
    p_linhas: leitura.linhas,
    p_erros: leitura.erros,
    p_meses_ah: mesesAh,
    p_simular: simular,
  });
  if (error) return { ok: false, texto: `${simular ? "A prévia falhou" : "A importação não entrou (nada foi gravado)"}: ${error.message}` };
  return { ok: true, resumo: resumirRealizados(leitura), numeros: data as NumerosRealizados };
}

/** Lê a planilha e devolve o resumo, sem gravar nada. Na lista de realizados,
 *  a prévia já cruza com o CRM (e desfaz no banco). */
export async function previaImportacao(fd: FormData): Promise<Previa> {
  if (!(await usuarioAtual())) return SESSAO;
  const arquivo = arquivoDe(fd);
  if (!arquivo) return { ok: false, texto: "Escolha o arquivo da planilha." };
  try {
    const abas = await abrirPlanilha(arquivo);
    if (ehListaDeRealizados(abas)) {
      const meses = mesesAhDe(fd);
      if (meses === null) return { ok: false, texto: "O prazo de renovação do AH tem de ser de 1 a 60 meses." };
      const r = await rodarRealizados(arquivo, abas, meses, true);
      return r.ok ? { ok: true, tipo: "realizados", resumo: r.resumo, numeros: r.numeros, mesesAh: meses } : r;
    }
    return { ok: true, tipo: "indicacoes", resumo: resumir(lerIndicacoes(abas)) };
  } catch (e) {
    return { ok: false, texto: e instanceof Error ? e.message : "Não consegui ler a planilha." };
  }
}

export type Resultado =
  | { ok: true; tipo: "indicacoes"; pacientes_novos: number; terapias_novas: number; indicacoes_novas: number; ja_existiam: number; para_revisar: number; com_erro: number }
  | { ok: true; tipo: "realizados"; numeros: NumerosRealizados }
  | { ok: false; texto: string };

/** Grava a planilha no cliente em foco, numa transação só. */
export async function importarPlanilha(fd: FormData): Promise<Resultado> {
  const eu = await usuarioAtual();
  if (!eu) return SESSAO;
  const { emFoco } = await clientesDe(eu);
  if (!emFoco) return { ok: false, texto: "Nenhum cliente em foco para receber a importação." };
  const arquivo = arquivoDe(fd);
  if (!arquivo) return { ok: false, texto: "Escolha o arquivo da planilha." };

  let abas: Aba[];
  try {
    abas = await abrirPlanilha(arquivo);
  } catch (e) {
    return { ok: false, texto: e instanceof Error ? e.message : "Não consegui ler a planilha." };
  }

  if (ehListaDeRealizados(abas)) {
    const meses = mesesAhDe(fd);
    if (meses === null) return { ok: false, texto: "O prazo de renovação do AH tem de ser de 1 a 60 meses." };
    const r = await rodarRealizados(arquivo, abas, meses, false);
    if (!r.ok) return r;
    revalidatePath("/agenda", "layout");
    revalidatePath("/crm");
    return { ok: true, tipo: "realizados", numeros: r.numeros };
  }

  let leitura;
  try {
    leitura = lerIndicacoes(abas);
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
  revalidatePath("/crm");
  return { ok: true, tipo: "indicacoes", ...(data as Omit<Extract<Resultado, { tipo: "indicacoes" }>, "ok" | "tipo">) };
}
