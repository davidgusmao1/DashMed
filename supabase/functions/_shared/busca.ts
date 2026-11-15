// Busca de comentários por frase (David, 15/11/26: "buscar comentário da
// semana passada que contenha pedido sobre prótese, sobre dor ... posso usar
// tempo, posso usar vários critérios. Mas tudo digitando ali").
//
// A IA só TRADUZ a frase em critérios; quem acha os comentários é
// buscar_comentarios() (0020), e a tela mostra cada critério para o médico
// conferir e tirar. As contas de data saem prontas no CALENDÁRIO (a IA só
// escolhe o intervalo), para "última quarta" não depender de aritmética da IA.
import { admin, Falha } from "./base.ts";
import { claudeDoCliente, pedirJson } from "./claude.ts";
import { gravarLidos } from "./leitura.ts";
import { CATEGORIAS, carregarConfig } from "./seller.ts";
import { calendarioDaBusca, type FiltroBusca, FUSO, LIMITES, limparFiltro, ORDENS, planoNoYoutube, SITUACOES } from "./busca-regras.ts";
import { canalConectado, type ComentarioLido, gastarCota, lerPagina, tokenDeAcesso } from "./youtube.ts";

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

// ── busca direto no YouTube (15/11/26: "a minha intenção é que ela busque
// comentários do YouTube") ───────────────────────────────────────────────
// Pergunta ao YouTube na hora (palavras, vídeo, período), grava no DashMed o
// que ainda não estava (como a varredura grava: sem o próprio canal e sem quem
// pediu para ser anonimizado) e a tela mostra a busca no banco, que agora tem
// tudo. O que veio novo fica "aguardando triagem" até a próxima varredura.
// Tetos (cota e relógio da edge), sempre avisados na tela.
const MAX_UNIDADES_BUSCA = 120;
const TEMPO_BUSCA_MS = 60_000;
const SIMULTANEAS = 4;

export type ResumoYoutube = { achados: number; novos: number; paginas: number; limite: string[]; aviso: string | null };

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export async function buscarNoYoutube(clienteId: string, f: Record<string, unknown>): Promise<ResumoYoutube> {
  const plano = planoNoYoutube(f);
  const avisos: string[] = [];
  if (plano.cortados) avisos.push(`No YouTube busquei as ${plano.termos.length} primeiras palavras (ficaram ${plano.cortados} de fora).`);

  // vídeos: os do catálogo citados e os que batem com o trecho de título
  const videos: { id: string; titulo: string }[] = [];
  const ids = (Array.isArray(f.videos) ? f.videos : []).map(String).slice(0, 10);
  if (ids.length) {
    const { data } = await admin.from("yt_videos").select("video_id, titulo").eq("cliente_id", clienteId).in("video_id", ids).is("deleted_at", null);
    for (const v of data ?? []) videos.push({ id: v.video_id, titulo: v.titulo });
  }
  const trecho = typeof f.video_titulo === "string" ? semAcento(f.video_titulo).trim() : "";
  if (trecho) {
    const { data } = await admin.from("yt_videos").select("video_id, titulo").eq("cliente_id", clienteId).is("deleted_at", null)
      .order("publicado_em", { ascending: false, nullsFirst: false }).limit(5000);
    const batem = (data ?? []).filter((v) => semAcento(String(v.titulo)).includes(trecho) && !videos.some((x) => x.id === v.video_id));
    if (batem.length > 5) avisos.push(`O trecho de título “${f.video_titulo}” bate com ${batem.length} vídeos; no YouTube busquei nos 5 mais recentes.`);
    for (const v of batem.slice(0, 5)) videos.push({ id: v.video_id, titulo: v.titulo });
    if (!batem.length && !videos.length) avisos.push(`Nenhum vídeo do canal tem “${f.video_titulo}” no título.`);
  }

  if (!plano.termos.length && !videos.length && !plano.de && !plano.ate) {
    return {
      achados: 0, novos: 0, paginas: 0, limite: [],
      aviso: [...avisos, "No YouTube só dá para buscar por palavras, vídeo e período. Tipo de comentário, porcentagens, urgência e lead são da triagem da IA: essa parte foi buscada só nos comentários que já estão no DashMed."].join(" "),
    };
  }

  const canal = await canalConectado(clienteId);
  const token = await tokenDeAcesso(clienteId);
  type Consulta = { videoId?: string; termo?: string; rotulo: string };
  const alvos: { videoId?: string; nome: string }[] = videos.length ? videos.map((v) => ({ videoId: v.id, nome: `“${v.titulo.slice(0, 50)}”` })) : [{ nome: "" }];
  const consultas: Consulta[] = alvos.flatMap((a) => (plano.termos.length
    ? plano.termos.map((t) => ({ videoId: a.videoId, termo: t, rotulo: a.nome ? `${t} em ${a.nome}` : t }))
    : [{ videoId: a.videoId, rotulo: a.nome || "comentários do período" }]));
  // vídeo inteiro ou período: vai mais fundo; palavra sem período: as mais recentes
  const maxPaginas = plano.de || (videos.length && !plano.termos.length) ? 10 : 4;

  const inicio = Date.now();
  const achados = new Map<string, ComentarioLido>();
  const limite: string[] = [];
  const erros: string[] = [];
  let paginas = 0;
  async function rodar(c: Consulta) {
    let pagina: string | null = null;
    for (let i = 0; ; i++) {
      if (i >= maxPaginas || paginas >= MAX_UNIDADES_BUSCA || Date.now() - inicio > TEMPO_BUSCA_MS) {
        limite.push(c.rotulo);
        return;
      }
      paginas++;
      await gastarCota(clienteId, 1);
      let r: Awaited<ReturnType<typeof lerPagina>>;
      try {
        r = await lerPagina(token, canal.canal_id, pagina, { videoId: c.videoId, termo: c.termo });
      } catch (e) {
        erros.push(`${c.rotulo}: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      // a ordem é do mais novo ao mais antigo; só para de paginar pela data
      // se a página veio mesmo nessa ordem
      const emOrdem = r.itens.every((x, j) => j === 0 || r.itens[j - 1].publicado_em >= x.publicado_em);
      let passouDoInicio = false;
      for (const x of r.itens) {
        if (plano.ate && x.publicado_em > plano.ate) continue;
        if (plano.de && x.publicado_em < plano.de) { passouDoInicio = true; continue; }
        achados.set(x.thread_id, x);
      }
      if ((passouDoInicio && emOrdem) || !r.proxima) return;
      pagina = r.proxima;
    }
  }
  for (let i = 0; i < consultas.length; i += SIMULTANEAS) await Promise.all(consultas.slice(i, i + SIMULTANEAS).map(rodar));
  if (erros.length && erros.length === consultas.length) throw new Falha(`O YouTube não deixou buscar: ${erros[0]}`, 502);
  if (erros.length) avisos.push(`Parte da busca falhou no YouTube (${erros.slice(0, 2).join("; ")}).`);

  const lista = [...achados.values()].filter((c) => c.autor_canal_id !== canal.canal_id);
  const novos = await gravarLidos(clienteId, canal.canal_id, token, lista);
  return { achados: lista.length, novos, paginas, limite: [...new Set(limite)].slice(0, 8), aviso: avisos.join(" ") || null };
}
