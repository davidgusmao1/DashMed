// Tipos e contas do módulo Conteúdos usados pelas telas. As mesmas regras de
// texto do servidor estão em supabase/functions/_shared/texto.ts.

export const PALAVRAS_POR_MINUTO = 150;

export type Conteudo = {
  id: string;
  cliente_id: string;
  assunto: string;
  orientacoes: string;
  pesquisa_estado: "nao_iniciada" | "buscando" | "pronta" | "erro";
  pesquisa_msg: string | null;
  pesquisa_iniciada_em: string | null;
  pesquisa_terminada_em: string | null;
  consultas: { descricao: string; consulta: string; encontrados: number }[];
  sintese: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type Referencia = {
  id: string;
  pmid: string;
  doi: string | null;
  pmcid: string | null;
  titulo: string;
  autores: string;
  revista: string;
  ano: number | null;
  tipos: string[];
  citacoes: number;
  acesso_aberto: boolean;
  resumo: string;
  relevancia: number | null;
  nota: string | null;
  sugerida: boolean;
  selecionada: boolean;
};

export type BlocoPlano = { ordem: number; titulo: string; objetivo: string; minutos: number; pontos: string[]; pmids: string[] };

export type Roteiro = {
  id: string;
  versao: number;
  estado: "estrutura" | "escrevendo" | "pronto" | "erro";
  msg: string | null;
  titulo: string | null;
  estrutura: { resumo: string; blocos: BlocoPlano[] } | null;
  pmids: string[];
  criado_em: string;
  atualizado_em: string;
};

export type Bloco = {
  id: string;
  roteiro_id: string;
  ordem: number;
  titulo: string;
  fala: string;
  na_tela: string;
  editado: boolean;
  atualizado_em: string;
};

export type Video = {
  id: string;
  roteiro_id: string;
  estado: "enviando" | "processando" | "pronto" | "falhou";
  msg: string | null;
  formato: "16:9" | "9:16";
  motor: string | null;
  avatar_nome: string | null;
  voz_nome: string | null;
  minutos_estimados: number | null;
  duracao_seg: number | null;
  criado_em: string;
  atualizado_em: string;
};

export type Integracao = {
  provedor: "anthropic" | "heygen";
  final: string;
  parametros: { avatar_id?: string; avatar_nome?: string; avatar_tipo?: string; voz_id?: string; voz_nome?: string; motor?: string | null };
  teste_ok: boolean | null;
  teste_msg: string | null;
  testada_em: string | null;
  atualizado_em: string;
};

export type Perfil = {
  nome_exibicao: string;
  especialidade: string;
  crm: string;
  rqe: string;
  publico: string;
  tom: string;
  chamada_final: string;
};

export function contarPalavras(texto: string): number {
  const t = texto.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function minutosDe(palavras: number): number {
  return palavras / PALAVRAS_POR_MINUTO;
}

/** 7,5 → "7:30" */
export function relogio(minutos: number): string {
  const total = Math.round(minutos * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const FUSO = "America/Sao_Paulo";
export function dataHora(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** Há quanto tempo, em minutos inteiros. */
export function minutosDesde(iso: string | null, agora = Date.now()): number {
  return iso ? Math.floor((agora - new Date(iso).getTime()) / 60_000) : 0;
}

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

/** Preço de API da HeyGen por minuto de vídeo com avatar próprio, em US$
 *  (tabela pública consultada em 10/11/26; a HeyGen pode mudar — o valor
 *  certo está na conta). null = sem preço publicado. */
export const PRECO_MINUTO_HEYGEN: Record<string, number | null> = {
  avatar_iv: 4.83,
  avatar_iii: 0.6,
  avatar_v: null,
};

export const NOME_MOTOR: Record<string, string> = {
  avatar_iv: "Avatar IV (mais realista)",
  avatar_iii: "Avatar III (mais barato)",
  avatar_v: "Avatar V",
};

export function linkPubmed(pmid: string): string {
  return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
}

/** Referência no formato curto para a descrição do vídeo. */
export function citacao(r: Pick<Referencia, "autores" | "titulo" | "revista" | "ano" | "pmid" | "doi">): string {
  const autores = r.autores.split(",").map((a) => a.trim()).filter(Boolean);
  const quem = autores.length > 3 ? `${autores.slice(0, 3).join(", ")} et al.` : autores.join(", ");
  return `${quem ? quem + ". " : ""}${r.titulo} ${r.revista}${r.ano ? `, ${r.ano}` : ""}. ${r.doi ? `doi:${r.doi}` : linkPubmed(r.pmid)}`;
}
