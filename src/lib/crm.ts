// Funil do CRM de resgate (David, 11/11/26: secretárias ligam para "resgatar
// pacientes que tiveram um tratamento indicado e não realizaram"). Usado pelo
// Kanban (/crm), pela Agenda e pela ficha da terapia. Os valores batem com o
// check de terapias.situacao e contatos.resultado (0004_crm.sql).

export const ETAPAS = [
  { valor: "a_chamar", rotulo: "A contatar" },
  { valor: "tentativa", rotulo: "Tentando contato" },
  { valor: "em_conversa", rotulo: "Em conversa" },
  { valor: "agendado", rotulo: "Agendado" },
  { valor: "realizado", rotulo: "Realizado" },
  { valor: "nao_renovar", rotulo: "Não vai fazer" },
] as const;
export type Etapa = (typeof ETAPAS)[number]["valor"];
export const ROTULO_ETAPA: Record<string, string> = Object.fromEntries(ETAPAS.map((e) => [e.valor, e.rotulo]));
export const ehEtapa = (v: string): v is Etapa => ETAPAS.some((e) => e.valor === v);

// Resultado da ligação e para onde o cartão vai por padrão (quem liga pode
// escolher outra etapa no mesmo formulário).
export const RESULTADOS = [
  { valor: "nao_atendeu", rotulo: "Não atendeu", etapa: "tentativa" },
  { valor: "caixa_postal", rotulo: "Caixa postal / recado", etapa: "tentativa" },
  { valor: "numero_invalido", rotulo: "Número errado / não existe", etapa: "tentativa" },
  { valor: "falou", rotulo: "Falou com o paciente", etapa: "em_conversa" },
  { valor: "pediu_retorno", rotulo: "Pediu para ligar depois", etapa: "em_conversa" },
  { valor: "agendou", rotulo: "Agendou", etapa: "agendado" },
  { valor: "ja_realizou", rotulo: "Já fez o tratamento", etapa: "realizado" },
  { valor: "nao_quer", rotulo: "Não quer fazer", etapa: "nao_renovar" },
] as const;
export type ResultadoContato = (typeof RESULTADOS)[number]["valor"];
export const ROTULO_RESULTADO: Record<string, string> = Object.fromEntries(RESULTADOS.map((r) => [r.valor, r.rotulo]));
export const ehResultado = (v: string): v is ResultadoContato => RESULTADOS.some((r) => r.valor === v);

/** Procedimentos cirúrgicos: o foco do resgate ("pacientes que ainda não
 *  fizeram cirurgias"). ATQ/MAKO = prótese de quadril; VAQ = videoartroscopia. */
export function ehCirurgia(procedimento: string): boolean {
  const p = procedimento.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return /\b(atq|vaq|protese|artroplastia|artroscopia|mako|cirurgia|osteotomia)\b/.test(p);
}
