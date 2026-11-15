// Busca de comentários do YouTube Seller por frase (David, 15/11/26: "um
// campo de busca com uma lupinha ... posso usar tempo, posso usar vários
// critérios. Mas tudo digitando ali").
//
// A IA traduz a frase em critérios (edge youtube-responder, ação "buscar");
// os critérios vão na URL (b=...) e o banco aplica (buscar_comentarios, 0020).
// Cada critério aparece numa etiqueta que o médico pode tirar: o que a tela
// mostra é o que o banco usou (regra 3), e quem manda é ele (regra 4).
// Sem imports: os testes rodam este arquivo direto no Deno.

export type GrupoBusca = { termos: string[]; procedimentos: string[] };
export type FiltroBusca = {
  de?: string | null;
  ate?: string | null;
  grupos?: GrupoBusca[];
  todos?: boolean;
  sem?: string[];
  categorias?: string[];
  videos?: string[];
  video_titulo?: string | null;
  autor?: string | null;
  urgente?: boolean | null;
  lead?: boolean | null;
  conversa?: boolean | null;
  situacao?: string[];
  probabilidade_min?: number;
  consulta_min?: number;
  consulta_max?: number;
  cirurgia_min?: number;
  cirurgia_max?: number;
  socio_min?: number;
  socio_max?: number;
  ordem?: string;
};

export const POR_PAGINA = 50;
const SITUACOES: Record<string, string> = { fila: "na fila de revisão", respondido: "respondidos", sem_resposta: "sem resposta", ignorado: "ignorados" };
const ORDENS: Record<string, string> = {
  antigos: "mais antigos primeiro", probabilidade: "maior chance de virar paciente primeiro", consulta: "maior chance de consulta primeiro",
  cirurgia: "maior chance de cirurgia primeiro", socio: "maior socioeconômica primeiro", curtidas: "mais curtidos primeiro",
};
const LIMITES = ["probabilidade_min", "consulta_min", "consulta_max", "cirurgia_min", "cirurgia_max", "socio_min", "socio_max"] as const;

const lista = (v: unknown, max = 30) => (Array.isArray(v) ? v : []).map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, max);
const dataValida = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const triplo = (v: unknown) => (v === true ? true : v === false ? false : null);
const textoCurto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);

/** O que veio da URL (pode ter sido mexido à mão) → critérios conhecidos. Sem
 *  critério nenhum devolve null. O banco confere tudo de novo. */
export function normalizarFiltro(bruto: unknown): FiltroBusca | null {
  if (!bruto || typeof bruto !== "object") return null;
  const r = bruto as Record<string, unknown>;
  let de = dataValida(r.de);
  let ate = dataValida(r.ate);
  if (de && ate && de > ate) [de, ate] = [ate, de];
  const f: FiltroBusca = {};
  if (de) f.de = de;
  if (ate) f.ate = ate;
  const grupos = (Array.isArray(r.grupos) ? r.grupos : []).slice(0, 6).map((g) => ({
    termos: lista((g as Record<string, unknown>)?.termos).map((t) => t.slice(0, 40)),
    procedimentos: lista((g as Record<string, unknown>)?.procedimentos, 20),
  })).filter((g) => g.termos.length || g.procedimentos.length);
  if (grupos.length) f.grupos = grupos;
  if (grupos.length > 1 && r.todos === true) f.todos = true;
  for (const k of ["sem", "categorias", "videos", "situacao"] as const) {
    const v = lista(r[k]).map((t) => t.slice(0, 40));
    if (v.length) f[k] = v;
  }
  for (const k of ["video_titulo", "autor"] as const) {
    const v = textoCurto(r[k]);
    if (v) f[k] = v;
  }
  for (const k of ["urgente", "lead", "conversa"] as const) {
    const v = triplo(r[k]);
    if (v !== null) f[k] = v;
  }
  for (const k of LIMITES) {
    const n = Math.round(Number(r[k]));
    if (r[k] !== null && r[k] !== undefined && r[k] !== "" && Number.isFinite(n) && n >= 0 && n <= 100) f[k] = n;
  }
  if (typeof r.ordem === "string" && r.ordem in ORDENS) f.ordem = r.ordem;
  const temCriterio = Object.keys(f).some((k) => k !== "ordem" && k !== "todos");
  return temCriterio || f.ordem ? f : null;
}

export function lerFiltroDaUrl(b: string | undefined): FiltroBusca | null {
  if (!b) return null;
  try {
    return normalizarFiltro(JSON.parse(b));
  } catch {
    return null;
  }
}

export function hrefBusca(p: { q?: string | null; filtro: FiltroBusca | null; obs?: string | null; pagina?: number }): string {
  const u = new URLSearchParams({ aba: "busca" });
  if (p.q) u.set("q", p.q);
  if (p.filtro) u.set("b", JSON.stringify(p.filtro));
  if (p.obs) u.set("o", p.obs);
  if (p.pagina && p.pagina > 1) u.set("p", String(p.pagina));
  return `/youtube?${u.toString()}`;
}

/** Usa alguma das três porcentagens da 0019 (comentário ainda sem elas fica de fora). */
export function usaPorcentagens(f: FiltroBusca): boolean {
  return ["consulta_min", "consulta_max", "cirurgia_min", "cirurgia_max", "socio_min", "socio_max"].some((k) => f[k as keyof FiltroBusca] !== undefined);
}

// ── etiquetas ───────────────────────────────────────────────────────────
export type Etiqueta = { chave: string; texto: string };

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
function dataBr(iso: string, comDia = false): string {
  const [a, m, d] = iso.split("-");
  const dia = comDia ? ` (${DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()]})` : "";
  return `${d}/${m}/${a}${dia}`;
}
function faixa(nome: string, min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) return `${nome} de ${min}% a ${max}%`;
  return min !== undefined ? `${nome} ${min}% ou mais` : `${nome} até ${max}%`;
}
function resumirTermos(g: GrupoBusca): string {
  const partes = [...g.termos.slice(0, 6)];
  if (g.termos.length > 6) partes.push(`+${g.termos.length - 6}`);
  const procs = g.procedimentos.length ? ` (ou marcado como ${g.procedimentos.join(", ")})` : "";
  return `${partes.join(" / ") || "—"}${procs}`;
}

export function etiquetasDoFiltro(f: FiltroBusca, rotulos: { videos: Record<string, string>; categorias: Record<string, string> }): Etiqueta[] {
  const e: Etiqueta[] = [];
  if (f.de || f.ate) {
    e.push({
      chave: "data",
      texto: f.de && f.ate ? (f.de === f.ate ? `Comentados em ${dataBr(f.de, true)}` : `Comentados de ${dataBr(f.de)} a ${dataBr(f.ate)}`)
        : f.de ? `Comentados desde ${dataBr(f.de)}` : `Comentados até ${dataBr(f.ate!)}`,
    });
  }
  (f.grupos ?? []).forEach((g, i) => {
    const prefixo = i === 0 ? "Fala de" : f.todos ? "E também de" : "Ou de";
    e.push({ chave: `grupo:${i}`, texto: `${prefixo}: ${resumirTermos(g)}` });
  });
  if (f.sem?.length) e.push({ chave: "sem", texto: `Sem: ${f.sem.slice(0, 6).join(" / ")}${f.sem.length > 6 ? ` +${f.sem.length - 6}` : ""}` });
  if (f.categorias?.length) e.push({ chave: "categorias", texto: `Tipo: ${f.categorias.map((c) => rotulos.categorias[c] ?? c).join(", ")}` });
  if (f.videos?.length || f.video_titulo) {
    const nomes = (f.videos ?? []).map((v) => `“${rotulos.videos[v] ?? v}”`);
    if (f.video_titulo) nomes.push(`título com “${f.video_titulo}”`);
    e.push({ chave: "video", texto: `Vídeo: ${nomes.join(" ou ")}` });
  }
  if (f.autor) e.push({ chave: "autor", texto: `Quem comentou: ${f.autor}` });
  if (f.urgente !== undefined && f.urgente !== null) e.push({ chave: "urgente", texto: f.urgente ? "Só urgentes" : "Sem os urgentes" });
  if (f.lead !== undefined && f.lead !== null) e.push({ chave: "lead", texto: f.lead ? "Só quem virou lead" : "Quem não virou lead" });
  if (f.conversa !== undefined && f.conversa !== null) e.push({ chave: "conversa", texto: f.conversa ? "Só continuação de conversa" : "Sem continuação de conversa" });
  if (f.situacao?.length) e.push({ chave: "situacao", texto: `Resposta: ${f.situacao.map((s) => SITUACOES[s] ?? s).join(" ou ")}` });
  if (f.probabilidade_min !== undefined) e.push({ chave: "probabilidade", texto: `Chance de virar paciente ${f.probabilidade_min}% ou mais` });
  if (f.consulta_min !== undefined || f.consulta_max !== undefined) e.push({ chave: "consulta", texto: faixa("Consulta", f.consulta_min, f.consulta_max) });
  if (f.cirurgia_min !== undefined || f.cirurgia_max !== undefined) e.push({ chave: "cirurgia", texto: faixa("Cirurgia", f.cirurgia_min, f.cirurgia_max) });
  if (f.socio_min !== undefined || f.socio_max !== undefined) e.push({ chave: "socio", texto: faixa("Socioeconômica", f.socio_min, f.socio_max) });
  if (f.ordem && f.ordem !== "recentes") e.push({ chave: "ordem", texto: `Ordem: ${ORDENS[f.ordem] ?? f.ordem}` });
  return e;
}

/** O filtro sem o critério daquela etiqueta (o médico tirou). */
export function semCriterio(f: FiltroBusca, chave: string): FiltroBusca | null {
  const n: FiltroBusca = { ...f };
  const tirar: Record<string, (keyof FiltroBusca)[]> = {
    data: ["de", "ate"], sem: ["sem"], categorias: ["categorias"], video: ["videos", "video_titulo"], autor: ["autor"],
    urgente: ["urgente"], lead: ["lead"], conversa: ["conversa"], situacao: ["situacao"], probabilidade: ["probabilidade_min"],
    consulta: ["consulta_min", "consulta_max"], cirurgia: ["cirurgia_min", "cirurgia_max"], socio: ["socio_min", "socio_max"], ordem: ["ordem"],
  };
  if (chave.startsWith("grupo:")) {
    const i = Number(chave.slice(6));
    n.grupos = (f.grupos ?? []).filter((_, j) => j !== i);
    if (!n.grupos.length) delete n.grupos;
    if ((n.grupos?.length ?? 0) < 2) delete n.todos;
  } else {
    for (const k of tirar[chave] ?? []) delete n[k];
  }
  return normalizarFiltro(n);
}

// ── realce das palavras achadas ─────────────────────────────────────────
const ACENTOS: Record<string, string> = { a: "[aáàâãä]", e: "[eéèêë]", i: "[iíìîï]", o: "[oóòôõö]", u: "[uúùûü]", c: "[cç]", n: "[nñ]" };
const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** A mesma regra do banco (padrao_busca): palavra inteira, sem ligar para
 *  acento; "infiltr*" pega as terminações. Devolve null sem termos. */
export function regexDeRealce(f: FiltroBusca | null): RegExp | null {
  const partes: string[] = [];
  for (const g of f?.grupos ?? []) {
    for (const bruto of g.termos) {
      const prefixo = bruto.trim().endsWith("*");
      const t = semAcento(bruto).replace(/[^a-z0-9]+/g, " ").trim();
      if (t.length < 2) continue;
      const corpo = [...t].map((ch) => (ch === " " ? "\\s+" : ACENTOS[ch] ?? ch)).join("");
      partes.push(`(?<![\\p{L}\\p{N}])${corpo}${prefixo ? "[\\p{L}\\p{N}]*" : "(?![\\p{L}\\p{N}])"}`);
    }
  }
  if (!partes.length) return null;
  // o mais longo primeiro: "dor no quadril" ganha de "dor"
  partes.sort((a, b) => b.length - a.length);
  return new RegExp(partes.join("|"), "giu");
}

export function pedacosRealcados(texto: string, rx: RegExp | null): { t: string; marca: boolean }[] {
  if (!rx) return [{ t: texto, marca: false }];
  const out: { t: string; marca: boolean }[] = [];
  let ultimo = 0;
  for (const m of texto.matchAll(new RegExp(rx.source, rx.flags))) {
    if (!m[0]) continue;
    const i = m.index ?? 0;
    if (i > ultimo) out.push({ t: texto.slice(ultimo, i), marca: false });
    out.push({ t: m[0], marca: true });
    ultimo = i + m[0].length;
  }
  if (ultimo < texto.length) out.push({ t: texto.slice(ultimo), marca: false });
  return out;
}

/** Sem a IA (chave faltando, IA fora): busca pelas palavras da frase, todas no comentário. */
export function filtroSoPalavras(frase: string): FiltroBusca | null {
  const PARADAS = new Set(["que", "com", "sem", "dos", "das", "para", "por", "uma", "um", "sobre", "comentario", "comentarios", "buscar", "busca", "quem", "falou", "fala", "falam", "pedido", "pedindo", "contenha", "contem", "tenha"]);
  const palavras = [...new Set(semAcento(frase).replace(/[^a-z0-9]+/g, " ").split(" ").filter((p) => p.length >= 3 && !PARADAS.has(p)))].slice(0, 6);
  return normalizarFiltro({ grupos: palavras.map((p) => ({ termos: [p], procedimentos: [] })), todos: true });
}
