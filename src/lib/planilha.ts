// Leitura das planilhas de indicações para a Agenda e o CRM.
//
// Formatos que o David mandou:
// - 10/11/26, "indicacoes-protese-ah-hidrogel-ago-out-2026.xlsx": uma aba, com
//   Mês, Data, Horário, Paciente, Tipo atendimento, Procedimento, Trecho evolução.
// - 11/11/26, "indicacoes-2025-apolo.xlsx" (extraída do Apolo Ninsaúde): abas
//   Resumo, Indicações e Candidatos, com Data, Hora, Paciente, Idade ("62 anos;
//   DN 05/03/1963"), Telefones ("cel: 11 98765-4321; res: ..."), E-mail,
//   Terapia (texto livre), Categoria ("ATQ/MAKO, AH"), Trecho do prontuário,
//   Impressos, "Orientações AH impressa (provável aplicação no dia)" e
//   Observação. Endereço e Cidade/UF não são lidos (não servem para ligar).
//
// Cada linha vira uma linha de importação POR PROCEDIMENTO (a categoria
// "ATQ/MAKO, AH" vira duas). Só roda no servidor; nada daqui vai para log: é
// dado de paciente.
import readXlsxFile from "read-excel-file/node";

export type LinhaImportacao = {
  linha: number;
  paciente: string;
  chave: string;
  chave_nome: string;
  data: string;
  horario: string | null;
  tipo: string | null;
  procedimento: string;
  marca: string | null;
  original: string;
  nota: string | null;
  telefone: string | null;
  telefones: string | null;
  email: string | null;
  nascimento: string | null;
  impressos: string | null;
  observacao: string | null;
  realizado: boolean;
  vencimento: string | null;
};

export type ErroLinha = { linha: number; motivo: string };

export type Leitura = {
  colunas: { campo: string; titulo: string }[];
  abas: string[];
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

/** Nome sem acento, minúsculo e com espaços únicos. */
export function chaveDoNome(nome: string): string {
  return tituloNormal(nome);
}

/** Chave do paciente vindo de planilha: o nome e, se houver, a data de
 *  nascimento — separa homônimos. */
export function chaveDoPaciente(nome: string, nascimento: string | null): string {
  return nascimento ? `${chaveDoNome(nome)}|${nascimento}` : chaveDoNome(nome);
}

// Títulos aceitos para cada campo (sem acento, minúsculos). Na ordem desta
// lista, cada campo fica com a primeira coluna livre que bater.
const TITULOS: [string, (t: string) => boolean][] = [
  ["paciente", (t) => ["paciente", "nome", "nome do paciente", "nome paciente"].includes(t)],
  ["data", (t) => ["data", "data da consulta", "data consulta", "data do atendimento", "data atendimento", "data da indicacao", "data indicacao"].includes(t)],
  ["categoria", (t) => ["categoria", "categorias"].includes(t)],
  ["procedimento", (t) => ["procedimento", "terapia", "tratamento"].includes(t)],
  ["horario", (t) => ["horario", "hora"].includes(t)],
  ["tipo", (t) => ["tipo atendimento", "tipo de atendimento", "tipo"].includes(t)],
  ["nota", (t) => t.startsWith("trecho") || ["evolucao", "nota", "notas"].includes(t)],
  ["observacao", (t) => ["observacao", "observacoes", "obs"].includes(t)],
  ["telefone", (t) => ["telefone", "telefones", "celular", "whatsapp", "fone", "telefone celular", "contato"].includes(t)],
  ["email", (t) => ["e mail", "email"].includes(t)],
  ["nascimento", (t) => ["idade", "nascimento", "data de nascimento", "data nascimento", "dn"].includes(t)],
  ["impressos", (t) => ["impressos"].includes(t)],
  ["aplicado", (t) => t.includes("aplicacao no dia") || t.includes("aplicado no dia")],
  ["vencimento", (t) => ["vencimento", "vence em", "data de vencimento", "data vencimento", "renovar em", "data de renovacao", "data renovacao"].includes(t)],
];
const NOME_CAMPO: Record<string, string> = {
  paciente: "Paciente", data: "Data", categoria: "Categoria", procedimento: "Procedimento", horario: "Horário",
  tipo: "Tipo atendimento", nota: "Trecho do prontuário", observacao: "Observação", telefone: "Telefone",
  email: "E-mail", nascimento: "Nascimento", impressos: "Impressos", aplicado: "Aplicado no dia", vencimento: "Vencimento",
};

function iso(a: number, m: number, d: number, anoMin = 1990): string | null {
  if (a < 100) a += 2000;
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (a < anoMin || a > 2100) return null;
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

/** Data de nascimento dentro de um texto ("62 anos; DN 05/03/1963"). */
export function lerNascimento(v: unknown): string | null {
  if (v instanceof Date) return iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate(), 1900);
  const m = String(v ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? iso(Number(m[3]), Number(m[2]), Number(m[1]), 1900) : null;
}

/** Só os dígitos do telefone; vazio vira null. */
export function lerTelefone(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = String(v).replace(/\D/g, "");
  return d.length >= 8 ? d : null;
}

/** "cel: 11 98765-4321; res: 11 3333-4444" → principal (primeiro celular) e todos. */
export function lerTelefones(v: unknown): { telefone: string | null; telefones: string | null } {
  const partes = String(v ?? "").split(/[;\n]|\s\/\s/).map((p) => p.trim()).filter(Boolean);
  const achados: { rotulo: string; numero: string }[] = [];
  for (const p of partes) {
    const m = p.match(/^([A-Za-zÀ-ÿ.]+)\s*:\s*(.*)$/);
    const numero = lerTelefone(m ? m[2] : p);
    if (numero && !achados.some((a) => a.numero === numero)) achados.push({ rotulo: m ? m[1].toLowerCase() : "", numero });
  }
  if (!achados.length) return { telefone: null, telefones: null };
  const principal = achados.find((a) => a.rotulo.startsWith("cel")) ?? achados[0];
  return {
    telefone: principal.numero,
    telefones: achados.map((a) => (a.rotulo ? `${a.rotulo} ${a.numero}` : a.numero)).join(" · "),
  };
}

/** "AH (incerto)" → { procedimento: "AH", marca: "incerto" }. */
export function separarProcedimento(texto: string): { procedimento: string; marca: string | null } {
  const t = texto.trim().replace(/\s+/g, " ");
  const m = t.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (m && m[1].trim()) return { procedimento: m[1].trim(), marca: m[2].trim().toLowerCase() || "revisar" };
  return { procedimento: t, marca: null };
}

// "vazio" é como a extração do prontuário marca campo sem conteúdo
function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return lerData(v);
  const s = String(v).replace(/\s+/g, " ").trim();
  return s && s.toLowerCase() !== "vazio" ? s : null;
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

export type Aba = { nome: string; tabela: unknown[][] };

function acharCabecalho(tabela: unknown[][]): number {
  return tabela.slice(0, 5).findIndex((l) => l.some((c) => typeof c === "string" && TITULOS[0][1](tituloNormal(c))));
}

function lerAba(aba: Aba, linhas: LinhaImportacao[], erros: ErroLinha[], colunas: Map<string, string>) {
  const { nome: nomeAba, tabela } = aba;
  const iCab = acharCabecalho(tabela);
  const cab = tabela[iCab].map((c) => (c === null || c === undefined ? "" : String(c)));
  const indice: Record<string, number> = {};
  const usadas = new Set<number>();
  for (const [campo, bate] of TITULOS) {
    const i = cab.findIndex((t, j) => !usadas.has(j) && bate(tituloNormal(t)));
    if (i >= 0) { indice[campo] = i; usadas.add(i); }
  }
  const faltam = ["paciente", "data"].filter((c) => indice[c] === undefined);
  if (indice.procedimento === undefined && indice.categoria === undefined) faltam.push("procedimento");
  if (faltam.length) {
    throw new Error(`Faltam colunas na aba "${nomeAba}": ${faltam.map((c) => NOME_CAMPO[c]).join(", ")}. Achei: ${cab.filter(Boolean).join(", ")}.`);
  }
  for (const [campo, i] of Object.entries(indice)) if (!colunas.has(campo)) colunas.set(campo, cab[i]);
  // o título da coluna "aplicado no dia" diz de que procedimento é (ex.: "AH")
  const palavrasAplicado = indice.aplicado === undefined ? [] : tituloNormal(cab[indice.aplicado]).split(" ");
  const ehCandidatos = /candidat/i.test(nomeAba);
  const sufixo = nomeAba ? ` (aba ${nomeAba})` : "";

  tabela.slice(iCab + 1).forEach((l, k) => {
    const linha = iCab + k + 2; // número da linha como aparece no Excel
    const val = (campo: string) => (indice[campo] === undefined ? null : l[indice[campo]]);
    if (l.every((c) => c === null || c === undefined || String(c).trim() === "")) return; // linha vazia
    const paciente = texto(val("paciente"));
    const data = lerData(val("data"));
    const descricao = texto(val("procedimento"));
    const categoria = texto(val("categoria"));
    if (!paciente) return void erros.push({ linha, motivo: `sem nome de paciente${sufixo}` });
    if (!data) return void erros.push({ linha, motivo: `data inválida ou vazia${sufixo}` });
    if (!descricao && !categoria) return void erros.push({ linha, motivo: `sem procedimento${sufixo}` });
    const venc = val("vencimento");
    const vencimento = texto(venc) ? lerData(venc) : null;
    if (texto(venc) && !vencimento) return void erros.push({ linha, motivo: `vencimento inválido${sufixo}` });

    const observacao = texto(val("observacao"));
    const candidato = ehCandidatos || /^candidato\b/i.test(observacao ?? "");
    const nascimento = lerNascimento(val("nascimento"));
    const { telefone, telefones } = lerTelefones(val("telefone"));
    const emailBruto = texto(val("email"));
    const aplicado = /^(sim|s|x|true|1)$/i.test(String(val("aplicado") ?? "").trim());
    const procedimentos = categoria
      ? categoria.split(",").map((c) => c.trim()).filter(Boolean).map((c) => ({ procedimento: c, marca: null as string | null }))
      : [separarProcedimento(descricao!)];
    for (const p of procedimentos) {
      linhas.push({
        linha, paciente, data,
        chave: chaveDoPaciente(paciente, nascimento), chave_nome: chaveDoNome(paciente),
        horario: texto(val("horario")), tipo: texto(val("tipo")),
        procedimento: p.procedimento,
        marca: candidato ? "candidato" : p.marca,
        original: descricao ?? categoria ?? p.procedimento,
        nota: texto(val("nota")), observacao, impressos: texto(val("impressos")),
        telefone, telefones, email: emailBruto && emailBruto.includes("@") ? emailBruto.toLowerCase() : null,
        nascimento,
        realizado: aplicado && palavrasAplicado.includes(tituloNormal(p.procedimento)),
        vencimento,
      });
    }
  });
}

/** Abre o arquivo (.xlsx ou .csv) e devolve as abas que têm a coluna "Paciente". */
export async function abrirPlanilha(arquivo: File): Promise<Aba[]> {
  const nome = arquivo.name.toLowerCase();
  let abas: Aba[];
  if (nome.endsWith(".csv")) {
    abas = [{ nome: "", tabela: lerCsv(new Uint8Array(await arquivo.arrayBuffer())) }];
  } else if (nome.endsWith(".xlsx")) {
    try {
      const todas = await readXlsxFile(Buffer.from(await arquivo.arrayBuffer()));
      abas = todas.map((a) => ({ nome: a.sheet, tabela: a.data as unknown[][] }));
    } catch {
      throw new Error("Não consegui abrir a planilha. Confira se é um arquivo .xlsx válido (no Numbers: Arquivo → Exportar para → Excel).");
    }
  } else {
    throw new Error("Envie a planilha em .xlsx ou .csv (no Numbers: Arquivo → Exportar para → Excel).");
  }
  // só as abas de pacientes (a aba "Resumo", de contagens, fica de fora)
  abas = abas.filter((a) => acharCabecalho(a.tabela) >= 0);
  if (!abas.length) throw new Error('Não achei a coluna "Paciente" nas primeiras linhas de nenhuma aba.');
  const total = abas.reduce((n, a) => n + a.tabela.length, 0);
  if (total > MAX_LINHAS) throw new Error(`A planilha tem ${total} linhas; o limite por importação é ${MAX_LINHAS}. Divida o arquivo.`);
  return abas;
}

/** Lê o arquivo de indicações: acha as colunas pelo título em cada aba e valida cada linha. */
export async function lerPlanilha(arquivo: File): Promise<Leitura> {
  return lerIndicacoes(await abrirPlanilha(arquivo));
}

export function lerIndicacoes(abas: Aba[]): Leitura {
  const linhas: LinhaImportacao[] = [];
  const erros: ErroLinha[] = [];
  const colunas = new Map<string, string>();
  for (const aba of abas) lerAba(aba, linhas, erros, colunas);

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
  return {
    colunas: [...colunas].map(([campo, titulo]) => ({ campo: NOME_CAMPO[campo], titulo })),
    abas: abas.map((a) => a.nome),
    linhas,
    erros,
  };
}

/** Resumo para a prévia: por procedimento, quantas linhas e quantas já trazem vencimento. */
export function resumir(l: Leitura) {
  const porProc = new Map<string, { nome: string; linhas: number; semVencimento: number; realizados: number }>();
  for (const x of l.linhas) {
    const k = x.procedimento.toLowerCase();
    const p = porProc.get(k) ?? { nome: x.procedimento, linhas: 0, semVencimento: 0, realizados: 0 };
    p.linhas++;
    if (!x.vencimento) p.semVencimento++;
    if (x.realizado) p.realizados++;
    porProc.set(k, p);
  }
  const pacientes = new Set(l.linhas.map((x) => x.chave));
  return {
    colunas: l.colunas,
    abas: l.abas,
    validas: l.linhas.length,
    pacientes: pacientes.size,
    comTelefone: new Set(l.linhas.filter((x) => x.telefone).map((x) => x.chave)).size,
    paraRevisar: l.linhas.filter((x) => x.marca).length,
    candidatos: l.linhas.filter((x) => x.marca === "candidato").length,
    procedimentos: [...porProc.values()].sort((a, b) => b.linhas - a.linhas),
    erros: l.erros,
  };
}
export type Resumo = ReturnType<typeof resumir>;

// ── lista de procedimentos JÁ REALIZADOS ────────────────────────────────
// David, 11/11/26 ("2025_2026 - ATQ, ATJ, AH, VISCO, PRP e Hidrogel.xlsx"): Ano,
// Data de Realização, Paciente, Procedimento em texto livre ("AH quadril
// bilateral", "ATQ Unimed", "Visco BMAC", "Hidrogel Primeira"…) e, numa coluna
// sem título, uma lista à parte de BMAC no formato "nome – dd/mm/aaaa – BMAC".
// Não tem nascimento nem telefone: o casamento com o CRM é pelo nome.

export type Realizado = {
  linha: number;
  paciente: string;
  chave_nome: string;
  data: string;
  /** família: AH, Hidrogel, PRP, BMAC, ATQ, ATJ, VAQ (bate com o check de realizacoes) */
  procedimento: string;
  descricao: string;
  lado: "unilateral" | "bilateral" | null;
  articulacao: string | null;
};

export type LeituraRealizados = {
  colunas: { campo: string; titulo: string }[];
  abas: string[];
  linhas: Realizado[];
  erros: ErroLinha[];
  daColunaExtra: number;
};

const TITULO_REALIZACAO = (t: string) =>
  ["data de realizacao", "data da realizacao", "data realizacao", "realizado em", "realizada em",
    "data do procedimento", "data da cirurgia", "data da aplicacao"].includes(t);

/** A lista tem coluna de data de realização? Então é de realizados, não de indicações. */
export function ehListaDeRealizados(abas: Aba[]): boolean {
  return abas.some((a) => {
    const i = acharCabecalho(a.tabela);
    return i >= 0 && a.tabela[i].some((c) => typeof c === "string" && TITULO_REALIZACAO(tituloNormal(c)));
  });
}

/** Famílias de um procedimento em texto livre. "Visco" (viscossuplementação) é
 *  ácido hialurônico; "Visco BMAC" = AH + BMAC; "AH e Hidrogel" = os dois. */
export function familiasDe(texto: string): string[] {
  const t = tituloNormal(texto);
  const f = new Set<string>();
  if (/\b(atq|mako)\b|protese de quadril|artroplastia (total )?de quadril/.test(t)) f.add("ATQ");
  if (/\batj\b|protese de joelho|artroplastia (total )?de joelho/.test(t)) f.add("ATJ");
  if (/\bvaq\b|artroscop|video/.test(t)) f.add("VAQ");
  if (/hidrogel|hymovis/.test(t)) f.add("Hidrogel");
  if (/bmac|bamc|\bviscob\b/.test(t)) f.add("BMAC");
  if (/\bprp\b/.test(t)) f.add("PRP");
  if (/\bah\b|hialuron|visco/.test(t)) f.add("AH");
  return [...f];
}

export function ladoDe(texto: string): "unilateral" | "bilateral" | null {
  const t = tituloNormal(texto);
  if (/bilateral|\bjoelhos\b|\bquadris\b|\bambos\b|\bambas\b/.test(t)) return "bilateral";
  if (/unilateral/.test(t)) return "unilateral";
  return null;
}

export function articulacaoDe(texto: string): string | null {
  const t = tituloNormal(texto);
  const q = /quadri/.test(t), j = /joelh/.test(t);
  return q && j ? "quadril e joelho" : q ? "quadril" : j ? "joelho" : null;
}

// "Maria da Silva – 06/01/2025 – Visco BMAC"
const ENTRADA_EXTRA = /^(.+?)\s+[–—-]\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:[–—-]\s*(.+))?$/;

export function lerRealizados(abas: Aba[]): LeituraRealizados {
  const linhas: Realizado[] = [];
  const erros: ErroLinha[] = [];
  const colunas = new Map<string, string>();
  let daColunaExtra = 0;
  const empurrar = (linha: number, paciente: string, data: string, descricao: string) => {
    for (const f of familiasDe(descricao)) {
      linhas.push({
        linha, paciente, chave_nome: chaveDoNome(paciente), data, procedimento: f, descricao,
        lado: ladoDe(descricao), articulacao: articulacaoDe(descricao),
      });
    }
  };
  for (const aba of abas) {
    const iCab = acharCabecalho(aba.tabela);
    if (iCab < 0) continue;
    const cab = aba.tabela[iCab].map((c) => (c === null || c === undefined ? "" : String(c)));
    const achar = (bate: (t: string) => boolean) => cab.findIndex((t) => bate(tituloNormal(t)));
    const iPac = achar(TITULOS[0][1]);
    let iData = achar(TITULO_REALIZACAO);
    if (iData < 0) iData = achar((t) => t === "data");
    const iProc = achar((t) => ["procedimento", "terapia", "tratamento", "cirurgia"].includes(t));
    if (iPac < 0 || iData < 0 || iProc < 0) {
      throw new Error(`Na aba "${aba.nome}" faltam colunas: ${[iPac < 0 && "Paciente", iData < 0 && "Data de Realização", iProc < 0 && "Procedimento"].filter(Boolean).join(", ")}.`);
    }
    colunas.set("Paciente", cab[iPac]); colunas.set("Data", cab[iData]); colunas.set("Procedimento", cab[iProc]);
    const sufixo = aba.nome ? ` (aba ${aba.nome})` : "";
    aba.tabela.slice(iCab + 1).forEach((l, k) => {
      const linha = iCab + k + 2;
      if (l.every((c) => c === null || c === undefined || String(c).trim() === "")) return;
      // lista à parte em outra coluna (ex.: BMAC): vale por si, mesmo se a linha principal estiver vazia
      l.forEach((c, j) => {
        if (j === iPac || j === iData || j === iProc || typeof c !== "string") return;
        const m = c.trim().match(ENTRADA_EXTRA);
        if (!m) return;
        const data = lerData(m[2]);
        const desc = (m[3] ?? "").trim();
        if (!data || !desc || !familiasDe(desc).length) return void erros.push({ linha, motivo: `anotação ao lado não entendida${sufixo}` });
        daColunaExtra++;
        empurrar(linha, m[1].replace(/\s+/g, " ").trim(), data, desc);
      });
      const paciente = texto(l[iPac]);
      const data = lerData(l[iData]);
      const descricao = texto(l[iProc]);
      if (!paciente && !descricao) return;
      if (!paciente) return void erros.push({ linha, motivo: `sem nome de paciente${sufixo}` });
      if (!data) return void erros.push({ linha, motivo: `data de realização inválida ou vazia${sufixo}` });
      if (!descricao) return void erros.push({ linha, motivo: `sem procedimento${sufixo}` });
      if (!familiasDe(descricao).length) return void erros.push({ linha, motivo: `procedimento não reconhecido: "${descricao.slice(0, 60)}"` });
      empurrar(linha, paciente, data, descricao);
    });
  }
  linhas.sort((a, b) => a.data.localeCompare(b.data) || a.linha - b.linha);
  return {
    colunas: [...colunas].map(([campo, titulo]) => ({ campo, titulo })),
    abas: abas.map((a) => a.nome),
    linhas, erros, daColunaExtra,
  };
}

export function resumirRealizados(l: LeituraRealizados) {
  const porFamilia = new Map<string, number>();
  for (const x of l.linhas) porFamilia.set(x.procedimento, (porFamilia.get(x.procedimento) ?? 0) + 1);
  return {
    colunas: l.colunas,
    abas: l.abas,
    linhas: l.linhas.length,
    pacientes: new Set(l.linhas.map((x) => x.chave_nome)).size,
    porFamilia: [...porFamilia].sort((a, b) => b[1] - a[1]).map(([nome, n]) => ({ nome, n })),
    bilaterais: l.linhas.filter((x) => x.lado === "bilateral").length,
    unilaterais: l.linhas.filter((x) => x.lado === "unilateral").length,
    daColunaExtra: l.daColunaExtra,
    erros: l.erros,
  };
}
export type ResumoRealizados = ReturnType<typeof resumirRealizados>;
