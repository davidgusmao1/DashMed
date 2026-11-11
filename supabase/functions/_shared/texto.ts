// Regras de texto do módulo Conteúdos, sem rede nem banco, para o teste em
// supabase/tests/conteudos.ts conferir em segundos.

/** Ritmo de fala de vídeo explicativo (o mesmo que usamos para estimar a
 *  duração): 15 minutos ≈ 2.250 palavras. */
export const PALAVRAS_POR_MINUTO = 150;

/** A HeyGen aceita no máximo 5.000 caracteres de roteiro por cena
 *  (developers.heygen.com/docs/usage-limits, consultado em 10/11/26). Ficamos
 *  com folga. */
export const LIMITE_CENA = 4800;

/** A HeyGen aceita no máximo 50 cenas por vídeo. */
export const MAX_CENAS = 50;

export function contarPalavras(texto: string): number {
  const t = texto.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function minutosDeFala(palavras: number): number {
  return Math.round((palavras / PALAVRAS_POR_MINUTO) * 10) / 10;
}

const ENTIDADES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};

/** O resumo da Europe PMC vem com HTML (<h4>Objective</h4>...). */
export function limparResumo(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<\/(h\d|p|div|li)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTIDADES[e.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** O que vai para a voz do avatar: sem marcação, sem colchetes (indicações de
 *  cena ou PMIDs não são falados), parágrafos preservados. */
export function limparParaFala(texto: string): string {
  return texto
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[*_#`>]+/g, " ")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function cortarNoLimite(trecho: string, limite: number): string[] {
  const partes: string[] = [];
  let resto = trecho.trim();
  while (resto.length > limite) {
    let corte = resto.lastIndexOf(" ", limite);
    if (corte < limite / 2) corte = limite;
    partes.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) partes.push(resto);
  return partes;
}

/** Junta pedaços até o limite, sem quebrar o pedaço no meio. */
function juntar(pedacos: string[], limite: number, separador: string): string[] {
  const saida: string[] = [];
  let atual = "";
  for (const p of pedacos) {
    const candidato = atual ? atual + separador + p : p;
    if (candidato.length <= limite) {
      atual = candidato;
    } else {
      if (atual) saida.push(atual);
      atual = p;
    }
  }
  if (atual) saida.push(atual);
  return saida;
}

/** Divide uma fala em cenas de até `limite` caracteres: primeiro por
 *  parágrafo, depois por frase, e só em último caso no espaço. */
export function dividirFala(fala: string, limite = LIMITE_CENA): string[] {
  const texto = fala.trim();
  if (!texto) return [];
  if (texto.length <= limite) return [texto];
  const pedacos: string[] = [];
  for (const paragrafo of texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    if (paragrafo.length <= limite) {
      pedacos.push(paragrafo);
      continue;
    }
    const frases = paragrafo.split(/(?<=[.!?…])\s+/).flatMap((f) => (f.length <= limite ? [f] : cortarNoLimite(f, limite)));
    pedacos.push(...juntar(frases, limite, " "));
  }
  return juntar(pedacos, limite, "\n\n");
}

/** Cada bloco do roteiro vira uma ou mais cenas da HeyGen. */
export function dividirEmCenas(falas: string[], limite = LIMITE_CENA): string[] {
  return falas.flatMap((f) => dividirFala(limparParaFala(f), limite));
}

// ── evidência ──────────────────────────────────────────────────────────
const PESO_TIPO: [RegExp, number][] = [
  [/meta-analysis/i, 5],
  [/systematic review/i, 5],
  [/guideline/i, 5],
  [/randomized controlled trial/i, 4],
  [/clinical trial/i, 3],
  [/^review$/i, 2],
];

/** Peso do tipo de estudo na hierarquia de evidência (5 = mais forte). */
export function pesoEvidencia(tipos: string[]): number {
  let peso = 1;
  for (const t of tipos) for (const [re, p] of PESO_TIPO) if (re.test(t) && p > peso) peso = p;
  return peso;
}

/** Rótulo curto em português para o tipo de estudo mais forte. */
export function rotuloEvidencia(tipos: string[]): string {
  const juntos = tipos.join(" | ");
  if (/meta-analysis/i.test(juntos)) return "Meta-análise";
  if (/systematic review/i.test(juntos)) return "Revisão sistemática";
  if (/guideline/i.test(juntos)) return "Diretriz";
  if (/randomized controlled trial/i.test(juntos)) return "Ensaio randomizado";
  if (/clinical trial/i.test(juntos)) return "Ensaio clínico";
  if (/(^|\| )review( \||$)/i.test(juntos)) return "Revisão";
  return "Estudo";
}

const FILTRO_EVIDENCIA =
  '(PUB_TYPE:"Meta-Analysis" OR PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Randomized Controlled Trial" OR PUB_TYPE:"Practice Guideline" OR PUB_TYPE:"Guideline")';

export type BuscaEuropePmc = { rotulo: string; query: string; pageSize: number; ordem: string | null };

/** Para cada consulta da IA, duas buscas na Europe PMC só em registros do
 *  PubMed (SRC:MED, todos com PMID): a evidência forte dos últimos 10 anos,
 *  pelos mais citados (os estudos de referência do tema), e o que saiu nos
 *  últimos 3 anos, por relevância. */
export function montarBuscas(consulta: string, anoAtual: number): BuscaEuropePmc[] {
  const base = `(${consulta.trim()}) AND SRC:MED AND HAS_ABSTRACT:Y`;
  return [
    { rotulo: "evidência forte, 10 anos", query: `${base} AND ${FILTRO_EVIDENCIA} AND PUB_YEAR:[${anoAtual - 10} TO ${anoAtual}]`, pageSize: 15, ordem: "CITED desc" },
    { rotulo: "recentes, 3 anos", query: `${base} AND PUB_YEAR:[${anoAtual - 3} TO ${anoAtual}]`, pageSize: 8, ordem: null },
  ];
}

/** A IA só pode citar o que veio da busca (regra 3): descarta PMID inventado. */
export function soPmidsConhecidos(pmids: unknown, conhecidos: Set<string>): string[] {
  if (!Array.isArray(pmids)) return [];
  const vistos = new Set<string>();
  for (const p of pmids) {
    const s = String(p).trim();
    if (conhecidos.has(s)) vistos.add(s);
  }
  return [...vistos];
}

/** Uma consulta da IA vai para a Europe PMC: corta o que é grande demais e
 *  os filtros que o código já põe. */
export function consultaSegura(consulta: unknown): string | null {
  if (typeof consulta !== "string") return null;
  const limpa = consulta
    .replace(/\b(SRC|PUB_TYPE|PUB_YEAR|HAS_ABSTRACT):(\[[^\]]*\]|"[^"]*"|[^\s()]+)/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    // o filtro tirado deixa conector solto ("dor AND"), que quebra a busca
    .replace(/^((AND|OR|NOT)\s+)+|(\s+(AND|OR|NOT))+$/g, "")
    .replace(/\(\s*(AND|OR|NOT)\s+/g, "(")
    .replace(/\s+(AND|OR|NOT)\s*\)/g, ")");
  if (limpa.length < 3 || limpa.length > 400) return null;
  // parênteses e aspas desbalanceados quebram a consulta inteira
  const abre = (limpa.match(/\(/g) ?? []).length;
  const fecha = (limpa.match(/\)/g) ?? []).length;
  const aspas = (limpa.match(/"/g) ?? []).length;
  if (abre !== fecha || aspas % 2 !== 0) return null;
  return limpa;
}
