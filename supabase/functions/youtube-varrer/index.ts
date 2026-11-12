// Varredura do canal do YouTube (David, 12/11/26: "pegar os comentários ...
// começando pelos comentários mais recentes aos mais antigos").
//
// Um passo por execução (o relógio da edge é curto), encadeados:
//   ler_novos → triar (lotes de 40) → redigir (lotes de 6) → ler_historico → ...
// - ler_novos: do topo até o comentário mais novo já lido;
// - ler_historico: a próxima página para trás, guardada em historico_token;
// - triar: a IA dá probabilidade, procedimento, urgência; quem qualifica vira
//   lead (um por pessoa) e entra na fila de resposta;
// - redigir: a IA escreve a resposta; fica como rascunho para o médico publicar.
// Teto de passos por rodada (custo de IA previsível); a rodada seguinte (cron
// de hora em hora ou botão) continua de onde parou. Travou? O vigia marca erro.
//
// Quem pode chamar: o médico (sessão), a própria função (chave de serviço) e o
// cron do banco (cabeçalho x-dashmed-cron). Sem JWT no gateway: a função
// confere as três formas.
import {
  admin, chamadaInterna, chamarFuncaoInterna, CORS, corpoJson, ehUuid, emSegundoPlano, enxerga, Falha, lerSegredo, quemPediu,
  responder, respostaDeErro,
} from "../_shared/base.ts";
import { type Avaliacao, carregarConfig, gravarRedacao, paraRedigir, qualifica, redigir, triar } from "../_shared/seller.ts";
import { canalConectado, gastarCota, lerPagina, titulosDosVideos, tokenDeAcesso, type ComentarioLido } from "../_shared/youtube.ts";

const MAX_PASSOS = 16;
const LOTE_TRIAGEM = 40;
const LOTE_REDACAO = 6;
const PAGINAS_NOVOS = 5;
const PAGINAS_HISTORICO = 3;

function iguais(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

type Varredura = {
  cliente_id: string;
  estado: string;
  passo: string | null;
  passos: number;
  mais_novo_em: string | null;
  historico_token: string | null;
  historico_completo: boolean;
  lidos_total: number;
};

async function contar(clienteId: string, campo: "triagem" | "resposta", valor: string): Promise<number> {
  const { count } = await admin.from("yt_comentarios").select("id", { count: "exact", head: true })
    .eq("cliente_id", clienteId).eq(campo, valor).is("deleted_at", null);
  return count ?? 0;
}

/** Grava os comentários lidos (o mesmo comentário não entra duas vezes). */
async function gravarLidos(clienteId: string, canalId: string, token: string, itens: ComentarioLido[]): Promise<number> {
  // comentário do próprio canal não é lead
  const deFora = itens.filter((c) => c.autor_canal_id !== canalId && c.texto.trim());
  if (!deFora.length) return 0;
  const videos = [...new Set(deFora.map((c) => c.video_id).filter(Boolean))];
  let titulos = new Map<string, string>();
  if (videos.length) {
    await gastarCota(clienteId, Math.ceil(videos.length / 50));
    titulos = await titulosDosVideos(token, videos);
  }
  const linhas = deFora.map((c) => ({ cliente_id: clienteId, canal_id: canalId, ...c, video_titulo: titulos.get(c.video_id) ?? null }));
  const { data, error } = await admin.from("yt_comentarios")
    .upsert(linhas, { onConflict: "cliente_id,thread_id", ignoreDuplicates: true }).select("id");
  if (error) throw new Falha(`Não consegui gravar os comentários lidos (${error.message}).`, 500);
  return data?.length ?? 0;
}

async function lerNovos(v: Varredura, canalId: string, token: string): Promise<string> {
  let pagina: string | null = null;
  const novos: ComentarioLido[] = [];
  let chegou = false;
  const primeiraLeitura = !v.mais_novo_em;
  let proximaDoTopo: string | null = null;
  for (let i = 0; i < (primeiraLeitura ? 1 : PAGINAS_NOVOS) && !chegou; i++) {
    await gastarCota(v.cliente_id, 1);
    const r = await lerPagina(token, canalId, pagina);
    for (const c of r.itens) {
      if (v.mais_novo_em && c.publicado_em <= v.mais_novo_em) { chegou = true; break; }
      novos.push(c);
    }
    proximaDoTopo = r.proxima;
    pagina = r.proxima;
    if (!pagina) { chegou = true; break; }
  }
  const gravados = await gravarLidos(v.cliente_id, canalId, token, novos);
  const maisNovo = novos.reduce<string | null>((m, c) => (!m || c.publicado_em > m ? c.publicado_em : m), v.mais_novo_em);
  const mudanca: Record<string, unknown> = { mais_novo_em: maisNovo, lidos_total: v.lidos_total + gravados };
  if (primeiraLeitura) {
    // primeira leitura: o histórico começa logo depois da primeira página
    mudanca.historico_token = proximaDoTopo;
    mudanca.historico_completo = !proximaDoTopo;
    mudanca.historico_ate = novos.length ? novos[novos.length - 1].publicado_em : null;
  }
  await admin.from("yt_varreduras").update(mudanca).eq("cliente_id", v.cliente_id);
  if (primeiraLeitura) {
    return `Primeira leitura: os ${gravados} comentário(s) mais recente(s). Os mais antigos vêm em seguida, página a página.`;
  }
  return `${gravados} comentário(s) novo(s) lido(s).${!chegou ? " Muitos comentários novos: o resto entra na próxima rodada." : ""}`;
}

async function lerHistorico(v: Varredura, canalId: string, token: string): Promise<string> {
  let pagina = v.historico_token;
  let gravados = 0;
  let ate: string | null = null;
  for (let i = 0; i < PAGINAS_HISTORICO && pagina; i++) {
    await gastarCota(v.cliente_id, 1);
    let r;
    try {
      r = await lerPagina(token, canalId, pagina);
    } catch (e) {
      // página antiga que o YouTube não aceita mais: recomeça o histórico do topo
      // (os já lidos não duplicam)
      if (e instanceof Falha && /pageToken|invalid/i.test(e.message)) {
        await admin.from("yt_varreduras").update({ historico_token: null, historico_completo: false }).eq("cliente_id", v.cliente_id);
        return "A página do histórico venceu; o histórico recomeça do topo na próxima rodada.";
      }
      throw e;
    }
    gravados += await gravarLidos(v.cliente_id, canalId, token, r.itens);
    if (r.itens.length) ate = r.itens[r.itens.length - 1].publicado_em;
    pagina = r.proxima;
  }
  await admin.from("yt_varreduras").update({
    historico_token: pagina, historico_completo: !pagina, ...(ate ? { historico_ate: ate } : {}), lidos_total: v.lidos_total + gravados,
  }).eq("cliente_id", v.cliente_id);
  return `${gravados} comentário(s) antigo(s) lido(s)${ate ? ` (até ${new Date(ate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })})` : ""}.${!pagina ? " Histórico do canal lido por inteiro." : ""}`;
}

async function passoTriar(clienteId: string): Promise<string> {
  const c = await carregarConfig(clienteId);
  const { data } = await admin.from("yt_comentarios")
    .select("id, texto, autor_nome, autor_canal_id, autor_foto_url, video_titulo, ja_respondido, pode_responder")
    .eq("cliente_id", clienteId).eq("triagem", "pendente").is("deleted_at", null)
    .order("publicado_em", { ascending: false }).limit(LOTE_TRIAGEM);
  const lote = data ?? [];
  if (!lote.length) return "Nada para triar.";
  const avaliacoes = await triar(clienteId, lote, c);
  let leads = 0;
  let paraResponder = 0;
  for (const x of lote) {
    const a: Avaliacao | undefined = avaliacoes.get(x.id);
    if (!a) {
      await admin.from("yt_comentarios").update({ triagem: "erro", resumo: "A IA não avaliou este comentário." }).eq("id", x.id);
      continue;
    }
    let leadId: string | null = null;
    const ehLead = qualifica(a, c) && !!x.autor_canal_id;
    if (ehLead) {
      const { data: id, error } = await admin.rpc("garantir_lead", {
        p_cliente: clienteId, p_autor: x.autor_canal_id, p_nome: x.autor_nome, p_foto: x.autor_foto_url, p_prob: a.probabilidade, p_procs: a.procedimentos,
      });
      if (error) throw new Falha(`Não consegui criar o lead (${error.message}).`, 500);
      leadId = id as string;
      leads++;
      await admin.from("lead_eventos").insert({ cliente_id: clienteId, lead_id: leadId, tipo: "comentario", texto: x.texto.slice(0, 4000), comentario_id: x.id, feito_por: null });
      // o médico já respondeu no YouTube: o lead já está em conversa
      if (x.ja_respondido) await admin.from("leads").update({ etapa: "respondido" }).eq("id", leadId).eq("etapa", "novo");
    }
    const responder = ehLead && !x.ja_respondido && x.pode_responder;
    if (responder) paraResponder++;
    await admin.from("yt_comentarios").update({
      triagem: "feita", probabilidade: a.probabilidade, categoria: a.categoria, procedimentos: a.procedimentos, urgente: a.urgente,
      resumo: a.resumo, triado_em: new Date().toISOString(), lead_id: leadId, resposta: responder ? "redigir" : "nenhuma",
    }).eq("id", x.id);
  }
  return `${lote.length} comentário(s) triado(s): ${leads} lead(s), ${paraResponder} para responder.`;
}

/** Uma resposta pendente por pessoa (David, 12/11/26: "vamos ajustar" — na
 *  primeira rodada a mesma pessoa recebeu duas respostas em comentários
 *  diferentes, o que no YouTube parece spam). Se a pessoa já tem resposta na
 *  fila, sendo publicada, ou publicada há menos de 7 dias, este comentário fica
 *  no histórico do lead sem gerar outra resposta. */
async function jaTemRespostaDaPessoa(leadId: string, comentarioId: string): Promise<boolean> {
  const seteDias = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { count } = await admin.from("yt_comentarios").select("id", { count: "exact", head: true })
    .eq("lead_id", leadId).neq("id", comentarioId).is("deleted_at", null)
    .or(`resposta.in.(rascunho,falhou,publicando),and(resposta.eq.publicada,publicada_em.gte.${seteDias})`);
  return (count ?? 0) > 0;
}

async function passoRedigir(clienteId: string): Promise<string> {
  const c = await carregarConfig(clienteId);
  const candidatos = await paraRedigir({ clienteId, limite: LOTE_REDACAO * 3 });
  if (!candidatos.length) return "Nada para redigir.";
  const itens: typeof candidatos = [];
  const pessoasDoLote = new Set<string>();
  let juntados = 0;
  for (const it of candidatos) {
    if (itens.length >= LOTE_REDACAO) break;
    if (it.lead_id && (pessoasDoLote.has(it.lead_id) || await jaTemRespostaDaPessoa(it.lead_id, it.id))) {
      juntados++;
      await admin.from("yt_comentarios").update({
        resposta: "nenhuma", resposta_msg: "Mesma pessoa de outro comentário que já tem resposta (na fila ou publicada há menos de 7 dias): uma resposta por vez.",
      }).eq("id", it.id);
      continue;
    }
    if (it.lead_id) pessoasDoLote.add(it.lead_id);
    itens.push(it);
  }
  if (!itens.length) return `${juntados} comentário(s) de quem já tem resposta: sem resposta nova.`;
  const r = await gravarRedacao(itens, await redigir(clienteId, itens, c));
  return `${r.ok} resposta(s) pronta(s) para revisar${r.problemas ? `, ${r.problemas} com problema (ver na fila)` : ""}${juntados ? `; ${juntados} de quem já tem resposta` : ""}.`;
}

/** Um passo da rodada e o disparo do seguinte. */
async function passo(clienteId: string): Promise<void> {
  const { data } = await admin.from("yt_varreduras").select("*").eq("cliente_id", clienteId).maybeSingle();
  const v = data as Varredura | null;
  if (!v || v.estado !== "rodando") return;
  try {
    const canal = await canalConectado(clienteId);
    if (!(await lerSegredo(clienteId, "anthropic"))) {
      throw new Falha("Falta a chave da Anthropic (Claude) para a triagem. Coloque em Configurações → Chaves de API.", 412);
    }
    const atual = v.passo ?? "ler_novos";
    let msg: string;
    if (atual === "ler_novos" || atual === "ler_historico") {
      const token = await tokenDeAcesso(clienteId);
      msg = atual === "ler_novos" ? await lerNovos(v, canal.canal_id, token) : await lerHistorico(v, canal.canal_id, token);
    } else if (atual === "triar") {
      msg = await passoTriar(clienteId);
    } else {
      msg = await passoRedigir(clienteId);
    }
    const passos = v.passos + 1;
    // o que fazer a seguir: primeiro esvaziar a triagem, depois a redação, e
    // então avançar no histórico
    const { data: depois } = await admin.from("yt_varreduras").select("historico_token, historico_completo").eq("cliente_id", clienteId).single();
    let proximo: string | null = null;
    if (await contar(clienteId, "triagem", "pendente")) proximo = "triar";
    else if (await contar(clienteId, "resposta", "redigir")) proximo = "redigir";
    else if (!depois?.historico_completo && depois?.historico_token) proximo = "ler_historico";

    if (!proximo || passos >= MAX_PASSOS) {
      const fim = !proximo ? "Rodada concluída." : "Rodada encerrada no limite de passos; a próxima continua de onde parou.";
      await admin.from("yt_varreduras").update({ estado: "parada", passo: null, passos, msg: `${msg} ${fim}`, terminada_em: new Date().toISOString() }).eq("cliente_id", clienteId);
      return;
    }
    await admin.from("yt_varreduras").update({ passo: proximo, passos, msg }).eq("cliente_id", clienteId);
    await chamarFuncaoInterna("youtube-varrer", { acao: "continuar", cliente_id: clienteId });
  } catch (e) {
    const msg = e instanceof Falha ? e.message : `Erro inesperado: ${e instanceof Error ? e.message : String(e)}`;
    console.error("youtube-varrer", clienteId, msg);
    await admin.from("yt_varreduras").update({ estado: "erro", msg, terminada_em: new Date().toISOString() }).eq("cliente_id", clienteId);
  }
}

/** Começa uma rodada se não houver outra andando (troca de estado atômica). */
async function comecar(clienteId: string): Promise<boolean> {
  await admin.from("yt_varreduras").upsert({ cliente_id: clienteId }, { onConflict: "cliente_id", ignoreDuplicates: true });
  const parada = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data } = await admin.from("yt_varreduras").update({
    estado: "rodando", passo: "ler_novos", passos: 0, msg: "Lendo comentários novos…", iniciada_em: new Date().toISOString(), terminada_em: null,
  }).eq("cliente_id", clienteId).or(`estado.neq.rodando,atualizado_em.lt.${parada}`).select("cliente_id");
  return !!data?.length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") throw new Falha("Use POST.", 405);
    const cron = iguais(req.headers.get("x-dashmed-cron") ?? "", Deno.env.get("DASHMED_CRON_TOKEN") ?? "");
    const interno = chamadaInterna(req);
    const eu = cron || interno ? null : await quemPediu(req);
    const p = await corpoJson<{ acao?: string; cliente_id?: string }>(req);

    if (p.acao === "cron") {
      if (!cron) throw new Falha("Só o agendador chama esta ação.", 403);
      const { data: ativos } = await admin.from("seller_config").select("cliente_id").eq("automatico", true);
      const { data: conectados } = await admin.from("integracoes").select("cliente_id").eq("provedor", "youtube");
      const comCanal = new Set((conectados ?? []).map((c) => c.cliente_id));
      const alvos = (ativos ?? []).map((a) => a.cliente_id as string).filter((id) => comCanal.has(id));
      for (const id of alvos) {
        if (!(await comecar(id))) continue;
        try {
          await chamarFuncaoInterna("youtube-varrer", { acao: "continuar", cliente_id: id });
        } catch (e) {
          await admin.from("yt_varreduras").update({ estado: "erro", msg: `A rodada automática não começou: ${e instanceof Error ? e.message : e}` }).eq("cliente_id", id);
        }
      }
      return responder({ ok: true, clientes: alvos.length });
    }

    if (!ehUuid(p.cliente_id)) throw new Falha("Cliente inválido.");
    if (eu && !enxerga(eu, p.cliente_id)) throw new Falha("Você não tem acesso a este cliente.", 403);

    if (p.acao === "varrer") {
      if (!cron && !interno && !eu) throw new Falha("Sem permissão.", 401);
      await canalConectado(p.cliente_id);
      if (!(await comecar(p.cliente_id))) throw new Falha("Já há uma varredura andando. Espere ela terminar.", 409);
      emSegundoPlano(passo(p.cliente_id));
      return responder({ ok: true, mensagem: "Varredura começou. Os comentários aparecem aos poucos." }, 202);
    }
    if (p.acao === "continuar") {
      if (!interno) throw new Falha("Só a própria varredura continua a si mesma.", 403);
      emSegundoPlano(passo(p.cliente_id));
      return responder({ ok: true }, 202);
    }
    throw new Falha("Ação desconhecida.", 400);
  } catch (e) {
    return respostaDeErro(e);
  }
});
