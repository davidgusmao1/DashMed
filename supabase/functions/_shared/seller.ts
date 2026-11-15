// O "vendedor" do YouTube Seller (David, 12/11/26): a IA faz a triagem dos
// comentários (quem tem chance de virar consulta ou procedimento) e redige a
// resposta na voz do médico. Quem publica é ele (regra 4 e políticas da API
// do YouTube). Regras do CFM 2.336/2023 no prompt; telefone e endereço só os
// das configurações (conferido em problemaNaResposta).
import { admin, carregarPerfil, Falha, perfilEmTexto } from "./base.ts";
import { claudeDoCliente, pedirJson } from "./claude.ts";
import { canalConectado, gastarCota, mensagensDaConversa, tokenDeAcesso } from "./youtube.ts";
import { editouDeVerdade, garantirCodigo, LIMITE_RESPOSTA, problemaNaResposta, type VideoCatalogo, videosParecidos } from "./texto.ts";

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
  return `\n\nTREINAMENTO DO MÉDICO (orientações que ele deu para ${para === "resposta" ? "as respostas" : "a triagem"}; siga sempre, sem quebrar as regras do CFM nem inventar telefone ou endereço; se duas orientações se contradizem, vale a mais recente; ${para === "triagem" ? "use só as que falam de quem é lead, de probabilidade, das porcentagens, de procedimento ou de urgência" : "use as que falam de tom, conteúdo, oferta e formato"}):\n${treinos}`;
}

/** Os textos de onde a resposta pode tirar telefone e endereço. */
export function textosConfigurados(c: Config): string[] {
  return [c.telemedicina, c.porto_alegre, c.sao_paulo, c.telefone_estimativa].filter(Boolean);
}

export const CATEGORIAS = ["agendamento", "preco", "tratamento", "sintoma", "pos_operatorio", "duvida_geral", "elogio", "critica", "spam", "outro"] as const;

// ── triagem ─────────────────────────────────────────────────────────────
export type ParaTriar = { id: string; texto: string; autor_nome: string; video_titulo: string | null };
/** As três porcentagens da 0019 (David, 15/11/26). socio null = o texto não dá base para estimar. */
export type Porcentagens = { consulta: number; cirurgia: number; socio: number | null; socio_motivo: string | null };
export type Avaliacao = { probabilidade: number; categoria: string; procedimentos: string[]; urgente: boolean; resumo: string } & Porcentagens;

/** Critérios das três porcentagens, iguais na triagem e no cálculo dos já
 *  triados (passo "estimar"). A socioeconômica é só para quem revisa: nunca
 *  entra no pedido da resposta, que é a mesma para todos (o Código de Ética
 *  Médica veda discriminar). */
function criteriosPorcentagens(c: Config): string {
  return `- consulta, de 0 a 100: chance de a pessoa marcar uma CONSULTA com este médico (telemedicina ou presencial):
  80 a 100: pergunta como marcar, onde ele atende, se atende por telemedicina, quanto custa a consulta, ou pede para ser avaliada;
  50 a 79: descreve o próprio problema (ou de um familiar) e quer saber o que fazer;
  20 a 49: dúvida geral sobre o assunto, sem dizer que é para si;
  0 a 19: elogio, agradecimento, conversa, spam, ou já se trata com outro médico e não pede avaliação;
- cirurgia, de 0 a 100: chance de a pessoa vir a fazer uma CIRURGIA com este médico (entre os procedimentos ${c.procedimentos.join("; ")}, os que são cirurgia). Não é indicação médica: é o que o texto sugere.
  70 a 100: diz que já tem indicação de cirurgia ou que quer operar, ou pergunta sobre a cirurgia (como é, recuperação, quando fazer) para si ou para um familiar;
  40 a 69: descreve um quadro que costuma chegar à cirurgia (artrose avançada, "osso com osso", vários tratamentos sem melhora, dor que já impede de andar ou dormir);
  10 a 39: problema que costuma se tratar sem cirurgia, ou procura justamente evitar a cirurgia;
  0 a 9: não fala de um problema seu, ou já operou e só comenta;
- socioeconomico, de 0 a 100: estimativa do nível socioeconômico de quem escreve, pela maneira como escreve e pelo que conta: vocabulário, ortografia, pontuação e organização do texto; plano de saúde ou convênio; pagar particular; depender do SUS ou dizer que não tem condições de pagar; profissão; viagens; morar fora do país.
  0 a 19 muito baixo; 20 a 39 baixo; 40 a 59 médio; 60 a 79 médio-alto; 80 a 100 alto.
  Erro de digitação de celular (letra trocada, falta de acento) não conta; conta o vocabulário e a construção do texto. Nunca use nome, apelido, cidade ou região, sotaque, religião, idade ou gênero presumidos.
  Se o texto for curto demais ou não der sinal nenhum (ex.: "obrigado doutor"), devolva -1;
- socio_motivo: até 10 palavras com os sinais que você usou (ex.: "escrita formal; tem convênio"; "diz que aguarda na fila do SUS"); vazio quando socioeconomico for -1.`;
}

const PROPRIEDADES_PCT = {
  consulta: { type: "integer" },
  cirurgia: { type: "integer" },
  socioeconomico: { type: "integer" },
  socio_motivo: { type: "string" },
} as const;
const CAMPOS_PCT = ["consulta", "cirurgia", "socioeconomico", "socio_motivo"];
type PctDaIa = { consulta?: unknown; cirurgia?: unknown; socioeconomico?: unknown; socio_motivo?: unknown };

const pct = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

function lerPorcentagens(a: PctDaIa): Porcentagens {
  const s = Math.round(Number(a.socioeconomico));
  const semBase = !Number.isFinite(s) || s < 0;
  return {
    consulta: pct(a.consulta),
    cirurgia: pct(a.cirurgia),
    socio: semBase ? null : Math.min(100, s),
    socio_motivo: semBase ? null : String(a.socio_motivo ?? "").trim().slice(0, 120) || null,
  };
}

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
- resumo: até 20 palavras, em português, do que a pessoa quer;
${criteriosPorcentagens(c)}
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
            ...PROPRIEDADES_PCT,
          },
          required: ["id", "probabilidade", "categoria", "procedimentos", "urgente", "resumo", ...CAMPOS_PCT],
          additionalProperties: false,
        },
      },
    },
    required: ["avaliacoes"],
    additionalProperties: false,
  };
  const pedido = itens.map((x, i) => `c${i + 1} | vídeo: ${x.video_titulo ?? "?"} | autor: ${x.autor_nome}\n${x.texto.slice(0, 1500)}`).join("\n\n");
  const r = await pedirJson<{ avaliacoes: (Omit<Avaliacao, keyof Porcentagens> & PctDaIa & { id: string })[] }>(claude, {
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
      ...lerPorcentagens(a),
    });
  }
  return mapa;
}

/** As três porcentagens para comentários triados antes da 0019 (passo
 *  "estimar" da varredura). Não muda a triagem: probabilidade, lead e fila
 *  ficam como estão. Sem o nome de quem escreveu: não entra na estimativa. */
export async function estimarPorcentagens(clienteId: string, itens: ParaTriar[], c: Config): Promise<Map<string, Porcentagens>> {
  const [perfil, treinos] = await Promise.all([carregarPerfil(clienteId), carregarTreinos(clienteId)]);
  const claude = await claudeDoCliente(clienteId, 100_000);
  const esquema = {
    type: "object",
    properties: {
      avaliacoes: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, ...PROPRIEDADES_PCT },
          required: ["id", ...CAMPOS_PCT],
          additionalProperties: false,
        },
      },
    },
    required: ["avaliacoes"],
    additionalProperties: false,
  };
  const sistema = `Você avalia comentários do canal do YouTube de um médico brasileiro (${perfil?.especialidade || "especialidade não informada"}).
Para CADA comentário (identificado por c1, c2, ...), devolva:
${criteriosPorcentagens(c)}
Avalie só pelo texto; não invente. Comentário em outra língua: avalie igual.${blocoTreino(treinos, "triagem")}`;
  const pedido = itens.map((x, i) => `c${i + 1} | vídeo: ${x.video_titulo ?? "?"}\n${x.texto.slice(0, 1500)}`).join("\n\n");
  const r = await pedirJson<{ avaliacoes: (PctDaIa & { id: string })[] }>(claude, {
    sistema, pedido: `COMENTÁRIOS:\n\n${pedido}`, esquema, esforco: "low", maxTokens: 12000, timeoutMs: 95_000,
  });
  const mapa = new Map<string, Porcentagens>();
  for (const a of r.avaliacoes ?? []) {
    const item = itens[Number(String(a.id).replace(/\D/g, "")) - 1];
    if (item) mapa.set(item.id, lerPorcentagens(a));
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
  /** continuação de conversa: a linha de topo e a conversa até aqui */
  conversa_de: string | null;
  conversa: string | null;
  /** vídeos do canal que podem responder à dúvida (pré-seleção de videosParecidos) */
  videos: VideoCatalogo[];
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
- sempre que mandar a pessoa para um telefone ou WhatsApp, peça na mesma frase para ela dizer o código do comentário (ex.: "chame no WhatsApp (51) 0000-0000 e diga que veio do YouTube, código YT1234"); é assim que a equipe sabe de que comentário veio; item SEM CÓDIGO: nunca escreva código nenhum (nem o do exemplo);
- quando sugerir a estimativa de custo de um tratamento, use o telefone de estimativa;
- elogio ou agradecimento sem pergunta: agradeça em uma ou duas frases, sem oferta;
- cada resposta é escrita para aquele comentário: não repita a mesma abertura nem o mesmo fechamento entre as respostas do lote;
- quando o item trouxer VÍDEOS DO CANAL e um deles responder bem à dúvida da pessoa, indique UM, pelo título entre aspas, numa frase curta (ex.: 'Tenho um vídeo no canal sobre isso: "Título"'); encurte o título tirando o nome do médico, emojis e número de episódio; nunca ponha link; se nenhum servir de verdade, não indique (video = 0). Em continuação de conversa, só indique se a pessoa pediu mais informação;
- quando o item trouxer CONVERSA ATÉ AQUI, é a continuação de uma conversa em que você já respondeu: responda só à NOVA MENSAGEM, sem se apresentar de novo e sem repetir a oferta inteira; retome só o que a pessoa pediu agora (por exemplo, o telefone de orçamento com o código).

Opções de atendimento configuradas:
- Consulta por telemedicina: ${opcao(c.telemedicina)}
- Consulta presencial em Porto Alegre: ${opcao(c.porto_alegre)}
- Consulta presencial em São Paulo: ${opcao(c.sao_paulo)}
- Estimativa de custo de tratamento (telefone): ${opcao(c.telefone_estimativa)}
${c.instrucoes.trim() ? `\nInstruções do médico: ${c.instrucoes.trim()}\n` : ""}
${REGRAS_CFM}${blocoTreino(treinos, "resposta")}`;
}

export type Redigido = { texto: string; problema: string | null; video_id: string | null };

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
          // video: o número do vídeo indicado na lista do item (0 = nenhum)
          properties: { id: { type: "string" }, texto: { type: "string" }, video: { type: "integer" } },
          required: ["id", "texto", "video"],
          additionalProperties: false,
        },
      },
    },
    required: ["respostas"],
    additionalProperties: false,
  };
  const pedido = itens.map((x, i) => [
    // sem lead não há código (resposta pedida na busca, 15/11/26): sem isso a
    // IA copiava o código do exemplo do prompt
    `c${i + 1} | ${x.codigo ? `código ${x.codigo}` : "SEM CÓDIGO (não peça código; se indicar telefone ou WhatsApp, peça para dizer que veio do YouTube)"} | vídeo: ${x.video_titulo ?? "?"} | autor: ${x.autor_nome}`,
    `triagem: ${x.categoria ?? "?"}${x.urgente ? " | URGENTE" : ""}${x.procedimentos.length ? ` | ${x.procedimentos.join(", ")}` : ""}${x.resumo ? ` | ${x.resumo}` : ""}`,
    x.conversa ? `CONVERSA ATÉ AQUI:\n${x.conversa}\nNOVA MENSAGEM (responda a esta): ${x.texto.slice(0, 2000)}` : `comentário: ${x.texto.slice(0, 2000)}`,
    x.videos.length ? `VÍDEOS DO CANAL: ${x.videos.map((v, j) => `${j + 1}) "${v.titulo}"`).join(" | ")}` : null,
  ].filter(Boolean).join("\n")).join("\n\n");
  const r = await pedirJson<{ respostas: { id: string; texto: string; video?: number }[] }>(claude, {
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
    const video = item.videos[Number(x.video ?? 0) - 1] ?? null;
    mapa.set(item.id, { texto, problema: problemaNaResposta(texto, configurados), video_id: video?.video_id ?? null });
  }
  return mapa;
}

/** Os estados em que um comentário ainda pode ganhar resposta (o que não foi
 *  publicado nem está sendo). Da busca, o médico responde qualquer um deles
 *  (David, 15/11/26: "responder embaixo dos comentários buscados"). */
export const ESTADOS_RESPONDIVEIS = ["nenhuma", "redigir", "rascunho", "falhou", "ignorada"];

/** Grava o que a IA escreveu: sem problema vira rascunho; com problema fica
 *  "falhou" com o motivo e o texto, para o médico corrigir ou refazer.
 *  Só grava se o comentário ainda está num dos `estados`: se o médico
 *  publicou ou mexeu enquanto a IA escrevia, o robô não passa por cima (regra 4). */
export async function gravarRedacao(itens: ParaRedigir[], mapa: Map<string, Redigido>, estados = ESTADOS_RESPONDIVEIS): Promise<{ ok: number; problemas: number; pulados: number }> {
  let ok = 0;
  let problemas = 0;
  let pulados = 0;
  for (const it of itens) {
    const r = mapa.get(it.id);
    if (!r) {
      problemas++;
      await admin.from("yt_comentarios").update({ resposta: "falhou", resposta_msg: "A IA não escreveu esta resposta. Clique em \"Refazer\"." })
        .eq("id", it.id).in("resposta", estados);
      continue;
    }
    const { data, error } = await admin.from("yt_comentarios").update({
      // sugestao_ia guarda o que a IA escreveu, para comparar com o que o
      // médico publicar (aprender com as edições, 0012)
      rascunho: r.texto, sugestao_ia: r.texto, rascunho_editado: false, resposta: r.problema ? "falhou" : "rascunho", resposta_msg: r.problema,
      // texto novo da IA: ainda não foi revisado (sai a barra verde, 0021)
      video_sugerido: r.video_id, revisada_em: null,
    }).eq("id", it.id).in("resposta", estados).select("id");
    if (error) throw new Falha(`Não consegui gravar a resposta sugerida (${error.message}).`, 500);
    if (!data?.length) pulados++;
    else if (r.problema) problemas++;
    else ok++;
  }
  return { ok, problemas, pulados };
}

/** Os comentários a redigir, com o código do lead de cada um. */
export async function paraRedigir(filtro: { clienteId: string; ids?: string[]; limite: number }): Promise<ParaRedigir[]> {
  let q = admin.from("yt_comentarios")
    .select("id, texto, autor_nome, video_id, video_titulo, categoria, procedimentos, urgente, resumo, lead_id, conversa_de, comentario_id, publicado_em")
    .eq("cliente_id", filtro.clienteId).is("deleted_at", null);
  q = filtro.ids ? q.in("id", filtro.ids) : q.eq("resposta", "redigir").order("probabilidade", { ascending: false }).order("publicado_em", { ascending: false });
  const { data } = await q.limit(filtro.limite);
  const linhas = data ?? [];
  const leadIds = [...new Set(linhas.map((l) => l.lead_id).filter(Boolean))] as string[];
  const { data: leads } = leadIds.length ? await admin.from("leads").select("id, codigo").in("id", leadIds) : { data: [] };
  const codigo = new Map((leads ?? []).map((l) => [l.id as string, l.codigo as string]));
  // catálogo de vídeos do canal (0017), para a resposta poder indicar um
  const { data: catalogo } = linhas.length
    ? await admin.from("yt_videos").select("video_id, titulo, descricao").eq("cliente_id", filtro.clienteId).is("deleted_at", null).limit(1000)
    : { data: [] };
  // continuação de conversa: a conversa até a mensagem, lida no YouTube na hora
  // (fonte da verdade: inclui o que o médico respondeu direto no YouTube)
  const conversas = new Map<string, string>();
  const deConversa = linhas.filter((l) => l.conversa_de);
  if (deConversa.length) {
    const [canal, token] = await Promise.all([canalConectado(filtro.clienteId), tokenDeAcesso(filtro.clienteId)]);
    const { data: topos } = await admin.from("yt_comentarios").select("id, texto, autor_nome").in("id", deConversa.map((l) => l.conversa_de as string));
    const topo = new Map((topos ?? []).map((t) => [t.id as string, t]));
    for (const l of deConversa) {
      await gastarCota(filtro.clienteId, 1);
      const msgs = await mensagensDaConversa(token, l.comentario_id);
      const t = topo.get(l.conversa_de as string);
      const linhasConversa = [
        t ? `[${t.autor_nome}] ${String(t.texto).slice(0, 800)}` : null,
        ...msgs.filter((m) => m.publicado_em < l.publicado_em)
          .map((m) => `[${m.autor_canal_id === canal.canal_id ? "você (canal)" : m.autor_nome}] ${m.texto.slice(0, 800)}`),
      ].filter(Boolean) as string[];
      conversas.set(l.id, linhasConversa.join("\n").slice(-3500));
    }
  }
  return linhas.map((l) => ({
    id: l.id, texto: l.texto, autor_nome: l.autor_nome, video_titulo: l.video_titulo, categoria: l.categoria,
    procedimentos: l.procedimentos ?? [], urgente: !!l.urgente, resumo: l.resumo, codigo: l.lead_id ? codigo.get(l.lead_id) ?? "" : "",
    lead_id: l.lead_id ?? null, conversa_de: l.conversa_de ?? null, conversa: conversas.get(l.id) ?? null,
    videos: videosParecidos([l.texto, l.resumo ?? "", ...(l.procedimentos ?? [])].join(" "), (catalogo ?? []) as VideoCatalogo[], l.video_id),
  }));
}

// ── aprender com as edições (David, 14/11/26) ───────────────────────────
// A IA compara o que ela sugeriu com o que o médico publicou depois de editar,
// procura PADRÕES e propõe regras. Nada vira treinamento sem ele aprovar.
export type Proposta = { texto: string; motivo: string; exemplos: { comentario: string; sugestao: string; publicado: string }[] };

const SISTEMA_APRENDER = `Você ajuda a IA que escreve as respostas do canal do YouTube de um médico a aprender o jeito dele.
Para cada caso (c1, c2, ...) você recebe o comentário, a resposta que a IA sugeriu e a resposta que o médico PUBLICOU depois de editar.
Encontre PADRÕES nas edições — o que ele acrescenta, corta ou troca, o tom, o tamanho, a ordem, o que oferece ou deixa de oferecer, palavras que evita — e transforme em regras gerais para as próximas respostas.
- De 0 a 5 regras. Cada regra é uma instrução curta e direta, no imperativo, que sirva para qualquer comentário parecido, não só para aquele caso.
- Prefira o que se repete em mais de um caso; uma edição isolada só vira regra se for claramente uma preferência geral (por exemplo, nunca usar certa palavra).
- Ignore correção de digitação e ajustes que só valem para aquele caso (um fato da pessoa, um nome).
- Não repita o que já está nos treinamentos ativos (lista abaixo). Se as edições contradizem um treinamento ativo, proponha a regra nova e diga no motivo qual ela substitui.
- Nunca proponha regra que quebre as regras do CFM (prometer resultado, falar de preço, diagnosticar pelo comentário, desmerecer colegas) ou que traga telefone, endereço ou preço.
- motivo: o que você viu nas edições, em uma frase. casos: os identificadores (c1, c2...) que mostram o padrão.
Se não houver padrão claro, devolva a lista vazia.`;

const ESQUEMA_APRENDER = {
  type: "object",
  properties: {
    regras: {
      type: "array",
      items: {
        type: "object",
        properties: { texto: { type: "string" }, motivo: { type: "string" }, casos: { type: "array", items: { type: "string" } } },
        required: ["texto", "motivo", "casos"],
        additionalProperties: false,
      },
    },
  },
  required: ["regras"],
  additionalProperties: false,
};

/** Analisa as edições novas (e algumas já vistas, para dar contexto), marca as
 *  novas como analisadas e devolve as regras propostas. */
export async function aprenderComEdicoes(clienteId: string): Promise<{ propostas: Proposta[]; analisadas: number }> {
  const { data } = await admin.from("yt_comentarios")
    .select("id, texto, sugestao_ia, rascunho, aprendido_em, publicada_em")
    .eq("cliente_id", clienteId).eq("resposta", "publicada").is("deleted_at", null).not("sugestao_ia", "is", null)
    .order("publicada_em", { ascending: false }).limit(60);
  const editadas = (data ?? []).filter((c) => editouDeVerdade(c.sugestao_ia, c.rascunho));
  const novas = editadas.filter((c) => !c.aprendido_em).slice(0, 20);
  if (!novas.length) throw new Falha("Não há edições novas para analisar. Edite e publique algumas respostas e volte aqui.", 409);
  // até 10 já analisadas entram como contexto: padrão que se repete ao longo do tempo
  const contexto = editadas.filter((c) => c.aprendido_em).slice(0, 10);
  const casos = [...novas, ...contexto];
  const treinos = await carregarTreinos(clienteId);
  const pedido = casos.map((c, i) => [
    `c${i + 1}`,
    `COMENTÁRIO: ${String(c.texto).slice(0, 800)}`,
    `SUGESTÃO DA IA: ${c.sugestao_ia}`,
    `PUBLICADO PELO MÉDICO: ${c.rascunho}`,
  ].join("\n")).join("\n\n");
  const claude = await claudeDoCliente(clienteId, 110_000);
  const r = await pedirJson<{ regras: { texto: string; motivo: string; casos: string[] }[] }>(claude, {
    sistema: SISTEMA_APRENDER,
    pedido: `TREINAMENTOS ATIVOS:\n${treinos || "(nenhum)"}\n\nCASOS:\n\n${pedido}`,
    esquema: ESQUEMA_APRENDER, esforco: "medium", maxTokens: 16000, timeoutMs: 105_000,
  });
  const agora = new Date().toISOString();
  const { error } = await admin.from("yt_comentarios").update({ aprendido_em: agora }).in("id", novas.map((c) => c.id));
  if (error) throw new Falha(`Analisei, mas não consegui marcar as edições como vistas (${error.message}).`, 500);
  const propostas = (r.regras ?? []).slice(0, 5).map((regra) => ({
    texto: String(regra.texto).trim().slice(0, 600),
    motivo: String(regra.motivo).trim().slice(0, 400),
    exemplos: (regra.casos ?? []).map((id) => casos[Number(String(id).replace(/\D/g, "")) - 1]).filter(Boolean).slice(0, 2)
      .map((c) => ({ comentario: String(c.texto).slice(0, 300), sugestao: c.sugestao_ia as string, publicado: c.rascunho as string })),
  })).filter((p) => p.texto.length >= 3);
  return { propostas, analisadas: novas.length };
}

// ---------------------------------------------------------------------------
// Pautas (David, 14/11/26: "perguntas frequentes viram pautas de conteúdo"):
// a IA agrupa as perguntas dos comentários em temas de vídeo; o médico escolhe
// quais viram conteúdo. Ficam em yt_pautas (0015).

// categorias em que a pessoa pergunta algo que um vídeo pode responder
const CATEGORIAS_PAUTA = ["duvida_geral", "sintoma", "tratamento", "pos_operatorio", "agendamento", "preco"];
const MAX_COMENTARIOS_PAUTA = 220;

const SISTEMA_PAUTAS = `Você ajuda um médico ortopedista (quadril) a decidir os próximos vídeos do canal dele no YouTube.
Você recebe comentários reais do canal (q1, q2, ...), com as curtidas de cada um, e a lista de conteúdos que ele já fez ou já tem como pauta.
Agrupe as PERGUNTAS e dúvidas que se repetem em temas de vídeo:
- De 3 a 8 pautas, da que mais gente pergunta para a que menos. Só vira pauta o que aparece em mais de um comentário (ou num comentário com muitas curtidas).
- titulo: o assunto do vídeo, claro e específico, como o público pergunta (ex.: "Quanto tempo depois da prótese de quadril posso dirigir?"). Até 120 caracteres. Sem promessa de resultado, sem preço.
- porque: em uma ou duas frases, o que as pessoas querem saber e o que o vídeo precisa responder.
- procedimento: o procedimento principal envolvido, se houver (ex.: "Prótese de quadril"); vazio se for geral.
- comentarios: TODOS os identificadores (q1, q2...) que pedem este tema, os mais representativos primeiro.
- Não repita tema que já está na lista de conteúdos e pautas existentes; um ângulo realmente diferente pode.
- Ignore pedido de consulta sem dúvida nenhuma, elogio e reclamação.`;

const ESQUEMA_PAUTAS = {
  type: "object",
  properties: {
    pautas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          titulo: { type: "string" }, porque: { type: "string" }, procedimento: { type: "string" },
          comentarios: { type: "array", items: { type: "string" } },
        },
        required: ["titulo", "porque", "procedimento", "comentarios"],
        additionalProperties: false,
      },
    },
  },
  required: ["pautas"],
  additionalProperties: false,
};

export async function acharPautas(clienteId: string): Promise<{ pautas: number; analisados: number }> {
  const { data } = await admin.from("yt_comentarios")
    .select("id, texto, curtidas, procedimentos")
    .eq("cliente_id", clienteId).eq("triagem", "feita").is("deleted_at", null)
    .in("categoria", CATEGORIAS_PAUTA)
    .order("publicado_em", { ascending: false }).limit(MAX_COMENTARIOS_PAUTA);
  const comentarios = (data ?? []).filter((c) => String(c.texto).trim().length >= 15);
  if (comentarios.length < 5) throw new Falha("Ainda há poucas perguntas triadas para achar pautas. Rode mais varreduras e volte aqui.", 409);

  // o que já existe: conteúdos feitos e pautas que já viraram conteúdo
  const [{ data: conteudos }, { data: usadas }] = await Promise.all([
    admin.from("conteudos").select("assunto").eq("cliente_id", clienteId).is("deleted_at", null).order("criado_em", { ascending: false }).limit(60),
    admin.from("yt_pautas").select("titulo").eq("cliente_id", clienteId).is("deleted_at", null).not("conteudo_id", "is", null).limit(60),
  ]);
  const existentes = [...(conteudos ?? []).map((c) => c.assunto), ...(usadas ?? []).map((p) => p.titulo)];

  const pedido = comentarios.map((c, i) => `q${i + 1} (${c.curtidas ?? 0} curtida(s)): ${String(c.texto).replace(/\s+/g, " ").slice(0, 400)}`).join("\n");
  const claude = await claudeDoCliente(clienteId, 110_000);
  const r = await pedirJson<{ pautas: { titulo: string; porque: string; procedimento: string; comentarios: string[] }[] }>(claude, {
    sistema: SISTEMA_PAUTAS,
    pedido: `CONTEÚDOS E PAUTAS QUE JÁ EXISTEM:\n${existentes.length ? existentes.map((t) => `- ${t}`).join("\n") : "(nenhum)"}\n\nCOMENTÁRIOS:\n${pedido}`,
    esquema: ESQUEMA_PAUTAS, esforco: "medium", maxTokens: 12000, timeoutMs: 105_000,
  });

  const linhas = (r.pautas ?? []).slice(0, 8).map((p) => {
    const ids = [...new Set((p.comentarios ?? []).map((q) => Number(String(q).replace(/\D/g, "")) - 1))]
      .filter((i) => i >= 0 && i < comentarios.length);
    return {
      cliente_id: clienteId,
      titulo: String(p.titulo).trim().slice(0, 300),
      porque: String(p.porque).trim().slice(0, 1000),
      procedimento: String(p.procedimento ?? "").trim().slice(0, 120) || null,
      comentarios: ids.length,
      exemplos: ids.slice(0, 3).map((i) => ({ id: comentarios[i].id, texto: String(comentarios[i].texto).slice(0, 400) })),
    };
  }).filter((p) => p.titulo.length >= 3 && p.comentarios > 0);
  if (!linhas.length) throw new Falha("A IA não achou perguntas que se repetem o bastante para virar pauta. Tente de novo depois de mais varreduras.", 409);

  // só depois de a IA responder: arquiva as pautas antigas que não viraram conteúdo
  const { error: e1 } = await admin.from("yt_pautas").update({ deleted_at: new Date().toISOString() })
    .eq("cliente_id", clienteId).is("deleted_at", null).is("conteudo_id", null);
  if (e1) throw new Falha(`Não consegui arquivar as pautas antigas (${e1.message}).`, 500);
  const { error: e2 } = await admin.from("yt_pautas").insert(linhas);
  if (e2) throw new Falha(`A IA achou as pautas, mas não consegui gravar (${e2.message}).`, 500);
  return { pautas: linhas.length, analisados: comentarios.length };
}
