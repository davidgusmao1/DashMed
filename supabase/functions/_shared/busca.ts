// Busca de comentários por frase (David, 15/11/26: "buscar comentário da
// semana passada que contenha pedido sobre prótese, sobre dor ... posso usar
// tempo, posso usar vários critérios. Mas tudo digitando ali").
//
// A IA só TRADUZ a frase em critérios; quem acha os comentários é
// buscar_comentarios() (0020), e a tela mostra cada critério para o médico
// conferir e tirar. As contas de data saem prontas no CALENDÁRIO (a IA só
// escolhe o intervalo), para "última quarta" não depender de aritmética da IA.
import { admin } from "./base.ts";
import { claudeDoCliente, pedirJson } from "./claude.ts";
import { CATEGORIAS, carregarConfig } from "./seller.ts";
import { calendarioDaBusca, type FiltroBusca, FUSO, LIMITES, limparFiltro, ORDENS, SITUACOES } from "./busca-regras.ts";

const SIM_NAO = ["indiferente", "sim", "nao"] as const;

function sistemaBusca(procedimentos: string[]): string {
  return `Você transforma o pedido de busca de um médico, escrito em português, em critérios para achar comentários do canal dele no YouTube.
Devolva só os critérios que o pedido pede; o que ele não mencionar fica vazio (sem filtro). Não invente critério.

DATAS (de, ate: AAAA-MM-DD, inclusive): use os intervalos já calculados no CALENDÁRIO; não faça contas de data.
"comentários de quarta" / "da última quarta" (sem falar de vídeo) = o dia daquela quarta. Sem data no pedido: de e ate vazios.

VÍDEO: o médico pode citar um vídeo pelo nome de uma série que ele grava (ex.: "minha última quarta", "a live de quarta" = o vídeo MAIS RECENTE do CATÁLOGO com "Quarta" no título), pelo assunto ("o vídeo da meia elástica") ou por "o último vídeo".
Quando a frase falar do vídeo ("do vídeo", "da live", "da minha quarta", "do último vídeo"), ponha em videos o id do CATÁLOGO e NÃO ponha data (os comentários de um vídeo chegam por dias).
Vídeo que não está no catálogo (mais antigo): ponha um trecho do título em video_titulo (ex.: "Quarta do Quadril #200").
Se der para ler das duas formas (dia ou vídeo), escolha a mais provável e explique em observacao como pedir a outra.

ASSUNTOS (grupos): cada assunto pedido vira um grupo. Em termos, ponha a palavra e as formas como as pessoas escrevem nos comentários: singular e plural, sem acento, erros comuns, sinônimos populares e o verbo (ex.: prótese → "prótese", "proteses", "protese", "artroplastia"; dor → "dor", "dores", "doendo", "dói", "doi", "doer", "dolorido", "doloroso"). A busca é por palavra inteira; para pegar todas as terminações ponha * no fim de um radical de 5 letras ou mais (ex.: "infiltr*", "mancand*"). Não use palavras de 1 letra nem palavras que aparecem em quase todo comentário (doutor, quadril sozinho só se o médico pedir).
Se o assunto for um destes procedimentos, ponha também o nome exato em procedimentos (a triagem marcou o procedimento em cada comentário): ${procedimentos.join("; ") || "(nenhum)"}.
"pedido sobre prótese", "quem perguntou de prótese", "que fale de prótese": tudo isso é assunto (grupo), não categoria.
todos: true quando os assuntos têm de estar juntos no mesmo comentário ("prótese E dor", "dor depois da prótese"); false quando basta um ("sobre prótese, sobre dor", "prótese ou dor").
sem: palavras de assuntos que o médico quer excluir ("que não fale de preço" → "preço", "preco", "valor", "custa", "quanto custa").

TIPO DE COMENTÁRIO (categorias, da triagem): use só quando o pedido for claramente pelo tipo: pediu para marcar/agendar = agendamento; perguntou preço/valor = preco; ${CATEGORIAS.join(", ")}.
urgente, lead (virou lead), conversa (continuação de uma conversa em que o médico já respondeu): "sim", "nao" ou "indiferente".
situacao (só se o pedido falar da resposta): fila = resposta esperando revisão; respondido; sem_resposta; ignorado.
PORCENTAGENS (0 a 100; -1 = sem limite): probabilidade (chance de virar paciente), consulta, cirurgia, socio (socioeconômica). "alta chance de cirurgia" = cirurgia_min 70; "quem quer consulta" = consulta_min 60; "socioeconômico alto" = socio_min 60; "baixo" = socio_max 39.
autor: trecho do nome de quem comentou, só se o pedido citar a pessoa.
ordem: recentes (padrão), antigos, probabilidade, consulta, cirurgia, socio, curtidas ("mais curtidos").
observacao: uma frase curta só quando você teve de escolher entre duas leituras; senão vazio.`;
}

/** A frase do médico → critérios. */
export async function interpretarBusca(clienteId: string, pedido: string, agora = new Date()): Promise<{ filtro: FiltroBusca; observacao: string | null }> {
  const [config, { data: videos }] = await Promise.all([
    carregarConfig(clienteId),
    admin.from("yt_videos").select("video_id, titulo, publicado_em").eq("cliente_id", clienteId).is("deleted_at", null)
      .order("publicado_em", { ascending: false, nullsFirst: false }).limit(80),
  ]);
  const catalogo = videos ?? [];
  const cal = calendarioDaBusca(agora);
  const linhasCatalogo = catalogo.map((v) => {
    const d = v.publicado_em ? new Date(v.publicado_em) : null;
    const dia = d ? `${new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "2-digit" }).format(d)} (${new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "long" }).format(d)})` : "?";
    return `${v.video_id} | ${dia} | ${String(v.titulo).slice(0, 120)}`;
  });
  const esquema = {
    type: "object",
    properties: {
      de: { type: "string" },
      ate: { type: "string" },
      grupos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            termos: { type: "array", items: { type: "string" } },
            procedimentos: { type: "array", items: config.procedimentos.length ? { type: "string", enum: config.procedimentos } : { type: "string" } },
          },
          required: ["termos", "procedimentos"],
          additionalProperties: false,
        },
      },
      todos: { type: "boolean" },
      sem: { type: "array", items: { type: "string" } },
      categorias: { type: "array", items: { type: "string", enum: [...CATEGORIAS] } },
      videos: { type: "array", items: { type: "string" } },
      video_titulo: { type: "string" },
      autor: { type: "string" },
      urgente: { type: "string", enum: [...SIM_NAO] },
      lead: { type: "string", enum: [...SIM_NAO] },
      conversa: { type: "string", enum: [...SIM_NAO] },
      situacao: { type: "array", items: { type: "string", enum: [...SITUACOES] } },
      ...Object.fromEntries(LIMITES.map((k) => [k, { type: "integer" }])),
      ordem: { type: "string", enum: [...ORDENS] },
      observacao: { type: "string" },
    },
    required: ["de", "ate", "grupos", "todos", "sem", "categorias", "videos", "video_titulo", "autor", "urgente", "lead", "conversa", "situacao", ...LIMITES, "ordem", "observacao"],
    additionalProperties: false,
  };
  const claude = await claudeDoCliente(clienteId, 45_000);
  const r = await pedirJson<Record<string, unknown>>(claude, {
    sistema: sistemaBusca(config.procedimentos),
    pedido: `CALENDÁRIO:\n${cal.texto}\n\nCATÁLOGO (vídeos do canal, do mais novo ao mais antigo; id | publicado em | título):\n${linhasCatalogo.join("\n") || "(vazio)"}\n\nPEDIDO DO MÉDICO: ${pedido}`,
    esquema, esforco: "low", maxTokens: 4000, timeoutMs: 40_000,
  });
  const obs = typeof r.observacao === "string" && r.observacao.trim() ? r.observacao.trim().slice(0, 300) : null;
  return { filtro: limparFiltro(r, config.procedimentos, new Set(catalogo.map((v) => v.video_id)), CATEGORIAS), observacao: obs };
}
