// Busca de referências de um conteúdo (passo 1 do fluxo do David, 10/11/26:
// "peço para a AI buscar referências na internet em publicações médicas").
//
// 1. a IA transforma o assunto em consultas em inglês para a Europe PMC;
// 2. a Europe PMC devolve artigos do PubMed com resumo (fonte da verdade:
//    toda referência tem PMID real, a IA não inventa artigo);
// 3. a IA lê os resumos, dá relevância, nota e sugestão, e escreve a síntese.
// Roda em segundo plano (responde 202 na hora); o estado fica em
// conteudos.pesquisa_estado e a tela acompanha. O vigia marca erro se travar.
import {
  admin, carregarPerfil, CORS, corpoJson, ehUuid, emSegundoPlano, enxerga, Falha, lerSegredo, perfilEmTexto, quemPediu,
  responder, respostaDeErro, VIOLACAO_UNICA,
} from "../_shared/base.ts";
import { claudeDoCliente, pedirJson } from "../_shared/claude.ts";
import { buscarEuropePmc, type Candidato, juntarCandidatos } from "../_shared/europepmc.ts";
import { consultaSegura, montarBuscas, rotuloEvidencia, soPmidsConhecidos } from "../_shared/texto.ts";

type Conteudo = { id: string; cliente_id: string; assunto: string; orientacoes: string };

const ESQUEMA_CONSULTAS = {
  type: "object",
  properties: {
    consultas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          descricao: { type: "string", description: "o ângulo desta consulta, em português, curto" },
          consulta: { type: "string", description: "consulta em inglês na sintaxe da Europe PMC" },
        },
        required: ["descricao", "consulta"],
        additionalProperties: false,
      },
    },
  },
  required: ["consultas"],
  additionalProperties: false,
};

const SISTEMA_CONSULTAS = `Você é bibliotecário de ciências da saúde e monta estratégias de busca para a Europe PMC, que indexa o PubMed.
Você recebe um assunto em português, escolhido por um médico para um vídeo educativo no YouTube, e as orientações dele.
Devolva de 2 a 4 consultas em INGLÊS, na sintaxe da Europe PMC:
- expressões entre aspas ("hip arthroscopy"), sinônimos com OR dentro de parênteses, conceitos ligados por AND;
- a primeira consulta cobre o tema central de forma ampla; as outras cobrem os ângulos que o médico pediu (diagnóstico, tratamento, prognóstico, reabilitação, prevenção...);
- NÃO use campos de filtro (SRC:, PUB_TYPE:, PUB_YEAR:, HAS_ABSTRACT:): o sistema já aplica;
- parênteses e aspas sempre balanceados; no máximo 300 caracteres por consulta.`;

const ESQUEMA_TRIAGEM = {
  type: "object",
  properties: {
    avaliacoes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          pmid: { type: "string" },
          relevancia: { type: "integer", enum: [0, 1, 2, 3, 4, 5] },
          nota: { type: "string", description: "achado principal, em português, até 30 palavras" },
          sugerida: { type: "boolean" },
        },
        required: ["pmid", "relevancia", "nota", "sugerida"],
        additionalProperties: false,
      },
    },
    sintese: { type: "string", description: "até 250 palavras, em português, citando [PMID n]" },
  },
  required: ["avaliacoes", "sintese"],
  additionalProperties: false,
};

const SISTEMA_TRIAGEM = `Você é médico revisor de evidência científica e ajuda um colega a preparar um vídeo educativo para o YouTube.
Você recebe o assunto, as orientações do médico e uma lista de artigos do PubMed (PMID, tipo de estudo, ano, revista, citações e resumo).
Para CADA artigo da lista, devolva:
- relevancia de 0 a 5 para o vídeo (5 = central e confiável). Pese o tipo de estudo (meta-análise, revisão sistemática e diretriz acima de ensaio randomizado, acima de estudo observacional), a atualidade e o quanto responde ao assunto;
- nota: o achado principal em português, em até 30 palavras. Use números só se estiverem no resumo;
- sugerida: true para os 5 a 10 artigos que você usaria no vídeo.
Depois escreva a sintese, em português e em até 250 palavras: o que a evidência mostra, onde ela é fraca ou controversa e o que ainda não se sabe, citando os artigos assim: [PMID 12345678].
Use SÓ os artigos da lista. Nunca cite estudo que não esteja nela e nunca invente número.`;

function artigosEmTexto(cs: Candidato[]): string {
  return cs.map((c) => [
    `PMID ${c.pmid} | ${rotuloEvidencia(c.tipos)} | ${c.ano ?? "s/ano"} | ${c.revista} | ${c.citacoes} citações`,
    `Título: ${c.titulo}`,
    `Resumo: ${c.resumo.slice(0, 1400)}`,
  ].join("\n")).join("\n\n");
}

async function pesquisar(conteudo: Conteudo): Promise<void> {
  const consultasUsadas: { descricao: string; consulta: string; encontrados: number }[] = [];
  try {
    const perfil = await carregarPerfil(conteudo.cliente_id);
    const claude = await claudeDoCliente(conteudo.cliente_id, 90_000);
    const contexto = `Assunto: ${conteudo.assunto}\nOrientações do médico: ${conteudo.orientacoes || "nenhuma"}\n\nPerfil do médico:\n${perfilEmTexto(perfil)}`;

    // 1. consultas
    const { consultas } = await pedirJson<{ consultas: { descricao: string; consulta: string }[] }>(claude, {
      sistema: SISTEMA_CONSULTAS, pedido: contexto, esquema: ESQUEMA_CONSULTAS, esforco: "low", maxTokens: 4000, timeoutMs: 40_000,
    });
    const validas = consultas.slice(0, 4).map((c) => ({ descricao: c.descricao, consulta: consultaSegura(c.consulta) }))
      .filter((c): c is { descricao: string; consulta: string } => !!c.consulta);
    if (!validas.length) throw new Falha("A IA não montou nenhuma consulta válida para a Europe PMC. Tente de novo ou reformule o assunto.");

    // 2. Europe PMC (todas as buscas em paralelo)
    const ano = new Date().getFullYear();
    const listas = await Promise.all(validas.map(async (c) => {
      const resultados = await Promise.allSettled(montarBuscas(c.consulta, ano).map((b) => buscarEuropePmc(b.query, b.pageSize, b.ordem)));
      const achados = resultados.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      const falhas = resultados.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      if (falhas.length === resultados.length) throw falhas[0].reason;
      consultasUsadas.push({ ...c, encontrados: achados.length });
      return achados;
    }));
    const candidatos = juntarCandidatos(listas, 35);
    if (!candidatos.length) {
      throw new Falha("A Europe PMC não trouxe nenhum artigo com resumo para essas buscas. Reformule o assunto (mais específico ou com outro termo) e busque de novo.");
    }

    // 3. triagem pela IA
    const triagem = await pedirJson<{ avaliacoes: { pmid: string; relevancia: number; nota: string; sugerida: boolean }[]; sintese: string }>(claude, {
      sistema: SISTEMA_TRIAGEM, pedido: `${contexto}\n\nARTIGOS:\n\n${artigosEmTexto(candidatos)}`, esquema: ESQUEMA_TRIAGEM,
      esforco: "medium", maxTokens: 16000, timeoutMs: 90_000,
    });
    const conhecidos = new Set(candidatos.map((c) => c.pmid));
    const avaliacao = new Map<string, { relevancia: number; nota: string; sugerida: boolean }>();
    for (const a of triagem.avaliacoes ?? []) {
      const [pmid] = soPmidsConhecidos([a.pmid], conhecidos);
      if (pmid) avaliacao.set(pmid, { relevancia: Math.max(0, Math.min(5, Math.round(a.relevancia))), nota: String(a.nota).slice(0, 400), sugerida: !!a.sugerida });
    }

    // 4. grava: artigo novo entra (já marcado se a IA sugeriu); artigo que já
    // estava só tem a avaliação da IA atualizada — a escolha do médico fica
    const { data: existentes } = await admin.from("referencias").select("pmid")
      .eq("conteudo_id", conteudo.id).is("deleted_at", null);
    const jaTem = new Set((existentes ?? []).map((r) => r.pmid as string));
    const novas = candidatos.filter((c) => !jaTem.has(c.pmid)).map((c) => {
      const a = avaliacao.get(c.pmid);
      return {
        cliente_id: conteudo.cliente_id, conteudo_id: conteudo.id, ...c,
        relevancia: a?.relevancia ?? null, nota: a?.nota ?? null, sugerida: a?.sugerida ?? false, selecionada: a?.sugerida ?? false,
      };
    });
    let descartadas = 0;
    if (novas.length) {
      const { error } = await admin.from("referencias").insert(novas);
      if (error?.code === VIOLACAO_UNICA) {
        // outra busca gravou o mesmo artigo no meio do caminho: grava um a um
        // e registra o descarte (regra 1)
        for (const n of novas) {
          const { error: e1 } = await admin.from("referencias").insert(n);
          if (e1?.code === VIOLACAO_UNICA) descartadas++;
          else if (e1) throw new Falha(`Não consegui gravar as referências (${e1.message}).`, 500);
        }
        console.warn(`conteudos-pesquisa: ${descartadas} referência(s) repetida(s) descartada(s) no conteúdo ${conteudo.id}`);
      } else if (error) {
        throw new Falha(`Não consegui gravar as referências (${error.message}).`, 500);
      }
    }
    for (const pmid of jaTem) {
      const a = avaliacao.get(pmid);
      if (!a) continue;
      await admin.from("referencias").update({ relevancia: a.relevancia, nota: a.nota, sugerida: a.sugerida })
        .eq("conteudo_id", conteudo.id).eq("pmid", pmid).is("deleted_at", null);
    }

    const sugeridas = [...avaliacao.values()].filter((a) => a.sugerida).length;
    const { error: eFim } = await admin.from("conteudos").update({
      pesquisa_estado: "pronta",
      pesquisa_msg: `${candidatos.length} artigos analisados, ${sugeridas} sugeridos pela IA${novas.length < candidatos.length ? ` (${candidatos.length - novas.length} já estavam na lista)` : ""}.`,
      pesquisa_terminada_em: new Date().toISOString(),
      consultas: consultasUsadas,
      sintese: triagem.sintese,
    }).eq("id", conteudo.id);
    if (eFim) throw new Falha(`Busca feita, mas não consegui gravar o resultado (${eFim.message}).`, 500);
  } catch (e) {
    const msg = e instanceof Falha ? e.message : `Erro inesperado na busca: ${e instanceof Error ? e.message : String(e)}`;
    console.error("conteudos-pesquisa", conteudo.id, msg);
    await admin.from("conteudos").update({
      pesquisa_estado: "erro", pesquisa_msg: msg, pesquisa_terminada_em: new Date().toISOString(), consultas: consultasUsadas,
    }).eq("id", conteudo.id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") throw new Falha("Use POST.", 405);
    const eu = await quemPediu(req);
    const { conteudo_id } = await corpoJson<{ conteudo_id?: string }>(req);
    if (!ehUuid(conteudo_id)) throw new Falha("Conteúdo inválido.");
    const { data: c } = await admin.from("conteudos").select("id, cliente_id, assunto, orientacoes")
      .eq("id", conteudo_id).is("deleted_at", null).maybeSingle();
    if (!c || !enxerga(eu, c.cliente_id)) throw new Falha("Conteúdo não encontrado.", 404);
    // falta de chave aparece já, antes de marcar "buscando"
    if (!(await lerSegredo(c.cliente_id, "anthropic"))) {
      throw new Falha("Falta a chave da Anthropic (Claude). Coloque em Configurações → Chaves de API.", 412);
    }
    // começa só se não houver outra busca andando (troca de estado atômica)
    const { data: marcado } = await admin.from("conteudos").update({
      pesquisa_estado: "buscando", pesquisa_msg: null, pesquisa_iniciada_em: new Date().toISOString(), pesquisa_terminada_em: null,
    }).eq("id", c.id).neq("pesquisa_estado", "buscando").select("id");
    if (!marcado?.length) throw new Falha("Já há uma busca andando para este conteúdo.", 409);
    emSegundoPlano(pesquisar(c as Conteudo));
    return responder({ ok: true, mensagem: "Busca iniciada. Leva de 1 a 2 minutos." }, 202);
  } catch (e) {
    return respostaDeErro(e);
  }
});
