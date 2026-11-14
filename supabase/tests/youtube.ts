// Regras de texto do YouTube Seller (12/11/26). Roda em segundos:
//   deno run --allow-read supabase/tests/youtube.ts
import { editouDeVerdade, garantirCodigo, mensagensDepoisDoCanal, problemaNaResposta, telefonesDoTexto, telefonesInventados, temLink } from "../functions/_shared/texto.ts";

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe = "") {
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${!ok && detalhe ? ` — ${detalhe}` : ""}`);
  if (!ok) falhas++;
}

const config = [
  "Telemedicina: agende pelo WhatsApp (51) 99999-1234",
  "Porto Alegre: Hospital Exemplo, Av. Ipiranga 1000 — (51) 3333-4444",
  "São Paulo: Clínica Exemplo, Rua Augusta 500",
  "+55 11 98888-7777",
];

// telefones
confere("acha celular com DDD", telefonesDoTexto("chame no (51) 99999-1234").join() === "51999991234");
confere("tira o +55", telefonesDoTexto("+55 11 98888-7777").join() === "11988887777");
confere("número curto não é telefone", telefonesDoTexto("em 2023, 45 pacientes").length === 0);
confere("telefone das configurações passa", telefonesInventados("WhatsApp 51 99999-1234", config).length === 0);
confere("mesmo número escrito diferente passa", telefonesInventados("ligue 11988887777", config).length === 0);
confere("telefone inventado é pego", telefonesInventados("ligue (51) 98765-4321", config).join() === "51987654321");

// links
confere("link com http é pego", temLink("veja https://exemplo.com"));
confere("domínio solto é pego", temLink("acesse clinica.com.br"));
confere("texto comum não é link", !temLink("A prótese de quadril dura bastante. Agende pelo WhatsApp."));

// código do lead
const comTel = "Para uma estimativa, chame no WhatsApp (51) 99999-1234.";
confere("põe o código quando manda para telefone", garantirCodigo(comTel, "YT1234").endsWith("(informe o código YT1234)"));
confere("não repete o código que já está", garantirCodigo(`${comTel} Informe o código YT1234.`, "YT1234") === `${comTel} Informe o código YT1234.`);
confere("sem telefone não põe código", garantirCodigo("Obrigado pelo comentário!", "YT1234") === "Obrigado pelo comentário!");

// conferência completa
confere("resposta boa passa", problemaNaResposta("Oi, Maria! A prótese costuma ser indicada após avaliação. Agende pelo WhatsApp (51) 99999-1234 e informe o código YT1234.", config) === null);
confere("resposta vazia é recusada", problemaNaResposta("ok", config) !== null);
confere("resposta com link é recusada", (problemaNaResposta("Veja mais em https://site.com, é um bom resumo do tema.", config) ?? "").includes("link"));
confere("resposta com telefone inventado é recusada", (problemaNaResposta("Agende pelo telefone (21) 91234-5678, nossa equipe ajuda.", config) ?? "").includes("telefone"));
confere("resposta longa demais é recusada", (problemaNaResposta("a ".repeat(600), config) ?? "").includes("caracteres"));

// aprender com as edições: só conta mudança de verdade
confere("espaço e maiúscula não contam como edição", !editouDeVerdade("Olá, Maria!  Tudo bem?", "olá, maria! tudo bem?"));
confere("texto trocado conta como edição", editouDeVerdade("Agende pelo WhatsApp.", "Agende pela secretária no WhatsApp."));
confere("sem sugestão guardada não conta", !editouDeVerdade(null, "qualquer coisa"));

// seguir a conversa: só o que chegou depois da última resposta do canal
const conversa = [
  { autor_canal_id: "UCpessoa", publicado_em: "2026-11-01T10:00:00Z", texto: "pergunta" },
  { autor_canal_id: "UCcanal", publicado_em: "2026-11-02T10:00:00Z", texto: "resposta do canal" },
  { autor_canal_id: "UCpessoa", publicado_em: "2026-11-03T10:00:00Z", texto: "e quanto custa?" },
  { autor_canal_id: "UCoutra", publicado_em: "2026-11-03T11:00:00Z", texto: "também quero saber" },
  { autor_canal_id: "UCpessoa", publicado_em: "2026-11-03T12:00:00Z", texto: "   " },
];
const novasConversa = mensagensDepoisDoCanal(conversa, "UCcanal");
confere("pega as mensagens depois da resposta do canal", novasConversa.length === 2 && novasConversa[0].texto === "e quanto custa?");
confere("mensagem vazia não conta", !novasConversa.some((m) => !m.texto.trim()));
confere("canal respondeu por último: nada a seguir", mensagensDepoisDoCanal([...conversa.slice(0, 4), { autor_canal_id: "UCcanal", publicado_em: "2026-11-04T10:00:00Z", texto: "ok" }], "UCcanal").length === 0);
confere("canal nunca respondeu: nada a seguir", mensagensDepoisDoCanal([conversa[0], conversa[2]], "UCcanal").length === 0);

if (falhas) {
  console.error(`\n${falhas} regra(s) falharam.`);
  Deno.exit(1);
}
console.log("\nTodas as regras do YouTube Seller conferem.");
