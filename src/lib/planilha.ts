// Leitura da planilha de indicações para a Agenda (David, 10/11/26: os
// pacientes e as terapias vêm da planilha que ele já usa — exemplo:
// "indicacoes-protese-ah-hidrogel-ago-out-2026.xlsx", com as colunas Mês, Data,
// Horário, Paciente, Tipo atendimento, Procedimento, Trecho evolução).
//
// Só roda no servidor (server actions da Agenda). Nada daqui vai para log:
// é dado de paciente.
import { readSheet } from "read-excel-file/node";

export type LinhaImportacao = {
  linha: number;
  paciente: string;
  chave: string;
  data: string;
  horario: string | null;
  tipo: string | null;
  procedimento: string;
  marca: string | null;
  original: string;
  nota: string | null;
  telefone: string | null;
  vencimento: string | null;
};

export type ErroLinha = { linha: number; motivo: string };

export type Leitura = {
  colunas: { campo: string; titulo: string }[];
  linhas: LinhaImportacao[];
  erros: ErroLinha[];
};

const MAX_LINHAS = 5000;

export function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function tituloNormal(s: string): string {
  return semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Chave do paciente vindo de planilha: o nome sem acento, minúsculo e com espaços únicos. */
export function chaveDoNome(nome: string): string {
  return tituloNormal(nome);
}

// Títulos aceitos para cada campo (sem acento, minúsculos). A primeira coluna
// que bater fica com o campo.
const TITULOS: Record<string, (t: string) => boolean> = {
  paciente: (t) => ["paciente", "nome", "nome do paciente", "nome paciente"].includes(t),
  data: (t) => ["data", "data da consulta", "data consulta", "data do atendimento", "data atendimento", "data da indicacao", "data indicacao"].includes(t),
  procedimento: (t) => ["procedimento", "terapia", "tratamento"].includes(t),
  horario: (t) => ["horario", "hora"].includes(t),
  tipo: (t) => ["tipo atendimento", "tipo de atendimento", "tipo"].includes(t),
  nota: (t) => t.startsWith("trecho") || ["evolucao", "observacao", "observacoes", "nota", "notas"].includes(t),
  telefone: (t) => ["telefone", "celular", "whatsapp", "fone", "telefone celular", "contato"].includes(t),
  vencimento: (t) => ["vencimento", "vence em", "data de vencimento", "data vencimento", "renovar em", "data de renovacao", "data renovacao"].includes(t),
};
const OBRIGATORIOS = ["paciente", "data", "procedimento"] as const;
const NOME_CAMPO: Record<string, string> = {
  paciente: "Paciente", data: "Data", procedimento: "Procedimento", horario: "Horário",
  tipo: "Tipo atendimento", nota: "Trecho evolução", telefone: "Telefone", vencimento: "Vencimento",
};

function iso(a: number, m: number, d: number): string | null {
  if (a < 100) a += 2000;
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (a < 1990 || a > 2100) return null;
  return dt.toISOString().slice(0, 10);
}

/** Data de célula: Date, "dd/mm/aaaa", "aaaa-mm-dd" ou número de série do Excel. */
export function lerData(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === "number") {
    // série do Excel: dias desde 30/12/1899
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

/** Só os dígitos do telefone; vazio vira null. */
export function lerTelefone(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = String(v).replace(/\D/g, "");
  return d.length >= 8 ? d : null;
}

/** "AH (incerto)" → { procedimento: "AH", marca: "incerto" }. */
export function separarProcedimento(texto: string): { procedimento: string; marca: string | null } {
  const t = texto.trim().replace(/\s+/g, " ");
  const m = t.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (m && m[1].trim()) return { procedimento: m[1].trim(), marca: m[2].trim().toLowerCase() || "revisar" };
  return { procedimento: t, marca: null };
}

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return lerData(v);
  const s = String(v).replace(/\s+/g, " ").trim();
  return s || null;
}

// CSV exportado por Excel/Numbers no Brasil costuma vir com ";" e às vezes em
// Windows-1252; aceita os dois.
function lerCsv(bytes: Uint8Array): unknown[][] {
  let conteudo = new TextDecoder("utf-8").decode(bytes);
  if (conteudo.includes("�")) conteudo = new TextDecoder("windows-1252").decode(bytes);
  conteudo = conteudo.replace(/^﻿/, "");
  const primeira = conteudo.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", ",", "\t"].sort((a, b) => primeira.split(b).length - primeira.split(a).length)[0];
  const linhas: string[][] = [];
  let atual: string[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < conteudo.length; i++) {
    const c = conteudo[i];
    if (aspas) {
      if (c === '"' && conteudo[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { atual.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && conteudo[i + 1] === "\n") i++;
      atual.push(campo); campo = "";
      linhas.push(atual); atual = [];
    } else campo += c;
  }
  if (campo || atual.length) { atual.push(campo); linhas.push(atual); }
  return linhas;
}

/** Lê o arquivo (.xlsx ou .csv), acha as colunas pelo título e valida cada linha. */
export async function lerPlanilha(arquivo: File): Promise<Leitura> {
  const nome = arquivo.name.toLowerCase();
  let tabela: unknown[][];
  if (nome.endsWith(".csv")) {
    tabela = lerCsv(new Uint8Array(await arquivo.arrayBuffer()));
  } else if (nome.endsWith(".xlsx")) {
    try {
      tabela = (await readSheet(Buffer.from(await arquivo.arrayBuffer()))) as unknown[][];
    } catch {
      throw new Error("Não consegui abrir a planilha. Confira se é um arquivo .xlsx válido (no Numbers: Arquivo → Exportar para → Excel).");
    }
  } else {
    throw new Error("Envie a planilha em .xlsx ou .csv (no Numbers: Arquivo → Exportar para → Excel).");
  }

  // cabeçalho: a primeira das 5 primeiras linhas que tenha a coluna de paciente
  const iCab = tabela.slice(0, 5).findIndex((l) => l.some((c) => typeof c === "string" && TITULOS.paciente(tituloNormal(c))));
  if (iCab < 0) throw new Error('Não achei a coluna "Paciente" nas primeiras linhas da planilha.');
  const cab = tabela[iCab].map((c) => (c === null || c === undefined ? "" : String(c)));
  const indice: Record<string, number> = {};
  for (const [campo, bate] of Object.entries(TITULOS)) {
    const i = cab.findIndex((t, j) => bate(tituloNormal(t)) && !Object.values(indice).includes(j));
    if (i >= 0) indice[campo] = i;
  }
  const faltam = OBRIGATORIOS.filter((c) => indice[c] === undefined);
  if (faltam.length) {
    throw new Error(`Faltam colunas na planilha: ${faltam.map((c) => NOME_CAMPO[c]).join(", ")}. Achei: ${cab.filter(Boolean).join(", ")}.`);
  }
  const dados = tabela.slice(iCab + 1);
  if (dados.length > MAX_LINHAS) throw new Error(`A planilha tem ${dados.length} linhas; o limite por importação é ${MAX_LINHAS}. Divida o arquivo.`);

  const linhas: LinhaImportacao[] = [];
  const erros: ErroLinha[] = [];
  dados.forEach((l, k) => {
    const linha = iCab + k + 2; // número da linha como aparece no Excel
    const val = (campo: string) => (indice[campo] === undefined ? null : l[indice[campo]]);
    if (l.every((c) => c === null || c === undefined || String(c).trim() === "")) return; // linha vazia
    const paciente = texto(val("paciente"));
    const original = texto(val("procedimento"));
    const data = lerData(val("data"));
    if (!paciente) return void erros.push({ linha, motivo: "sem nome de paciente" });
    if (!original) return void erros.push({ linha, motivo: "sem procedimento" });
    if (!data) return void erros.push({ linha, motivo: "data inválida ou vazia" });
    const venc = val("vencimento");
    const vencimento = venc === null || venc === undefined || String(venc).trim() === "" ? null : lerData(venc);
    if (venc !== null && venc !== undefined && String(venc).trim() !== "" && !vencimento) {
      return void erros.push({ linha, motivo: "vencimento inválido" });
    }
    const { procedimento, marca } = separarProcedimento(original);
    linhas.push({
      linha, paciente, chave: chaveDoNome(paciente), data,
      horario: texto(val("horario")), tipo: texto(val("tipo")),
      procedimento, marca, original, nota: texto(val("nota")),
      telefone: lerTelefone(val("telefone")), vencimento,
    });
  });
  // "AH" e "ah" são o mesmo procedimento: fica a primeira grafia (o prazo é
  // digitado por procedimento e a terapia é única por procedimento sem caixa)
  const grafia = new Map<string, string>();
  for (const x of linhas) {
    const k = x.procedimento.toLowerCase();
    if (!grafia.has(k)) grafia.set(k, x.procedimento);
    x.procedimento = grafia.get(k)!;
  }
  // em ordem de data: a consulta mais nova é a última a passar pela terapia
  linhas.sort((a, b) => a.data.localeCompare(b.data) || a.linha - b.linha);
  const colunas = Object.entries(indice).map(([campo, i]) => ({ campo: NOME_CAMPO[campo], titulo: cab[i] }));
  return { colunas, linhas, erros };
}

/** Resumo para a prévia: por procedimento, quantas linhas e quantas já trazem vencimento. */
export function resumir(l: Leitura) {
  const porProc = new Map<string, { nome: string; linhas: number; semVencimento: number }>();
  for (const x of l.linhas) {
    const k = x.procedimento.toLowerCase();
    const p = porProc.get(k) ?? { nome: x.procedimento, linhas: 0, semVencimento: 0 };
    p.linhas++;
    if (!x.vencimento) p.semVencimento++;
    porProc.set(k, p);
  }
  return {
    colunas: l.colunas,
    validas: l.linhas.length,
    pacientes: new Set(l.linhas.map((x) => x.chave)).size,
    paraRevisar: l.linhas.filter((x) => x.marca).length,
    procedimentos: [...porProc.values()].sort((a, b) => b.linhas - a.linhas),
    erros: l.erros,
  };
}
export type Resumo = ReturnType<typeof resumir>;
