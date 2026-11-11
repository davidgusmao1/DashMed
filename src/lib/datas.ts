// Datas da operação em America/Sao_Paulo (HANDOFF, regra de fuso). Datas sem
// hora (vencimento, indicação) andam como texto "AAAA-MM-DD" para não virarem
// o dia anterior ao passar por UTC.

const FUSO = "America/Sao_Paulo";

/** Hoje em São Paulo, "AAAA-MM-DD". */
export function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function utc(iso: string): number {
  const [a, m, d] = iso.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
}

/** "AAAA-MM-DD" mais n dias. */
export function somarDias(iso: string, n: number): string {
  return new Date(utc(iso) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Dias de a até b (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

/** "AAAA-MM-DD" → "dd/mm/aaaa". */
export function dataBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** Instante (timestamptz) → "dd/mm/aaaa hh:mm" em São Paulo. */
export function instanteBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

/** Texto para o vencimento: "vencida há 3 dias", "vence hoje", "vence em 12 dias". */
export function prazoTexto(venceEm: string | null, hoje: string): string {
  if (!venceEm) return "sem vencimento";
  const d = diasEntre(hoje, venceEm);
  if (d === 0) return "vence hoje";
  if (d < 0) return `vencida há ${-d} ${-d === 1 ? "dia" : "dias"}`;
  return `vence em ${d} ${d === 1 ? "dia" : "dias"}`;
}
