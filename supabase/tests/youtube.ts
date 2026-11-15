// Regras de texto do YouTube Seller (12/11/26). Roda em segundos:
//   deno run --allow-read supabase/tests/youtube.ts
import { calendarioDaBusca, limparFiltro, planoNoYoutube } from "../functions/_shared/busca-regras.ts";
import { etiquetasDoFiltro, filtroSoPalavras, lerFiltroDaUrl, normalizarFiltro, pedacosRealcados, regexDeRealce, semCriterio } from "../../src/lib/busca-youtube.ts";
import { editouDeVerdade, garantirCodigo, mensagensDepoisDoCanal, palavrasChave, problemaNaResposta, telefonesDoTexto, telefonesInventados, temLink, videosParecidos } from "../functions/_shared/texto.ts";

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

// vídeo do canal para indicar (14/11/26)
const catalogo = [
  { video_id: "v1", titulo: "Prótese de quadril: quando posso dirigir? | Dr. David Gusmão", descricao: "" },
  { video_id: "v2", titulo: "Luxação da prótese de quadril: como evitar", descricao: "" },
  { video_id: "v3", titulo: "Artrose do quadril: exercícios que ajudam", descricao: "fisioterapia e musculação" },
  { video_id: "v4", titulo: "Ácido hialurônico no quadril funciona?", descricao: "" },
  { video_id: "v5", titulo: "Quarta do Quadril #219 - dúvidas sobre o quadril", descricao: "" },
];
confere("palavras: sem acento, sem plural, sem palavra vazia", [...palavrasChave("Próteses de QUADRIL, doutor")].join(",") === "protese,quadril");
const dirigir = videosParecidos("Operei a prótese faz 1 mês, quando vou poder dirigir de novo?", catalogo, null);
confere("acha o vídeo do assunto (dirigir)", dirigir[0]?.video_id === "v1", dirigir.map((v) => v.video_id).join(","));
const luxou = videosParecidos("Tenho medo da prótese sair do lugar, luxação acontece muito?", catalogo, null);
confere("palavra rara pesa mais (luxação)", luxou[0]?.video_id === "v2", luxou.map((v) => v.video_id).join(","));
confere("não indica o vídeo em que a pessoa está comentando", !videosParecidos("quando posso dirigir depois da prótese", catalogo, "v1").some((v) => v.video_id === "v1"));
confere("palavra comum sozinha não basta (só 'quadril')", videosParecidos("Bom dia, meu quadril dói", catalogo, null).length === 0);
confere("catálogo vazio não quebra", videosParecidos("qualquer coisa", [], null).length === 0);

// busca por frase (15/11/26): o calendário que a IA usa e a limpeza dos critérios
{
  // domingo, 15/11/2026, 10h em Brasília (13h UTC)
  const cal = calendarioDaBusca(new Date("2026-11-15T13:00:00Z"));
  confere("calendário: hoje em Brasília", cal.hoje === "2026-11-15", cal.hoje);
  confere("calendário: a última quarta", cal.ultimo["quarta"] === "2026-11-11", cal.ultimo["quarta"]);
  confere("calendário: semana passada de segunda a domingo", cal.texto.includes("semana passada (segunda a domingo): de 2026-11-02 a 2026-11-08"));
  confere("calendário: esta semana", cal.texto.includes("esta semana (segunda a hoje): de 2026-11-09 a 2026-11-15"));
  confere("calendário: mês passado", cal.texto.includes("mês passado: de 2026-10-01 a 2026-10-31"));
  // 23h30 de domingo em Brasília já é segunda em UTC: o dia é o de Brasília
  const noite = calendarioDaBusca(new Date("2026-11-16T02:30:00Z"));
  confere("calendário: fuso de Brasília perto da meia-noite", noite.hoje === "2026-11-15", noite.hoje);
  // numa quarta, "a última quarta" é a da semana anterior
  confere("calendário: na quarta, a última quarta é a anterior", calendarioDaBusca(new Date("2026-11-11T15:00:00Z")).ultimo["quarta"] === "2026-11-04");
}
{
  const f = limparFiltro({
    de: "2026-11-08", ate: "2026-11-02", grupos: [{ termos: ["prótese", ""], procedimentos: ["Prótese de quadril", "Inventado"] }, { termos: [], procedimentos: [] }],
    todos: false, sem: [], categorias: ["preco", "xx"], videos: ["v1", "fora"], video_titulo: "", autor: " ", urgente: "sim", lead: "indiferente",
    conversa: "nao", situacao: ["fila", "outra"], consulta_min: 70, consulta_max: -1, socio_min: 150, ordem: "estranha",
  }, ["Prótese de quadril"], new Set(["v1"]), ["preco", "agendamento"]);
  confere("limpeza: datas trocadas voltam à ordem", f.de === "2026-11-02" && f.ate === "2026-11-08");
  confere("limpeza: procedimento e grupo vazios saem", f.grupos.length === 1 && f.grupos[0].procedimentos.join() === "Prótese de quadril" && f.grupos[0].termos.join() === "prótese");
  confere("limpeza: só categoria, vídeo e situação conhecidos", f.categorias.join() === "preco" && f.videos.join() === "v1" && f.situacao.join() === "fila");
  confere("limpeza: sim/não/indiferente", f.urgente === true && f.lead === null && f.conversa === false);
  confere("limpeza: -1 e fora de 0–100 = sem limite", f.consulta_min === 70 && f.consulta_max === undefined && f.socio_min === undefined);
  confere("limpeza: ordem desconhecida vira recentes", f.ordem === "recentes");
}
{
  const n = normalizarFiltro({ de: null, ate: "", grupos: [{ termos: ["dor"], procedimentos: [] }], todos: true, urgente: null, consulta_min: 0, video_titulo: null });
  confere("URL: tira o vazio e o todos de um grupo só", JSON.stringify(n) === '{"grupos":[{"termos":["dor"],"procedimentos":[]}],"consulta_min":0}', JSON.stringify(n));
  confere("URL: sem critério = nada", normalizarFiltro({ de: null, grupos: [] }) === null && lerFiltroDaUrl("{quebrado") === null);
  const dois = normalizarFiltro({ grupos: [{ termos: ["prótese"], procedimentos: [] }, { termos: ["dor"], procedimentos: [] }], todos: true, de: "2026-11-02", ate: "2026-11-08" })!;
  const sem1 = semCriterio(dois, "grupo:0")!;
  confere("etiqueta: tirar um assunto tira o 'todos'", sem1.grupos!.length === 1 && sem1.todos === undefined && sem1.de === "2026-11-02");
  confere("etiqueta: tirar a data", semCriterio(dois, "data")!.de === undefined);
  const et = etiquetasDoFiltro(dois, { videos: {}, categorias: {} }).map((e) => e.texto);
  confere("etiqueta: textos", et[0] === "Comentados de 02/11/2026 a 08/11/2026" && et[1] === "Fala de: prótese" && et[2] === "E também de: dor", et.join(" | "));
  confere("etiqueta: um dia diz o dia da semana", etiquetasDoFiltro({ de: "2026-11-11", ate: "2026-11-11" }, { videos: {}, categorias: {} })[0].texto === "Comentados em 11/11/2026 (quarta)");
}
{
  const rx = regexDeRealce({ grupos: [{ termos: ["protese", "dor", "infiltr*"], procedimentos: [] }] });
  const marcados = (t: string) => pedacosRealcados(t, rx).filter((p) => p.marca).map((p) => p.t).join(",");
  confere("realce: sem ligar para acento", marcados("Minha Prótese ficou ótima") === "Prótese");
  confere("realce: palavra inteira (doutor e adorei não)", marcados("Doutor, adorei! Mas a dor continua") === "dor");
  confere("realce: prefixo pega a palavra toda", marcados("Fiz infiltração ontem") === "infiltração");
  confere("realce: sem termo não marca nada", pedacosRealcados("texto", regexDeRealce({ de: "2026-11-01" })).length === 1);
  const so = filtroSoPalavras("comentários que falam de Prótese e dor");
  confere("sem a IA: busca pelas palavras", JSON.stringify(so?.grupos?.map((g) => g.termos[0])) === '["protese","dor"]' && so?.todos === true, JSON.stringify(so));
}

// busca direto no YouTube: o que pedir ao YouTube
{
  const p = planoNoYoutube({ de: "2026-11-02", ate: "2026-11-08", grupos: [{ termos: ["Prótese", "protese", "artroplastia"] }, { termos: ["dor", "dores"] }] });
  confere("YouTube: um termo de cada assunto por vez", p.termos.join() === "prótese,dor,protese,dores,artroplastia", p.termos.join());
  confere("YouTube: período em Brasília", p.de === "2026-11-02T03:00:00.000Z" && p.ate === "2026-11-09T02:59:59.999Z", `${p.de} ${p.ate}`);
  const t = planoNoYoutube({ todos: true, grupos: [{ termos: ["prótese", "protese", "artroplastia"] }, { termos: ["dor", "dores"] }] });
  confere("YouTube: com todos os assuntos, só o menor grupo", t.termos.join() === "dor,dores", t.termos.join());
  const c = planoNoYoutube({ grupos: [{ termos: ["infiltr*", " a ", "x".repeat(60)] }] }, 2);
  confere("YouTube: tira o *, curto e longo demais", c.termos[0] === "infiltr" && c.termos.length === 2 && c.termos[1].length === 40 && c.cortados === 0, JSON.stringify(c));
  confere("YouTube: corte avisado", planoNoYoutube({ grupos: [{ termos: ["aa", "bb", "cc"] }] }, 2).cortados === 1);
  confere("YouTube: sem palavra nem data, plano vazio", planoNoYoutube({ consulta_min: 70 }).termos.length === 0 && planoNoYoutube({}).de === null);
}

if (falhas) {
  console.error(`\n${falhas} regra(s) falharam.`);
  Deno.exit(1);
}
console.log("\nTodas as regras do YouTube Seller conferem.");
