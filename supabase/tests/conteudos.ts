// Regras de texto do módulo Conteúdos. Roda em segundos:
//   deno run --allow-read supabase/tests/conteudos.ts
import {
  consultaSegura, contarPalavras, dividirEmCenas, dividirFala, LIMITE_CENA, limparParaFala, limparResumo, minutosDeFala,
  montarBuscas, pesoEvidencia, rotuloEvidencia, soPmidsConhecidos,
} from "../functions/_shared/texto.ts";

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe = "") {
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${!ok && detalhe ? ` — ${detalhe}` : ""}`);
  if (!ok) falhas++;
}

// palavras e minutos (150 palavras por minuto)
confere("conta palavras", contarPalavras("  um  dois\ntrês ") === 3);
confere("texto vazio tem zero palavras", contarPalavras("   ") === 0);
confere("2.250 palavras = 15 minutos", minutosDeFala(2250) === 15);

// resumo da Europe PMC vem com HTML
confere("limpa HTML do resumo", limparResumo("<h4>Objective</h4>To compare &amp; test.<p>x</p>") === "Objective To compare & test. x");
confere("resumo nulo vira vazio", limparResumo(null) === "");

// a fala do avatar não leva marcação nem colchete
confere("tira marcação da fala", limparParaFala("**Olá** [ON SCREEN: x]\n\n# Título\n\ntexto") === "Olá\n\nTítulo\n\ntexto");

// cenas da HeyGen: no máximo 5.000 caracteres cada, sem perder texto
const paragrafo = "Esta é uma frase de teste com algumas palavras. ".repeat(40).trim(); // ~1.900 caracteres
const longo = [paragrafo, paragrafo, paragrafo, paragrafo].join("\n\n"); // ~7.800
const cenas = dividirFala(longo);
confere("fala longa vira mais de uma cena", cenas.length === 2, `deu ${cenas.length}`);
confere("nenhuma cena passa do limite", cenas.every((c) => c.length <= LIMITE_CENA));
confere("divisão não perde palavras", cenas.reduce((s, c) => s + contarPalavras(c), 0) === contarPalavras(longo));
const semPontuacao = "palavra ".repeat(2000).trim(); // 15.999 caracteres, sem frase nem parágrafo
const cortadas = dividirFala(semPontuacao);
confere("texto sem pontuação também respeita o limite", cortadas.every((c) => c.length <= LIMITE_CENA) && cortadas.length === 4, `deu ${cortadas.length}`);
confere("fala curta é uma cena só", dividirFala("Olá, tudo bem?").length === 1);
confere("cada bloco gera cenas próprias", dividirEmCenas(["Bloco um.", "", "Bloco três."]).length === 2);

// evidência
confere("meta-análise pesa 5", pesoEvidencia(["Meta-Analysis", "Journal Article"]) === 5);
confere("ensaio randomizado pesa 4", pesoEvidencia(["Randomized Controlled Trial"]) === 4);
confere("artigo comum pesa 1", pesoEvidencia(["Journal Article"]) === 1);
confere("rótulo em português", rotuloEvidencia(["Systematic Review", "Journal Article"]) === "Revisão sistemática");

// buscas na Europe PMC: só PubMed, com resumo, e o filtro de evidência
const buscas = montarBuscas('"hip arthroscopy" AND (labral OR labrum)', 2026);
confere("duas buscas por consulta", buscas.length === 2);
confere("só registros do PubMed com resumo", buscas.every((b) => b.query.includes("SRC:MED") && b.query.includes("HAS_ABSTRACT:Y")));
confere("evidência forte nos últimos 10 anos", buscas[0].query.includes("PUB_YEAR:[2016 TO 2026]") && buscas[0].query.includes("Meta-Analysis"));
confere("recentes nos últimos 3 anos", buscas[1].query.includes("PUB_YEAR:[2023 TO 2026]"));
confere("evidência forte pelos mais citados, recentes por relevância", buscas[0].ordem === "CITED desc" && buscas[1].ordem === null);

// a consulta da IA é saneada
confere("consulta boa passa", consultaSegura('"knee" AND (pain OR ache)') === '"knee" AND (pain OR ache)');
confere("filtro posto pela IA sai sem deixar conector solto", consultaSegura("knee pain AND SRC:MED") === "knee pain");
confere("conector solto dentro de parênteses sai", consultaSegura("(knee AND PUB_YEAR:[2020 TO 2026]) AND pain") === "(knee) AND pain");
confere("parêntese desbalanceado é recusado", consultaSegura("(knee AND pain") === null);
confere("aspas desbalanceadas são recusadas", consultaSegura('"knee pain') === null);
confere("consulta vazia é recusada", consultaSegura("  ") === null);

// a IA só cita o que veio da busca
const conhecidos = new Set(["111", "222"]);
const citados = soPmidsConhecidos(["111", "999", 222, "111"], conhecidos);
confere("PMID inventado é descartado e repetido sai", citados.length === 2 && citados.includes("111") && citados.includes("222"));
confere("lista inválida vira vazia", soPmidsConhecidos("111", conhecidos).length === 0);

if (falhas) {
  console.error(`\n${falhas} regra(s) falharam.`);
  Deno.exit(1);
}
console.log("\nTodas as regras de texto conferem.");
