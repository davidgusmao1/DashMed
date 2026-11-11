// Teste das regras da tela de Usuários (supabase/functions/_shared/regras-usuarios.ts).
// Roda com Deno ou Node:
//   deno run --allow-read supabase/tests/usuarios.ts
//   node --experimental-strip-types supabase/tests/usuarios.ts
import {
  type Alvo, type Ator, podeCriar, podeDesativar, podeGerarLink, podeMudarPapel, podeReativar, validarNovaConta,
} from "../functions/_shared/regras-usuarios.ts";

const C = "cliente-david";
const OUTRO = "cliente-outro";
const plataforma: Ator = { id: "david", papel: "admin", plataforma: true, cliente_id: C };
const adminC: Ator = { id: "admin-c", papel: "admin", plataforma: false, cliente_id: C };
const membroC: Ator = { id: "secretaria", papel: "membro", plataforma: false, cliente_id: C };
const adminOutro: Ator = { id: "admin-outro", papel: "admin", plataforma: false, cliente_id: OUTRO };

const alvo = (p: Partial<Alvo>): Alvo => ({ id: "alvo", papel: "membro", plataforma: false, cliente_id: C, ativo: true, ja_entrou: false, ...p });

let certos = 0;
let falhas = 0;
function confere(nome: string, obtido: { ok: boolean }, esperado: boolean) {
  if (obtido.ok === esperado) certos++;
  else { falhas++; console.log(`FALHOU — ${nome}: esperava ${esperado ? "permitir" : "recusar"}`, obtido); }
}

confere("plataforma cria no cliente", podeCriar(plataforma, C), true);
confere("admin cria no próprio cliente", podeCriar(adminC, C), true);
confere("membro não cria", podeCriar(membroC, C), false);
confere("admin de outro cliente não cria aqui", podeCriar(adminOutro, C), false);
confere("sem cliente não cria", podeCriar(plataforma, null), false);

confere("admin desativa secretária", podeDesativar(adminC, alvo({})), true);
confere("membro não desativa", podeDesativar(membroC, alvo({})), false);
confere("ninguém se desativa", podeDesativar(adminC, alvo({ id: "admin-c", papel: "admin" })), false);
confere("admin do cliente não desativa a plataforma", podeDesativar(adminC, alvo({ id: "david", plataforma: true, papel: "admin" })), false);
confere("admin de outro cliente não desativa", podeDesativar(adminOutro, alvo({})), false);
confere("não desativa duas vezes", podeDesativar(adminC, alvo({ ativo: false })), false);
confere("reativa quem está desativado", podeReativar(adminC, alvo({ ativo: false })), true);
confere("não reativa quem está ativo", podeReativar(adminC, alvo({})), false);

confere("admin promove secretária", podeMudarPapel(adminC, alvo({})), true);
confere("ninguém muda o próprio papel", podeMudarPapel(adminC, alvo({ id: "admin-c" })), false);
confere("membro não muda papel", podeMudarPapel(membroC, alvo({})), false);

confere("link de primeiro acesso: admin, quem nunca entrou", podeGerarLink(adminC, alvo({})), true);
confere("link: admin não gera para quem já entrou", podeGerarLink(adminC, alvo({ ja_entrou: true })), false);
confere("link: plataforma gera para quem já entrou (suporte)", podeGerarLink(plataforma, alvo({ ja_entrou: true })), true);
confere("link: nunca para conta da plataforma", podeGerarLink(plataforma, alvo({ id: "jorge", plataforma: true })), false);
confere("link: nunca para conta desativada", podeGerarLink(plataforma, alvo({ ativo: false })), false);
confere("link: membro não gera", podeGerarLink(membroC, alvo({})), false);
confere("link: não para si mesmo", podeGerarLink(plataforma, alvo({ id: "david" })), false);

confere("nova conta válida", validarNovaConta(" Maria  Souza ", " Maria@Clinica.com.br ", "membro"), true);
confere("nova conta sem nome", validarNovaConta(" ", "a@b.com", "membro"), false);
confere("nova conta e-mail ruim", validarNovaConta("Maria", "maria@", "membro"), false);
confere("nova conta papel inventado", validarNovaConta("Maria", "a@b.com", "dono"), false);
const v = validarNovaConta(" Maria  Souza ", " Maria@Clinica.com.br ", "membro");
confere("nome e e-mail limpos", { ok: v.ok && v.nome === "Maria Souza" && v.email === "maria@clinica.com.br" }, true);

console.log(`Regras de usuários: ${certos} de ${certos + falhas} OK`);
if (falhas) throw new Error(`${falhas} regra(s) falharam`);
