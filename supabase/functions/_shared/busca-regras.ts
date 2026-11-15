// Regras puras da busca de comentários (15/11/26): o calendário que a IA usa
// e a limpeza do que ela devolve. Sem banco, para testar em segundos
// (supabase/tests/youtube.ts).
export const FUSO = "America/Sao_Paulo";
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const DIA_MS = 86_400_000;

export const SITUACOES = ["fila", "respondido", "sem_resposta", "ignorado"] as const;
export const ORDENS = ["recentes", "antigos", "probabilidade", "consulta", "cirurgia", "socio", "curtidas"] as const;
export const LIMITES = ["probabilidade_min", "consulta_min", "consulta_max", "cirurgia_min", "cirurgia_max", "socio_min", "socio_max"] as const;

export type FiltroBusca = {
  de: string | null;
  ate: string | null;
  grupos: { termos: string[]; procedimentos: string[] }[];
  todos: boolean;
  sem: string[];
  categorias: string[];
  videos: string[];
  video_titulo: string | null;
  autor: string | null;
  urgente: boolean | null;
  lead: boolean | null;
  conversa: boolean | null;
  situacao: string[];
  ordem: string;
} & Partial<Record<(typeof LIMITES)[number], number>>;

/** Data de hoje em Brasília (meia-noite UTC daquele dia, só para contar dias). */
function hojeEmBrasilia(agora: Date): Date {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
  return new Date(`${p}T00:00:00Z`);
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const br = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
const mais = (d: Date, dias: number) => new Date(d.getTime() + dias * DIA_MS);

/** Os intervalos que as pessoas falam ("semana passada", "última quarta"),
 *  já calculados. Semana de segunda a domingo. */
export function calendarioDaBusca(agora: Date): { hoje: string; texto: string; ultimo: Record<string, string> } {
  const hoje = hojeEmBrasilia(agora);
  const dow = hoje.getUTCDay();
  const segundaDestaSemana = mais(hoje, -((dow + 6) % 7));
  const primeiroDoMes = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));
  const primeiroDoMesPassado = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1));
  const ultimo: Record<string, string> = {};
  // "a última quarta" = a quarta mais recente ANTES de hoje
  for (let i = 1; i <= 7; i++) {
    const d = mais(hoje, -i);
    ultimo[DIAS[d.getUTCDay()]] = iso(d);
  }
  const intervalo = (nome: string, a: Date, b: Date) => `- ${nome}: de ${iso(a)} a ${iso(b)} (${br(a)} a ${br(b)})`;
  const linhas = [
    `Hoje é ${DIAS[dow]}, ${br(hoje)} (${iso(hoje)}), horário de Brasília.`,
    intervalo("hoje", hoje, hoje),
    intervalo("ontem", mais(hoje, -1), mais(hoje, -1)),
    intervalo("esta semana (segunda a hoje)", segundaDestaSemana, hoje),
    intervalo("semana passada (segunda a domingo)", mais(segundaDestaSemana, -7), mais(segundaDestaSemana, -1)),
    intervalo("últimos 7 dias", mais(hoje, -6), hoje),
    intervalo("últimos 15 dias", mais(hoje, -14), hoje),
    intervalo("últimos 30 dias", mais(hoje, -29), hoje),
    intervalo("este mês", primeiroDoMes, hoje),
    intervalo("mês passado", primeiroDoMesPassado, mais(primeiroDoMes, -1)),
    intervalo("este ano", new Date(Date.UTC(hoje.getUTCFullYear(), 0, 1)), hoje),
    "Último dia da semana antes de hoje (\"a última quarta\", \"na sexta\"):",
    ...Object.entries(ultimo).map(([dia, d]) => `- ${dia}: ${d}`),
  ];
  return { hoje: iso(hoje), texto: linhas.join("\n"), ultimo };
}

/** Limpa o que a IA devolveu: só valores conhecidos, datas no formato,
 *  vídeos do catálogo. O banco confere tudo de novo. */
export function limparFiltro(r: Record<string, unknown>, procedimentos: string[], catalogo: Set<string>, categorias: readonly string[]): FiltroBusca {
  const lista = (v: unknown, max = 20) => (Array.isArray(v) ? v : []).map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, max);
  const data = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
  const triplo = (v: unknown) => (v === "sim" ? true : v === "nao" ? false : null);
  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);
  let de = data(r.de);
  let ate = data(r.ate);
  if (de && ate && de > ate) [de, ate] = [ate, de];
  const f: FiltroBusca = {
    de, ate,
    grupos: (Array.isArray(r.grupos) ? r.grupos : []).slice(0, 6).map((g) => ({
      termos: lista((g as Record<string, unknown>)?.termos, 30).map((t) => t.slice(0, 40)),
      procedimentos: lista((g as Record<string, unknown>)?.procedimentos).filter((p) => procedimentos.includes(p)),
    })).filter((g) => g.termos.length || g.procedimentos.length),
    todos: r.todos === true,
    sem: lista(r.sem, 30).map((t) => t.slice(0, 40)),
    categorias: lista(r.categorias).filter((c) => categorias.includes(c)),
    videos: lista(r.videos, 10).filter((v) => catalogo.has(v)),
    video_titulo: texto(r.video_titulo),
    autor: texto(r.autor),
    urgente: triplo(r.urgente),
    lead: triplo(r.lead),
    conversa: triplo(r.conversa),
    situacao: lista(r.situacao).filter((s) => (SITUACOES as readonly string[]).includes(s)),
    ordem: (ORDENS as readonly string[]).includes(String(r.ordem)) ? String(r.ordem) : "recentes",
  };
  for (const k of LIMITES) {
    const n = Math.round(Number(r[k]));
    if (Number.isFinite(n) && n >= 0 && n <= 100) f[k] = n;
  }
  return f;
}


// ── busca direto no YouTube (15/11/26: "a minha intenção é que ela busque
// comentários do YouTube") ───────────────────────────────────────────────
// O YouTube só filtra por palavra (searchTerms) e por vídeo; o período sai de
// paginar do mais novo ao mais antigo. O resto (tipo, porcentagens...) é da
// triagem do DashMed e o banco aplica depois.
export type PlanoYoutube = { termos: string[]; cortados: number; de: string | null; ate: string | null };

/** Critérios (formato da URL) → o que pedir ao YouTube. Com "todos os
 *  assuntos", basta buscar as palavras do assunto com menos palavras (todo
 *  comentário achado tem de ter uma delas); o banco confere o resto. */
export function planoNoYoutube(f: Record<string, unknown>, maxTermos = 12): PlanoYoutube {
  const data = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
  const grupos = (Array.isArray(f.grupos) ? f.grupos : [])
    .map((g) => (Array.isArray((g as Record<string, unknown>)?.termos) ? (g as Record<string, unknown>).termos as unknown[] : [])
      .map((t) => String(t ?? "").replace(/\*+$/, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 40))
      .filter((t) => t.length >= 2))
    .filter((g) => g.length);
  const escolhidos = f.todos === true && grupos.length > 1 ? [grupos.reduce((a, b) => (b.length < a.length ? b : a))] : grupos;
  // um de cada assunto por vez, para o corte não deixar um assunto de fora
  const todos: string[] = [];
  for (let i = 0; escolhidos.some((g) => i < g.length); i++) {
    for (const g of escolhidos) if (i < g.length && !todos.includes(g[i])) todos.push(g[i]);
  }
  const de = data(f.de);
  const ate = data(f.ate);
  return {
    termos: todos.slice(0, maxTermos),
    cortados: Math.max(0, todos.length - maxTermos),
    // Brasília sem horário de verão desde 2019: -03:00
    de: de ? new Date(`${de}T00:00:00-03:00`).toISOString() : null,
    ate: ate ? new Date(`${ate}T23:59:59.999-03:00`).toISOString() : null,
  };
}
