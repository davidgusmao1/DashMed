// Link para a ficha do paciente no Apolo Ninsaúde (David, 12/11/26). O Apolo
// não abre ficha por link; quem abre é a extensão (public/dashmed-apolo.user.js)
// a partir do # que vai aqui. Com o código do Apolo, abre a ficha exata; sem
// ele, abre a lista de Pacientes buscando o telefone.

const BASE = "https://apolo.ninsaude.com/inicial/";

/** Nome da aba: a DashMed reaproveita a mesma aba do Apolo em vez de abrir uma por clique. */
export const ABA_APOLO = "apolo-ninsaude";

export function linkApolo(p: { apolo_id?: number | null; telefone?: string | null } | null | undefined): string | null {
  if (!p) return null;
  if (p.apolo_id) return `${BASE}#dashmed-paciente=${p.apolo_id}`;
  let t = (p.telefone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (t.length >= 12 && t.startsWith("55")) t = t.slice(2);
  return t.length >= 8 ? `${BASE}#dashmed-telefone=${t}` : null;
}
