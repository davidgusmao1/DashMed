// O "vendedor" do YouTube Seller (David, 12/11/26): a IA faz a triagem dos
// comentários (quem tem chance de virar consulta ou procedimento) e redige a
// resposta na voz do médico. Quem publica é ele (regra 4 e políticas da API
// do YouTube). Regras do CFM 2.336/2023 no prompt; telefone e endereço só os
// das configurações (conferido em problemaNaResposta).
import { admin, carregarPerfil, Falha, perfilEmTexto } from "./base.ts";
import { claudeDoCliente, pedirJson } from "./claude.ts";
import { garantirCodigo, LIMITE_RESPOSTA, problemaNaResposta } from "./texto.ts";

export type Config = {
  automatico: boolean;
  procedimentos: string[];
  telemedicina: string;
  porto_alegre: string;
  sao_paulo: string;
  telefone_estimativa: string;
  instrucoes: string;
  prob_minima: number;
  limite_diario: number;
};

const PADRAO: Config = {
  automatico: false,
  procedimentos: ["Prótese de quadril", "Videoartroscopia de quadril", "Cirurgia para osteonecrose", "Ácido hialurônico", "Hidrogel bioativo", "Plasma rico em plaquetas (PRP)", "Concentrado de células"],
  telemedicina: "", porto_alegre: "", sao_paulo: "", telefone_estimativa: "", instrucoes: "", prob_minima: 40, limite_diario: 40,
};

export async function carregarConfig(clienteId: string): Promise<Config> {
  const { data } = await admin.from("seller_config")
    .select("automatico, procedimentos, telemedicina, porto_alegre, sao_paulo, telefone_estimativa, instrucoes, prob_minima, limite_diario")
    .eq("cliente_id", clienteId).maybeSingle();
  return { ...PADRAO, ...(data ?? {}) } as Config;
}

/** Treinamento da IA (David, 12/11/26: "um botão escrito treinamento da IA,
 *  onde eu vou falar algumas coisas para treinar para que as próximas respostas
 *  sigam um determinado padrão"). Os ativos, do mais antigo ao mais novo; entram
 *  os 40 mais recentes, até ~8.000 caracteres (o mais recente vale mais). */
export async function carregarTreinos(clienteId: string): Promise<string> {
  const { data } = await admin.from("seller_treinos").select("texto, criado_em")
    .eq("cliente_id", clienteId).eq("ativo", true).order("criado_em", { ascending: false }).limit(40);
  const itens: string[] = [];
  let total = 0;
  for (const t of data ?? []) {
    const linha = `- (${new Date(t.criado_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}) ${String(t.texto).trim()}`;
    if (total + linha.length > 8000) break;
    itens.push(linha);
    total += linha.length;
  }
  return itens.reverse().join("\n");
}

function blocoTreino(treinos: string, para: "triagem" | "resposta"): string {
  if (!treinos) return "";
  return `\n\nTREINAMENTO DO MÉDICO (orientações que ele deu para ${para === "resposta" ? "as respostas" : "a triagem"}; siga sempre, sem quebrar as regras do CFM nem inventar telefone ou endereço; se duas orientações se contradizem, vale a mais recente; ${para === "triagem" ? "use só as que falam de quem é lead, de probabilidade, de procedimento ou de urgência" : "use as que falam de tom, conteúdo, oferta e formato"}):\n${treinos}`;
}

/** Os textos de onde a resposta pode tirar telefone e endereço. */
export function textosConfigurados(c: Config): string[] {
  return [c.telemedicina, c.porto_alegre, c.sao_paulo, c.telefone_estimativa].filter(Boolean);
}

export const CATEGORIAS = ["agendamento", "preco", "tratamento", "sintoma", "pos_operatorio", "duvida_geral", "elogio", "critica", "spam", "outro"] as const;

// ── triagem ─────────────────────────────────────────────────────────────
export type ParaTriar = { id: string; texto: string; autor_nome: string; video_titulo: string | null };
export type Avaliacao = { probabilidade: number; categoria: string; procedimentos: string[]; urgente: boolean; resumo: string };

function sistemaTriagem(c: Config, especialidade: string, treinos: string): string {
  return `Você faz a triagem dos comentários do canal do YouTube de um médico brasileiro (${especialidade || "especialidade não informada"}).
O objetivo é achar quem tem chance de marcar consulta ou fazer com ele um destes procedimentos: ${c.procedimentos.join("; ")}.
Para CADA comentário (identificado por c1, c2, ...), devolva:
- probabilidade, de 0 a 100, de a pessoa marcar consulta ou procedimento com este médico:
  80 a 100: pergunta como marcar, onde ele atende, quanto custa, ou pede atendimento;
  60 a 79: descreve o próprio problema (ou de um familiar) que combina com um dos procedimentos e pergunta sobre tratamento;
  40 a 59: pergunta sobre um dos procedimentos sem dizer que é para si;
  20 a 39: dúvida geral ou relato sem pedido;
  0 a 19: elogio, agradecimento, conversa, spam, propaganda, crítica sem pergunta;
- categoria: uma de ${CATEGORIAS.join(", ")};
- procedimentos: os da lista que o comentário menciona ou sugere, escritos exatamente como na lista (vazio se nenhum);
- urgente: true se o texto sugere algo que precisa de atendimento imediato (febre, vermelhidão ou secreção na ferida depois de cirurgia; dor súbita e muito forte; não consegue apoiar o pé depois de queda; perna inchada e dolorida ou falta de ar depois de cirurgia);
- resumo: até 20 palavras, em português, do que a pessoa quer.
Avalie só pelo texto; não invente. Comentário em outra língua: avalie igual.${blocoTreino(treinos, "triagem")}`;
}

export async function triar(clienteId: string, itens: ParaTriar[], c: Config): Promise<Map<string, Avaliacao>> {
  const [perfil, treinos] = await Promise.all([carregarPerfil(clienteId), carregarTreinos(clienteId)]);
  const claude = await claudeDoCliente(clienteId, 100_000);
  const esquema = {
    type: "object",
    properties: {
      avaliacoes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            probabilidade: { type: "integer" },
            categoria: { type: "string", enum: [...CATEGORIAS] },
            procedimentos: { type: "array", items: c.procedimentos.length ? { type: "string", enum: c.procedimentos } : { type: "string" } },
            urgente: { type: "boolean" },
            resumo: { type: "string" },
          },
          required: ["id", "probabilidade", "categoria", "procedimentos", "urgente", "resumo"],
          additionalProperties: false,
        },
      },
    },
    required: ["avaliacoes"],
    additionalProperties: false,
  };
  const pedido = itens.map((x, i) => `c${i + 1} | vídeo: ${x.video_titulo ?? "?"} | autor: ${x.autor_nome}\n${x.texto.slice(0, 1500)}`).join("\n\n");
  const r = await pedirJson<{ avaliacoes: (Avaliacao & { id: string })[] }>(claude, {
    sistema: sistemaTriagem(c, perfil?.especialidade ?? "", treinos), pedido: `COMENTÁRIOS:\n\n${pedido}`, esquema, esforco: "low", maxTokens: 16000, timeoutMs: 95_000,
  });
  const mapa = new Map<string, Avaliacao>();
  for (const a of r.avaliacoes ?? []) {
    const i = Number(String(a.id).replace(/\D/g, "")) - 1;
    const item = itens[i];
    if (!item) continue;
    mapa.set(item.id, {
      probabilidade: Math.max(0, Math.min(100, Math.round(Number(a.probabilidade) || 0))),
      categoria: (CATEGORIAS as readonly string[]).includes(a.categoria) ? a.categoria : "outro",
      procedimentos: (a.procedimentos ?? []).filter((p) => c.procedimentos.includes(p)),
      urgente: !!a.urgente,
      resumo: String(a.resumo ?? "").slice(0, 300),
    });
  }
  return mapa;
}

/** Vira lead quem passou da probabilidade mínima, quem pergunta de marcar ou
 *  de preço, e caso urgente (precisa de resposta de qualquer jeito). */
export function qualifica(a: Avaliacao, c: Config): boolean {
  return a.categoria !== "spam" && (a.probabilidade >= c.prob_minima || a.categoria === "agendamento" || a.categoria === "preco" || a.urgente);
}

// ── redação ─────────────────────────────────────────────────────────────
export type ParaRedigir = {
  id: string;
  texto: string;
  autor_nome: string;
  video_titulo: string | null;
  categoria: string | null;
  procedimentos: string[];
  urgente: boolean;
  resumo: string | null;
  codigo: string;
  lead_id: string | null;
};

const REGRAS_CFM = `Regras da Resolução CFM 2.336/2023 que toda resposta cumpre:
- pode dizer como marcar consulta (inclusive por telemedicina) e que o valor do procedimento é combinado antes do atendimento;
- não substitui a consulta: não diagnostica, não indica nem contraindica tratamento para o caso da pessoa, não dá prognóstico — diz que isso depende de avaliação;
- não promete nem insinua resultado ("vai ficar bom", "resolve", "garantido"); não usa "o melhor", "o único", "o mais moderno";
- não fala de preço; não compara com colegas nem desmerece outros tratamentos.`;

function sistemaResposta(c: Config, perfil: string, treinos: string): string {
  const opcao = (s: string) => (s.trim() ? s.trim() : "NÃO OFERECER");
  return `Você escreve respostas a comentários no canal do YouTube do médico abaixo, NA VOZ DELE (primeira pessoa), para ele revisar e publicar.

Perfil do médico:
${perfil}

Cada resposta:
- responde de verdade ao que a pessoa perguntou, em termos gerais e educativos, em português do Brasil, com cordialidade; chame a pessoa pelo nome só se o nome estiver claro;
- tem de 2 a 5 frases e no máximo ${LIMITE_RESPOSTA - 100} caracteres; sem hashtags, sem links, no máximo um emoji;
- se o comentário sugerir urgência, a PRIMEIRA frase orienta procurar atendimento de urgência agora;
- convida para uma avaliação oferecendo SÓ as opções configuradas abaixo, com telefone, cidade e endereço exatamente como estão escritos (nunca invente telefone, endereço, preço, prazo ou convênio); ofereça as que fazem sentido para a pessoa, não precisa listar todas;
- sempre que mandar a pessoa para um telefone ou WhatsApp, peça na mesma frase para ela dizer o código do comentário (ex.: "chame no WhatsApp (51) 0000-0000 e diga que veio do YouTube, código YT1234"); é assim que a equipe sabe de que comentário veio;
- quando sugerir a estimativa de custo de um tratamento, use o telefone de estimativa;
- elogio ou agradecimento sem pergunta: agradeça em uma ou duas frases, sem oferta;
- cada resposta é escrita para aquele comentário: não repita a mesma abertura nem o mesmo fechamento entre as respostas do lote.

Opções de atendimento configuradas:
- Consulta por telemedicina: ${opcao(c.telemedicina)}
- Consulta presencial em Porto Alegre: ${opcao(c.porto_alegre)}
- Consulta presencial em São Paulo: ${opcao(c.sao_paulo)}
- Estimativa de custo de tratamento (telefone): ${opcao(c.telefone_estimativa)}
${c.instrucoes.trim() ? `\nInstruções do médico: ${c.instrucoes.trim()}\n` : ""}
${REGRAS_CFM}${blocoTreino(treinos, "resposta")}`;
}

export type Redigido = { texto: string; problema: string | null };

export async function redigir(clienteId: string, itens: ParaRedigir[], c: Config, instrucao?: string): Promise<Map<string, Redigido>> {
  const [perfil, treinos] = await Promise.all([carregarPerfil(clienteId), carregarTreinos(clienteId)]);
  const claude = await claudeDoCliente(clienteId, 110_000);
  const esquema = {
    type: "object",
    properties: {
      respostas: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, texto: { type: "string" } },
          required: ["id", "texto"],
          additionalProperties: false,
        },
      },
    },
    required: ["respostas"],
    additionalProperties: false,
  };
  const pedido = itens.map((x, i) => [
    `c${i + 1} | código ${x.codigo} | vídeo: ${x.video_titulo ?? "?"} | autor: ${x.autor_nome}`,
    `triagem: ${x.categoria ?? "?"}${x.urgente ? " | URGENTE" : ""}${x.procedimentos.length ? ` | ${x.procedimentos.join(", ")}` : ""}${x.resumo ? ` | ${x.resumo}` : ""}`,
    `comentário: ${x.texto.slice(0, 2000)}`,
  ].join("\n")).join("\n\n");
  const r = await pedirJson<{ respostas: { id: string; texto: string }[] }>(claude, {
    sistema: sistemaResposta(c, perfilEmTexto(perfil), treinos),
    pedido: `${instrucao ? `Pedido do médico para esta versão: ${instrucao}\n\n` : ""}COMENTÁRIOS:\n\n${pedido}`,
    esquema, esforco: "medium", maxTokens: 16000, timeoutMs: 110_000,
  });
  const configurados = textosConfigurados(c);
  const mapa = new Map<string, Redigido>();
  for (const x of r.respostas ?? []) {
    const i = Number(String(x.id).replace(/\D/g, "")) - 1;
    const item = itens[i];
    if (!item) continue;
    const texto = garantirCodigo(String(x.texto ?? ""), item.codigo);
    mapa.set(item.id, { texto, problema: problemaNaResposta(texto, configurados) });
  }
  return mapa;
}

/** Grava o que a IA escreveu: sem problema vira rascunho; com problema fica
 *  "falhou" com o motivo e o texto, para o médico corrigir ou refazer. */
export async function gravarRedacao(itens: ParaRedigir[], mapa: Map<string, Redigido>): Promise<{ ok: number; problemas: number }> {
  let ok = 0;
  let problemas = 0;
  for (const it of itens) {
    const r = mapa.get(it.id);
    if (!r) {
      problemas++;
      await admin.from("yt_comentarios").update({ resposta: "falhou", resposta_msg: "A IA não escreveu esta resposta. Clique em \"Refazer\"." }).eq("id", it.id);
      continue;
    }
    if (r.problema) problemas++;
    else ok++;
    const { error } = await admin.from("yt_comentarios").update({
      rascunho: r.texto, rascunho_editado: false, resposta: r.problema ? "falhou" : "rascunho", resposta_msg: r.problema,
    }).eq("id", it.id);
    if (error) throw new Falha(`Não consegui gravar a resposta sugerida (${error.message}).`, 500);
  }
  return { ok, problemas };
}

/** Os comentários a redigir, com o código do lead de cada um. */
export async function paraRedigir(filtro: { clienteId: string; ids?: string[]; limite: number }): Promise<ParaRedigir[]> {
  let q = admin.from("yt_comentarios")
    .select("id, texto, autor_nome, video_titulo, categoria, procedimentos, urgente, resumo, lead_id")
    .eq("cliente_id", filtro.clienteId).is("deleted_at", null);
  q = filtro.ids ? q.in("id", filtro.ids) : q.eq("resposta", "redigir").order("probabilidade", { ascending: false }).order("publicado_em", { ascending: false });
  const { data } = await q.limit(filtro.limite);
  const linhas = data ?? [];
  const leadIds = [...new Set(linhas.map((l) => l.lead_id).filter(Boolean))] as string[];
  const { data: leads } = leadIds.length ? await admin.from("leads").select("id, codigo").in("id", leadIds) : { data: [] };
  const codigo = new Map((leads ?? []).map((l) => [l.id as string, l.codigo as string]));
  return linhas.map((l) => ({
    id: l.id, texto: l.texto, autor_nome: l.autor_nome, video_titulo: l.video_titulo, categoria: l.categoria,
    procedimentos: l.procedimentos ?? [], urgente: !!l.urgente, resumo: l.resumo, codigo: l.lead_id ? codigo.get(l.lead_id) ?? "" : "",
    lead_id: l.lead_id ?? null,
  }));
}
