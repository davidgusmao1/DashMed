/** Dígitos → "(11) 98765-4321". Guarda-se só os dígitos; formata-se na tela. */
export function telefoneBR(digitos: string | null | undefined): string {
  if (!digitos) return "";
  let d = digitos.replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}
