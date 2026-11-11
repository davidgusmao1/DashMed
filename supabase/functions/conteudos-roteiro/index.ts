// Roteiro de vídeo de ~15 minutos (passo 2 do fluxo do David, 10/11/26: "uma
// vez depurado o assunto elaboramos um roteiro para vídeo em torno de 15
// minutos").
//
// O roteiro é escrito em passos curtos, porque a edge function tem no máximo
// 150 s de relógio no plano Free: primeiro a ESTRUTURA (blocos, minutos,
// referências de cada um), depois UM BLOCO por execução. Cada passo grava e
// dispara o seguinte; se a corrente parar, a tela mostra "Continuar" e o
// vigia marca erro (nada fica "escrevendo" para sempre).
//
// O texto do bloco é a FALA do avatar (vai para a HeyGen); sugestões de
// imagem ficam à parte, em na_tela. Bloco editado pelo médico não é
// sobrescrito sem ele confirmar (regra 4).
import {
  admin, carregarPerfil, chamadaInterna, chamarFuncaoInterna, CORS, corpoJson, ehUuid, emSegundoPlano, enxerga, Falha,
  lerSegredo, type Perfil, perfilEmTexto, quemPediu, responder, respostaDeErro, type Usuario, VIOLACAO_UNICA,
} from "../_shared/base.ts";
import { claudeDoCliente, pedirJson } from "../_shared/claude.ts";
import { contarPalavras, PALAVRAS_POR_MINUTO, rotuloEvidencia, soPmidsConhecidos } from "../_shared/texto.ts";

type Roteiro = {
  id: string;
  cliente_id: string;
  conteudo_id: string;
  estado: string;
  titulo: string | null;
  estrutura: Estrutura | null;
  pmids: string[];
  atualizado_em: string;
  deleted_at: string | null;
};
type BlocoPlano = { ordem: number; titulo: string; objetivo: string; minutos: number; pontos: string[]; pmids: string[] };
type Estrutura = { resumo: string; blocos: BlocoPlano[] };
type Referencia = { pmid: string; titulo: string; revista: string; ano: number | null; tipos: string[]; resumo: string; nota: string | null };

const REGRAS_CFM = `Regras da Resolução CFM 2.336/2023 (publicidade médica) que o texto tem de cumprir:
- conteúdo educativo; sem sensacionalismo, sem alarmismo e sem autopromoção exagerada;
- sem prometer resultado, cura ou "sucesso garantido"; sem "o melhor", "o único", "o mais moderno";
- sem preço, desconto, sorteio ou condição de pagamento;
- sem caso de paciente identificável e sem "antes e depois";
- sem diagnóstico ou prescrição para um caso individual: oriente procurar avaliação médica;
- sem desmerecer colegas, outras especialidades ou outros tratamentos.`;

const ESQUEMA_ESTRUTURA = {
  type: "object",
  properties: {
    titulo: { type: "string", description: "título do vídeo para o YouTube, até 70 caracteres, em português" },
    resumo: { type: "string", description: "2 a 3 frases para a descrição do YouTube" },
    blocos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ordem: { type: "integer" },
          titulo: { type: "string" },
          objetivo: { type: "string" },
          minutos: { type: "number" },
          pontos: { type: "array", items: { type: "string" } },
          pmids: { type: "array", items: { type: "string" } },
        },
        required: ["ordem", "titulo", "objetivo", "minutos", "pontos", "pmids"],
        additionalProperties: false,
      },
    },
  },
  required: ["titulo", "resumo", "blocos"],
  additionalProperties: false,
};

const SISTEMA_ESTRUTURA = `Você é roteirista de vídeos educativos de medicina para o YouTube, escrevendo para um médico brasileiro que vai aparecer como avatar digital (a imagem e a voz dele).
Monte a ESTRUTURA de um vídeo de cerca de 15 minutos (entre 14 e 16), falado em português do Brasil, com base nas referências escolhidas pelo médico.
Formato:
- de 6 a 8 blocos, nenhum com mais de 3 minutos; "minutos" de cada bloco somando entre 14 e 16;
- bloco 1 (cerca de 1 minuto): o GANCHO nos primeiros 15 segundos — confirma o que o título promete, abre uma pergunta que o espectador quer ver respondida e mostra que a resposta vem no vídeo — e logo a VIRADA: em uma frase, o que o vídeo vai fazer. Sem vinheta, sem "antes de começar", sem pedir inscrição no começo;
- blocos do meio: uma ideia por bloco, do mais importante para o detalhe, cada um apoiado nas referências (pmids);
- penúltimo bloco: a entrega prática — o que a pessoa leva do vídeo e quando procurar um médico;
- último bloco (cerca de 1 minuto): fechamento com a identificação do médico (nome, especialidade, CRM e RQE como estiverem no perfil), o aviso de que o vídeo não substitui uma consulta, e UM pedido só (por exemplo, a chamada final preferida).
- "pontos": de 2 a 5 tópicos curtos do que o bloco cobre; "pmids": os PMIDs (só da lista fornecida) em que o bloco se apoia.
O título: claro, honesto, sem sensacionalismo, até 70 caracteres.
${REGRAS_CFM}`;

const ESQUEMA_BLOCO = {
  type: "object",
  properties: {
    fala: { type: "string", description: "o texto falado do bloco, em parágrafos" },
    na_tela: { type: "string", description: "sugestões do que mostrar na tela, uma por linha" },
  },
  required: ["fala", "na_tela"],
  additionalProperties: false,
};

const SISTEMA_BLOCO = `Você escreve a FALA de um bloco de um vídeo educativo do YouTube, em português do Brasil, na primeira pessoa, como o próprio médico.
Quem vai falar é um avatar digital com a voz sintetizada do médico, então:
- escreva só o que é dito em voz alta: nada de títulos, listas, asteriscos, emojis, colchetes ou indicações de cena;
- frases curtas e médias, linguagem simples para leigos; explique termo técnico e sigla na primeira vez;
- números escritos do jeito que se falam quando ajudar ("trinta por cento", "dois mil e dezenove");
- cite os estudos de forma falada ("uma revisão sistemática publicada em dois mil e dezenove no American Journal of Sports Medicine mostrou que..."), sem PMID na fala;
- afirme só o que está nos resumos fornecidos ou é conhecimento médico consolidado; nunca invente número, estudo, autor ou porcentagem;
- continue naturalmente do bloco anterior: não repita saudação nem apresentação, não diga "neste bloco" nem "no próximo bloco";
- separe a fala em parágrafos (linha em branco entre eles).
Em "na_tela", sugira o que mostrar enquanto o médico fala (texto na tela, imagem, esquema, gráfico), uma sugestão por linha, citando o PMID quando mostrar dado de estudo.
${REGRAS_CFM}`;

function refsEmTexto(refs: Referencia[], comResumo: boolean): string {
  return refs.map((r) => {
    const cab = `PMID ${r.pmid} | ${rotuloEvidencia(r.tipos)} | ${r.ano ?? "s/ano"} | ${r.revista}\nTítulo: ${r.titulo}`;
    const nota = r.nota ? `\nAchado (nota da triagem): ${r.nota}` : "";
    return comResumo ? `${cab}${nota}\nResumo: ${r.resumo.slice(0, 1600)}` : `${cab}${nota}`;
  }).join("\n\n");
}

async function carregar(roteiroId: string) {
  const { data: r } = await admin.from("roteiros")
    .select("id, cliente_id, conteudo_id, estado, titulo, estrutura, pmids, atualizado_em, deleted_at")
    .eq("id", roteiroId).maybeSingle();
  if (!r || r.deleted_at) throw new Falha("Roteiro não encontrado.", 404);
  const roteiro = r as Roteiro;
  const [{ data: conteudo }, perfil, { data: refs }] = await Promise.all([
    admin.from("conteudos").select("assunto, orientacoes, sintese").eq("id", roteiro.conteudo_id).single(),
    carregarPerfil(roteiro.cliente_id),
    admin.from("referencias").select("pmid, titulo, revista, ano, tipos, resumo, nota")
      .eq("conteudo_id", roteiro.conteudo_id).in("pmid", roteiro.pmids.length ? roteiro.pmids : ["-"]).is("deleted_at", null),
  ]);
  return { roteiro, conteudo: conteudo as { assunto: string; orientacoes: string; sintese: string | null }, perfil, refs: (refs ?? []) as Referencia[] };
}

function contextoBase(c: { assunto: string; orientacoes: string; sintese: string | null }, perfil: Perfil | null): string {
  return `Perfil do médico:\n${perfilEmTexto(perfil)}\n\nAssunto do vídeo: ${c.assunto}\nOrientações do médico: ${c.orientacoes || "nenhuma"}\n\nSíntese da evidência (triagem):\n${c.sintese ?? "não há"}`;
}

/** Escreve um bloco (usado no passo normal e no "reescrever"). */
async function escreverBloco(p: {
  clienteId: string;
  base: string;
  titulo: string;
  estrutura: Estrutura;
  plano: BlocoPlano;
  anteriores: { ordem: number; fala: string }[];
  refs: Referencia[];
  instrucao?: string;
  textoAtual?: string;
}): Promise<{ fala: string; na_tela: string }> {
  const claude = await claudeDoCliente(p.clienteId, 115_000);
  const conhecidos = new Set(p.refs.map((r) => r.pmid));
  const doBloco = soPmidsConhecidos(p.plano.pmids, conhecidos);
  const refsBloco = doBloco.length ? p.refs.filter((r) => doBloco.includes(r.pmid)) : p.refs;
  const palavras = Math.round(p.plano.minutos * PALAVRAS_POR_MINUTO);
  const ultimo = p.plano.ordem === Math.max(...p.estrutura.blocos.map((b) => b.ordem));
  const mapa = p.estrutura.blocos.map((b) => `${b.ordem}. ${b.titulo} (${b.minutos} min) — ${b.objetivo}`).join("\n");
  const pedido = [
    p.base,
    `Título do vídeo: ${p.titulo}`,
    `Estrutura completa:\n${mapa}`,
    `ESCREVA AGORA O BLOCO ${p.plano.ordem}: "${p.plano.titulo}"\nObjetivo: ${p.plano.objetivo}\nPontos: ${p.plano.pontos.join("; ")}\nTamanho: cerca de ${palavras} palavras (${p.plano.minutos} minutos a ${PALAVRAS_POR_MINUTO} palavras por minuto), com 10% de folga para mais ou para menos.`,
    ultimo
      ? "Este é o ÚLTIMO bloco: feche com a identificação do médico exatamente como está no perfil (nome, especialidade, CRM, RQE — não invente o que estiver \"não informado\"), o aviso de que o vídeo não substitui uma consulta e um pedido só."
      : "",
    p.anteriores.length
      ? `Fala dos blocos anteriores (para dar continuidade):\n\n${p.anteriores.map((a) => `[bloco ${a.ordem}]\n${a.fala}`).join("\n\n")}`
      : "Este é o primeiro bloco: comece direto pelo gancho.",
    `Referências deste bloco:\n\n${refsEmTexto(refsBloco, true)}`,
    p.instrucao || p.textoAtual
      ? `REESCREVA o bloco. Texto atual:\n${p.textoAtual ?? ""}\n\nPedido do médico para a nova versão: ${p.instrucao || "melhore a clareza e o ritmo, mantendo o conteúdo"}`
      : "",
  ].filter(Boolean).join("\n\n");
  const r = await pedirJson<{ fala: string; na_tela: string }>(claude, {
    sistema: SISTEMA_BLOCO, pedido, esquema: ESQUEMA_BLOCO, esforco: "medium", maxTokens: 16000, timeoutMs: 110_000,
  });
  const fala = String(r.fala ?? "").trim();
  if (contarPalavras(fala) < 40) throw new Falha(`A IA devolveu o bloco ${p.plano.ordem} vazio ou curto demais. Tente de novo.`, 502);
  return { fala, na_tela: String(r.na_tela ?? "").trim() };
}

async function marcarErro(roteiroId: string, msg: string) {
  console.error("conteudos-roteiro", roteiroId, msg);
  await admin.from("roteiros").update({ estado: "erro", msg }).eq("id", roteiroId);
}

/** Um passo: a estrutura, ou o próximo bloco que falta. Depois dispara o
 *  seguinte. */
async function avancar(roteiroId: string): Promise<void> {
  try {
    const { roteiro, conteudo, perfil, refs } = await carregar(roteiroId);
    if (roteiro.estado === "pronto") return;
    if (!refs.length) throw new Falha("As referências deste roteiro não estão mais disponíveis. Escreva um roteiro novo.");
    const base = contextoBase(conteudo, perfil);

    if (!roteiro.estrutura) {
      const claude = await claudeDoCliente(roteiro.cliente_id, 110_000);
      const e = await pedirJson<{ titulo: string; resumo: string; blocos: BlocoPlano[] }>(claude, {
        sistema: SISTEMA_ESTRUTURA,
        pedido: `${base}\n\nReferências escolhidas pelo médico:\n\n${refsEmTexto(refs, false)}`,
        esquema: ESQUEMA_ESTRUTURA, esforco: "medium", maxTokens: 16000, timeoutMs: 100_000,
      });
      const conhecidos = new Set(refs.map((r) => r.pmid));
      const blocos = (e.blocos ?? []).slice(0, 10).map((b, i) => ({
        ordem: i + 1,
        titulo: String(b.titulo).slice(0, 120),
        objetivo: String(b.objetivo).slice(0, 400),
        minutos: Math.min(3, Math.max(0.5, Number(b.minutos) || 2)),
        pontos: (b.pontos ?? []).map(String).slice(0, 6),
        pmids: soPmidsConhecidos(b.pmids, conhecidos),
      }));
      if (blocos.length < 3) throw new Falha("A IA montou uma estrutura curta demais. Tente de novo.", 502);
      // grava só se ninguém gravou antes (dois trabalhadores: o segundo descarta)
      const { data: gravou } = await admin.from("roteiros").update({
        titulo: String(e.titulo).slice(0, 100), estrutura: { resumo: String(e.resumo), blocos }, estado: "escrevendo",
        msg: `Estrutura pronta: ${blocos.length} blocos. Escrevendo o bloco 1.`,
      }).eq("id", roteiro.id).is("estrutura", null).select("id");
      if (!gravou?.length) {
        console.warn(`conteudos-roteiro: estrutura repetida descartada (roteiro ${roteiro.id})`);
        return;
      }
    } else {
      const est = roteiro.estrutura;
      const { data: feitos } = await admin.from("roteiro_blocos").select("ordem, fala")
        .eq("roteiro_id", roteiro.id).order("ordem");
      const jaFeitos = new Set((feitos ?? []).map((b) => b.ordem as number));
      const plano = est.blocos.find((b) => !jaFeitos.has(b.ordem));
      if (!plano) {
        await admin.from("roteiros").update({ estado: "pronto", msg: null }).eq("id", roteiro.id);
        return;
      }
      const { fala, na_tela } = await escreverBloco({
        clienteId: roteiro.cliente_id, base, titulo: roteiro.titulo ?? conteudo.assunto, estrutura: est, plano,
        anteriores: (feitos ?? []).map((b) => ({ ordem: b.ordem as number, fala: b.fala as string })), refs,
      });
      const { error } = await admin.from("roteiro_blocos").insert({
        cliente_id: roteiro.cliente_id, roteiro_id: roteiro.id, ordem: plano.ordem, titulo: plano.titulo, fala, na_tela,
      });
      if (error?.code === VIOLACAO_UNICA) {
        console.warn(`conteudos-roteiro: bloco ${plano.ordem} repetido descartado (roteiro ${roteiro.id})`);
        return;
      }
      if (error) throw new Falha(`Não consegui gravar o bloco ${plano.ordem} (${error.message}).`, 500);
      const faltam = est.blocos.filter((b) => !jaFeitos.has(b.ordem) && b.ordem !== plano.ordem).length;
      await admin.from("roteiros").update(
        faltam ? { estado: "escrevendo", msg: `Bloco ${plano.ordem} de ${est.blocos.length} escrito.` } : { estado: "pronto", msg: null },
      ).eq("id", roteiro.id);
      if (!faltam) return;
    }
    // próximo passo, com relógio novo
    await chamarFuncaoInterna("conteudos-roteiro", { acao: "continuar", roteiro_id: roteiro.id });
  } catch (e) {
    const msg = e instanceof Falha ? e.message : `Erro inesperado: ${e instanceof Error ? e.message : String(e)}`;
    await marcarErro(roteiroId, `${msg} Clique em "Continuar" para retomar de onde parou.`);
  }
}

async function exigirRoteiro(eu: Usuario | null, roteiroId: unknown) {
  if (!ehUuid(roteiroId)) throw new Falha("Roteiro inválido.");
  const { data: r } = await admin.from("roteiros").select("id, cliente_id, conteudo_id, estado, estrutura, atualizado_em")
    .eq("id", roteiroId).is("deleted_at", null).maybeSingle();
  if (!r || (eu && !enxerga(eu, r.cliente_id))) throw new Falha("Roteiro não encontrado.", 404);
  return r as { id: string; cliente_id: string; conteudo_id: string; estado: string; estrutura: Estrutura | null; atualizado_em: string };
}

type Pedido = { acao?: string; conteudo_id?: string; roteiro_id?: string; bloco_id?: string; instrucao?: string; sobrescrever?: boolean };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") throw new Falha("Use POST.", 405);
    const interno = chamadaInterna(req);
    const eu = interno ? null : await quemPediu(req);
    const p = await corpoJson<Pedido>(req);

    if (p.acao === "novo" && eu) {
      if (!ehUuid(p.conteudo_id)) throw new Falha("Conteúdo inválido.");
      const { data: c } = await admin.from("conteudos").select("id, cliente_id").eq("id", p.conteudo_id).is("deleted_at", null).maybeSingle();
      if (!c || !enxerga(eu, c.cliente_id)) throw new Falha("Conteúdo não encontrado.", 404);
      if (!(await lerSegredo(c.cliente_id, "anthropic"))) {
        throw new Falha("Falta a chave da Anthropic (Claude). Coloque em Configurações → Chaves de API.", 412);
      }
      const { data: refs } = await admin.from("referencias").select("pmid")
        .eq("conteudo_id", c.id).eq("selecionada", true).is("deleted_at", null);
      if ((refs?.length ?? 0) < 3) throw new Falha("Marque pelo menos 3 referências antes de escrever o roteiro.", 412);
      const { data: ultima } = await admin.from("roteiros").select("versao").eq("conteudo_id", c.id)
        .order("versao", { ascending: false }).limit(1).maybeSingle();
      const { data: novo, error } = await admin.from("roteiros").insert({
        cliente_id: c.cliente_id, conteudo_id: c.id, versao: (ultima?.versao ?? 0) + 1, estado: "estrutura",
        pmids: refs!.map((r) => r.pmid), criado_por: eu.id, msg: "Planejando os blocos do vídeo.",
      }).select("id").single();
      if (error?.code === VIOLACAO_UNICA) throw new Falha("Já há um roteiro sendo escrito para este conteúdo. Espere ele terminar.", 409);
      if (error) throw new Falha(`Não consegui criar o roteiro (${error.message}).`, 500);
      emSegundoPlano(avancar(novo.id));
      return responder({ ok: true, roteiro_id: novo.id, mensagem: "Roteiro começou. Leva alguns minutos; pode sair da página." }, 202);
    }

    if (p.acao === "continuar") {
      const r = await exigirRoteiro(eu, p.roteiro_id);
      if (r.estado === "pronto") return responder({ ok: true, mensagem: "O roteiro já está pronto." });
      if (eu) {
        // pedido do médico: só retoma se parou de verdade (erro ou 3 min sem avanço)
        const parado = Date.now() - new Date(r.atualizado_em).getTime() > 3 * 60_000;
        if (r.estado !== "erro" && !parado) throw new Falha("O roteiro ainda está sendo escrito. Espere um pouco.", 409);
        const { error } = await admin.from("roteiros").update({ estado: r.estrutura ? "escrevendo" : "estrutura", msg: "Retomando." }).eq("id", r.id);
        if (error?.code === VIOLACAO_UNICA) throw new Falha("Já há outro roteiro sendo escrito para este conteúdo.", 409);
        if (error) throw new Falha(`Não consegui retomar (${error.message}).`, 500);
      }
      emSegundoPlano(avancar(r.id));
      return responder({ ok: true, mensagem: "Retomando." }, 202);
    }

    if (p.acao === "reescrever_bloco" && eu) {
      if (!ehUuid(p.bloco_id)) throw new Falha("Bloco inválido.");
      const { data: b } = await admin.from("roteiro_blocos").select("id, roteiro_id, cliente_id, ordem, fala, editado")
        .eq("id", p.bloco_id).maybeSingle();
      if (!b || !enxerga(eu, b.cliente_id)) throw new Falha("Bloco não encontrado.", 404);
      if (b.editado && !p.sobrescrever) {
        throw new Falha("Você editou este bloco. Confirme que quer trocar o seu texto pela nova versão da IA.", 409);
      }
      const { roteiro, conteudo, perfil, refs } = await carregar(b.roteiro_id);
      if (roteiro.estado !== "pronto") throw new Falha("Espere o roteiro terminar antes de reescrever um bloco.", 409);
      const plano = roteiro.estrutura?.blocos.find((x) => x.ordem === b.ordem);
      if (!plano) throw new Falha("Este bloco não está na estrutura do roteiro.", 409);
      const { data: anteriores } = await admin.from("roteiro_blocos").select("ordem, fala")
        .eq("roteiro_id", roteiro.id).lt("ordem", b.ordem).order("ordem");
      const novo = await escreverBloco({
        clienteId: roteiro.cliente_id, base: contextoBase(conteudo, perfil), titulo: roteiro.titulo ?? conteudo.assunto,
        estrutura: roteiro.estrutura!, plano, refs, anteriores: (anteriores ?? []) as { ordem: number; fala: string }[],
        instrucao: (p.instrucao ?? "").slice(0, 1000), textoAtual: b.fala,
      });
      const { error } = await admin.from("roteiro_blocos").update({ ...novo, editado: false }).eq("id", b.id);
      if (error) throw new Falha(`Não consegui gravar o bloco (${error.message}).`, 500);
      return responder({ ok: true, mensagem: `Bloco ${b.ordem} reescrito.` });
    }

    throw new Falha("Ação desconhecida.", 400);
  } catch (e) {
    return respostaDeErro(e);
  }
});
