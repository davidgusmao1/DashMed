// Quem pode fazer o quê na tela de Usuários (David, 11/11/26: "criar a tela de
// usuários ... Assim você mesmo cria e desativa as contas delas" — as
// secretárias do CRM). Regras puras, sem banco, para a edge function `usuarios`
// usar e o teste supabase/tests/usuarios.ts conferir.
//
// O que elas protegem:
// - só administra quem é admin daquele cliente ou da equipe da plataforma;
// - ninguém mexe na própria conta por aqui (não se rebaixa nem se desativa por
//   engano e fica sem administrador);
// - conta da equipe da plataforma só é mexida pela própria plataforma;
// - o link de acesso entra na conta de outra pessoa sem senha: por isso o
//   admin do cliente só gera para quem nunca entrou (primeiro acesso). Para
//   quem já entrou, só a plataforma (suporte), e nunca para conta da plataforma.

export type Ator = { id: string; papel: "admin" | "membro"; plataforma: boolean; cliente_id: string | null };
export type Alvo = { id: string; papel: "admin" | "membro"; plataforma: boolean; cliente_id: string | null; ativo: boolean; ja_entrou: boolean };
export type Decisao = { ok: true } | { ok: false; motivo: string };

const SIM: Decisao = { ok: true };
const nao = (motivo: string): Decisao => ({ ok: false, motivo });

export function administraCliente(eu: Ator, clienteId: string | null): boolean {
  return eu.plataforma || (clienteId !== null && eu.cliente_id === clienteId && eu.papel === "admin");
}

export function podeCriar(eu: Ator, clienteId: string | null): Decisao {
  if (!clienteId) return nao("Escolha o cliente da nova conta.");
  return administraCliente(eu, clienteId) ? SIM : nao("Só o administrador do cliente ou a equipe da plataforma cria contas.");
}

function podeMexer(eu: Ator, alvo: Alvo): Decisao {
  if (alvo.id === eu.id) return nao("Você não pode mudar a sua própria conta por aqui.");
  if (alvo.plataforma && !eu.plataforma) return nao("Conta da equipe da plataforma só é mudada pela plataforma.");
  if (!administraCliente(eu, alvo.cliente_id)) return nao("Só o administrador do cliente ou a equipe da plataforma muda esta conta.");
  return SIM;
}

export function podeMudarPapel(eu: Ator, alvo: Alvo): Decisao {
  return podeMexer(eu, alvo);
}

export function podeDesativar(eu: Ator, alvo: Alvo): Decisao {
  const d = podeMexer(eu, alvo);
  if (!d.ok) return d;
  return alvo.ativo ? SIM : nao("Esta conta já está desativada.");
}

export function podeReativar(eu: Ator, alvo: Alvo): Decisao {
  const d = podeMexer(eu, alvo);
  if (!d.ok) return d;
  return alvo.ativo ? nao("Esta conta já está ativa.") : SIM;
}

export function podeGerarLink(eu: Ator, alvo: Alvo): Decisao {
  const d = podeMexer(eu, alvo);
  if (!d.ok) return d;
  if (!alvo.ativo) return nao("Reative a conta antes de gerar o link.");
  if (alvo.plataforma) return nao("Conta da equipe da plataforma não recebe link de acesso por aqui.");
  if (alvo.ja_entrou && !eu.plataforma) {
    return nao("Esta pessoa já entrou na DashMed: ela usa a senha dela. O link de acesso é só para o primeiro acesso.");
  }
  return SIM;
}

/** Nome e e-mail limpos, ou o motivo da recusa. */
export function validarNovaConta(nome: unknown, email: unknown, papel: unknown):
  { ok: true; nome: string; email: string; papel: "admin" | "membro" } | { ok: false; motivo: string } {
  const n = typeof nome === "string" ? nome.replace(/\s+/g, " ").trim() : "";
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (n.length < 2 || n.length > 120) return { ok: false, motivo: "Digite o nome da pessoa (de 2 a 120 letras)." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) || e.length > 200) return { ok: false, motivo: "E-mail inválido." };
  if (papel !== "admin" && papel !== "membro") return { ok: false, motivo: "Papel inválido." };
  return { ok: true, nome: n, email: e, papel };
}
