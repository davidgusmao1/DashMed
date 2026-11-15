import Link from "next/link";
import { clientesDe, supabaseServidor, usuarioAtual } from "@/lib/supabase/server";
import { lerFiltroDaUrl, lerResumoYoutube, POR_PAGINA, usaPorcentagens } from "@/lib/busca-youtube";
import { type Comentario, LINK_VIDEO, type Resumo, ROTULO_ETAPA, type Varredura } from "@/lib/youtube";
import AprenderEdicoes from "./aprender";
import Atualizador from "./atualizador";
import BarraBusca from "./busca";
import BuscarLead from "./buscar-lead";
import Fila from "./fila";
import FiltrosFila, { type ContagemFila, type FiltroFila } from "./filtros-fila";
import ListaComentarios, { type ItemComentario } from "./lista-comentarios";
import Pautas, { type Pauta } from "./pautas";
import Quadro, { type CartaoLead } from "./quadro";
import Resultados, { type Funil } from "./resultados";
import ResultadosBusca from "./resultados-busca";
import Varrer from "./varrer";

// YouTube Seller (David, 12/11/26: "um social seller automatizado"): o robô
// lê os comentários do canal, separa quem tem chance de virar consulta ou
// procedimento e escreve a resposta; o médico revisa e publica; o CRM
// acompanha cada lead.
const ABAS = [
  { id: "fila", rotulo: "Respostas para revisar" },
  { id: "leads", rotulo: "Leads (CRM)" },
  { id: "comentarios", rotulo: "Comentários lidos" },
  { id: "resultados", rotulo: "Resultados" },
  { id: "pautas", rotulo: "Pautas de conteúdo" },
  { id: "busca", rotulo: "Busca" },
] as const;

type Parametros = { aba?: string; f?: string; proc?: string; video?: string; q?: string; b?: string; o?: string; p?: string; yt?: string };

export default async function YoutubeSeller({ searchParams }: { searchParams: Promise<Parametros> }) {
  const eu = await usuarioAtual();
  if (!eu) return null;
  const { emFoco } = await clientesDe(eu);
  if (!emFoco) return <p className="text-sm text-zinc-500">Nenhum cliente cadastrado.</p>;
  const { aba: abaPedida, f, proc, video, q: frase, b, o: obs, p: paginaPedida, yt } = await searchParams;
  const aba = ABAS.some((a) => a.id === abaPedida) ? abaPedida! : "fila";
  const supabase = await supabaseServidor();

  const [{ data: integ }, { data: varredura }, { data: resumo }] = await Promise.all([
    supabase.from("integracoes").select("provedor, parametros").eq("cliente_id", emFoco.id).in("provedor", ["anthropic", "google", "youtube"]),
    supabase.from("yt_varreduras").select("estado, passo, msg, iniciada_em, terminada_em, atualizado_em, historico_ate, historico_completo, lidos_total").eq("cliente_id", emFoco.id).maybeSingle(),
    supabase.rpc("resumo_youtube", { p_cliente: emFoco.id }),
  ]);
  const tem = (p: string) => (integ ?? []).some((i) => i.provedor === p);
  const canal = (integ ?? []).find((i) => i.provedor === "youtube")?.parametros as { canal_titulo?: string; canal_foto?: string | null } | undefined;
  const r = (resumo ?? null) as Resumo | null;
  const v = (varredura ?? null) as Varredura | null;
  const pronto = tem("youtube") && tem("anthropic");

  let conteudo: React.ReactNode = null;
  if (aba === "fila") {
    // a fila inteira, leve, só para contar os filtros (fila passa de 1.000? então já é outro problema)
    const { data: toda } = await supabase.from("yt_comentarios").select("urgente, conversa_de, procedimentos, video_id, video_titulo")
      .eq("cliente_id", emFoco.id).in("resposta", ["rascunho", "falhou"]).is("deleted_at", null).limit(1000);
    const procs = new Map<string, number>();
    const vids = new Map<string, { id: string; titulo: string; n: number }>();
    for (const c of toda ?? []) {
      for (const pr of (c.procedimentos ?? []) as string[]) procs.set(pr, (procs.get(pr) ?? 0) + 1);
      const v = vids.get(c.video_id) ?? { id: c.video_id, titulo: c.video_titulo ?? c.video_id, n: 0 };
      v.n++;
      vids.set(c.video_id, v);
    }
    const contagem: ContagemFila = {
      total: (toda ?? []).length,
      urgentes: (toda ?? []).filter((c) => c.urgente).length,
      conversas: (toda ?? []).filter((c) => c.conversa_de).length,
      procedimentos: [...procs].sort((a, b) => b[1] - a[1]),
      videos: [...vids.values()].sort((a, b) => b.n - a.n),
    };
    const filtro: FiltroFila = {
      f: f === "urgente" || f === "conversa" ? f : "",
      proc: proc && procs.has(proc) ? proc : "",
      video: video && vids.has(video) ? video : "",
    };
    let q = supabase.from("yt_comentarios")
      .select("id, comentario_id, thread_id, conversa_de, video_id, video_titulo, autor_nome, autor_foto_url, texto, publicado_em, curtidas, ja_respondido, triagem, probabilidade, categoria, procedimentos, urgente, resumo, resposta, rascunho, rascunho_editado, sugestao_ia, resposta_msg, publicada_em, lead_id, video_sugerido, consulta_pct, cirurgia_pct, socio_pct, socio_motivo", { count: "exact" })
      .eq("cliente_id", emFoco.id).in("resposta", ["rascunho", "falhou"]).is("deleted_at", null);
    if (filtro.f === "urgente") q = q.eq("urgente", true);
    if (filtro.f === "conversa") q = q.not("conversa_de", "is", null);
    // literal de array com aspas: o nome do procedimento tem espaço e parênteses
    if (filtro.proc) q = q.filter("procedimentos", "cs", `{"${filtro.proc.replace(/["\\]/g, "\\$&")}"}`);
    if (filtro.video) q = q.eq("video_id", filtro.video);
    const { data, count } = await q
      .order("urgente", { ascending: false }).order("probabilidade", { ascending: false }).order("publicado_em", { ascending: false }).limit(40);
    const lista = (data ?? []) as Comentario[];
    const ids = [...new Set(lista.map((c) => c.lead_id).filter(Boolean))] as string[];
    const { data: leads } = ids.length ? await supabase.from("leads").select("id, codigo").in("id", ids) : { data: [] };
    // continuação de conversa: o comentário original e a resposta que foi dada
    const topoIds = [...new Set(lista.map((c) => c.conversa_de).filter(Boolean))] as string[];
    const { data: topos } = topoIds.length
      ? await supabase.from("yt_comentarios").select("id, texto, rascunho, resposta, ja_respondido").in("id", topoIds)
      : { data: [] };
    const conversas = Object.fromEntries((topos ?? []).map((t) => [t.id, {
      comentario: t.texto as string,
      resposta: t.resposta === "publicada" ? (t.rascunho as string | null) : t.ja_respondido ? "(você respondeu direto no YouTube)" : null,
    }]));
    // o vídeo do canal que a IA indicou em cada resposta (0017)
    const vidIds = [...new Set(lista.map((c) => c.video_sugerido).filter(Boolean))] as string[];
    const { data: vids2 } = vidIds.length
      ? await supabase.from("yt_videos").select("video_id, titulo").eq("cliente_id", emFoco.id).in("video_id", vidIds)
      : { data: [] };
    const titulosVideos = Object.fromEntries((vids2 ?? []).map((v) => [v.video_id, v.titulo as string]));
    conteudo = (
      <div className="space-y-3">
        {contagem.total > 0 && <FiltrosFila contagem={contagem} filtro={filtro} />}
        <Fila comentarios={lista} codigos={Object.fromEntries((leads ?? []).map((l) => [l.id, l.codigo]))} canal={canal?.canal_titulo ?? "seu canal"} clienteId={emFoco.id} conversas={conversas}
          titulosVideos={titulosVideos} filtrada={!!(filtro.f || filtro.proc || filtro.video)} />
        {(count ?? 0) > lista.length && <p className="text-xs text-zinc-500">Mostrando {lista.length} de {count}. As próximas aparecem conforme estas forem publicadas ou ignoradas.</p>}
      </div>
    );
  } else if (aba === "leads") {
    const { data } = await supabase.from("leads")
      .select("id, nome, foto_url, codigo, etapa, probabilidade, procedimentos, proximo_passo_em, atualizado_em, paciente_id")
      .eq("cliente_id", emFoco.id).is("deleted_at", null)
      .order("probabilidade", { ascending: false }).order("atualizado_em", { ascending: false }).limit(600);
    const leads = data ?? [];
    const ids = leads.map((l) => l.id);
    const ultimo = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: cs } = await supabase.from("yt_comentarios").select("lead_id, texto, publicado_em")
        .in("lead_id", ids.slice(i, i + 200)).is("deleted_at", null).order("publicado_em", { ascending: false }).limit(1000);
      for (const c of cs ?? []) if (c.lead_id && !ultimo.has(c.lead_id)) ultimo.set(c.lead_id, c.texto);
    }
    conteudo = <Quadro leads={leads.map((l) => ({ ...l, ultimo_comentario: ultimo.get(l.id) ?? null })) as CartaoLead[]} />;
  } else if (aba === "pautas") {
    const { data } = await supabase.from("yt_pautas")
      .select("id, titulo, porque, procedimento, comentarios, exemplos, conteudo_id, criado_em")
      .eq("cliente_id", emFoco.id).is("deleted_at", null).order("comentarios", { ascending: false }).limit(60);
    const pautas = data ?? [];
    const idsEx = [...new Set(pautas.flatMap((p) => ((p.exemplos ?? []) as { id: string }[]).map((e) => e.id)))];
    const { data: cs } = idsEx.length
      ? await supabase.from("yt_comentarios").select("id, video_id, comentario_id").in("id", idsEx)
      : { data: [] };
    const link = new Map((cs ?? []).map((c) => [c.id, LINK_VIDEO(c.video_id, c.comentario_id)]));
    conteudo = <Pautas clienteId={emFoco.id} pautas={pautas.map((p) => ({
      ...p,
      exemplos: ((p.exemplos ?? []) as { id: string; texto: string }[]).map((e) => ({ ...e, link: link.get(e.id) ?? null })),
    })) as Pauta[]} />;
  } else if (aba === "resultados") {
    const { data, error } = await supabase.rpc("funil_youtube", { p_cliente: emFoco.id });
    conteudo = error || !data
      ? <p className="cartao p-5 text-sm text-zinc-900">Não consegui montar o funil: {error?.message ?? "sem dados"}.</p>
      : <Resultados funil={data as Funil} />;
  } else if (aba === "busca") {
    // busca por frase (15/11/26): os critérios vêm na URL (a IA traduziu na barra)
    const filtro = lerFiltroDaUrl(b);
    if (!filtro) {
      conteudo = (
        <div className="cartao space-y-2 p-5 text-sm text-zinc-700">
          <p className="font-semibold text-zinc-900">Escreva na barra acima o que você procura, do seu jeito. A busca vai direto ao YouTube e junta com o que já está no DashMed.</p>
          <p>Dá para misturar período (“semana passada”, “ontem”, “últimos 30 dias”), vídeo (“do vídeo da minha última quarta”), assunto (“que falam de prótese ou de dor”), tipo (“quem pediu para marcar”), porcentagens (“alta chance de cirurgia”) e ordem (“mais curtidos primeiro”).</p>
          <p className="text-xs text-zinc-500">A IA traduz a frase em critérios; cada critério aparece numa etiqueta, e você tira o que não quiser.</p>
          {b && <p className="text-xs text-zinc-900">Os critérios desta página vieram incompletos; faça a busca de novo.</p>}
        </div>
      );
    } else {
      const pagina = Math.min(Math.max(Number.parseInt(paginaPedida ?? "1", 10) || 1, 1), 200);
      const [{ data, error }, { data: vids }, faltam] = await Promise.all([
        supabase.rpc("buscar_comentarios", { p_cliente: emFoco.id, p_filtro: filtro, p_limite: POR_PAGINA, p_pular: (pagina - 1) * POR_PAGINA }),
        filtro.videos?.length
          ? supabase.from("yt_videos").select("video_id, titulo").eq("cliente_id", emFoco.id).in("video_id", filtro.videos)
          : Promise.resolve({ data: [] as { video_id: string; titulo: string }[] }),
        usaPorcentagens(filtro)
          ? supabase.from("yt_comentarios").select("id", { count: "exact", head: true })
            .eq("cliente_id", emFoco.id).eq("triagem", "feita").is("pct_em", null).is("deleted_at", null)
          : Promise.resolve({ count: 0 }),
      ]);
      const res = (data ?? null) as { total: number; itens: ItemComentario[] } | null;
      // nada achado num vídeo: diz se é porque o vídeo ainda não tem comentário lido (regra 2)
      let videoSemComentario = false;
      if (res && res.total === 0 && filtro.videos?.length) {
        const { count } = await supabase.from("yt_comentarios").select("id", { count: "exact", head: true })
          .eq("cliente_id", emFoco.id).in("video_id", filtro.videos).is("deleted_at", null);
        videoSemComentario = (count ?? 0) === 0;
      }
      conteudo = error || !res
        ? <p className="cartao p-5 text-sm text-zinc-900">Não consegui buscar: {error?.message ?? "sem resposta do banco"}.</p>
        : <ResultadosBusca clienteId={emFoco.id} yt={lerResumoYoutube(yt)} q={frase ?? null} obs={obs ?? null} filtro={filtro} total={res.total} itens={res.itens} pagina={pagina}
            titulos={Object.fromEntries((vids ?? []).map((v) => [v.video_id, v.titulo as string]))} faltamPorcentagens={faltam.count ?? 0}
            videoSemComentario={videoSemComentario} />;
    }
  } else {
    const { data } = await supabase.from("yt_comentarios")
      .select("id, comentario_id, video_id, video_titulo, autor_nome, texto, publicado_em, triagem, probabilidade, categoria, urgente, resposta, ja_respondido, lead_id, conversa_de, consulta_pct, cirurgia_pct, socio_pct, socio_motivo")
      .eq("cliente_id", emFoco.id).is("deleted_at", null).order("publicado_em", { ascending: false }).limit(100);
    conteudo = <ListaComentarios itens={(data ?? []) as ItemComentario[]} vazio="Nenhum comentário lido ainda." />;
  }

  return (
    <div className="max-w-6xl space-y-5">
      <Atualizador ativo={v?.estado === "rodando"} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">YouTube Seller</h1>
          <p className="text-sm text-zinc-500">
            {canal?.canal_titulo ? <>Canal <b>{canal.canal_titulo}</b> · </> : null}
            A IA lê e tria os comentários e escreve as respostas; você revisa e publica.
          </p>
        </div>
        <BuscarLead clienteId={emFoco.id} />
      </div>
      <BarraBusca clienteId={emFoco.id} inicial={aba === "busca" ? frase ?? "" : ""} />

      {!pronto && (
        <div className="cartao space-y-1 p-4 text-sm">
          <div className="font-semibold">Falta configurar</div>
          {!tem("anthropic") && <p>• A chave da Claude (Anthropic), que faz a triagem e as respostas.</p>}
          {!tem("google") && <p>• As credenciais do Google (OAuth) para o YouTube.</p>}
          {!tem("youtube") && <p>• Conectar o canal do YouTube.</p>}
          <Link href="/configuracoes#youtube" className="botao-claro mt-2">Ir para Configurações</Link>
        </div>
      )}

      {tem("youtube") && <Varrer clienteId={emFoco.id} v={v} podeVarrer={pronto} />}
      {r && <AprenderEdicoes clienteId={emFoco.id} edicoesNovas={r.edicoes_novas ?? 0} podeTreinar={eu.plataforma || (eu.papel === "admin" && eu.cliente_id === emFoco.id)} />}

      {r && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {[
            ["Para revisar", r.para_revisar],
            ["Leads", r.leads],
            ["Respondidos", r.publicadas],
            ["Respondidos hoje", r.publicadas_hoje],
            ["Comentários lidos", r.comentarios],
            ["Cota da API hoje", `${r.cota_hoje} / 10.000`],
          ].map(([rotulo, valor]) => (
            <div key={rotulo as string} className="cartao p-3">
              <div className="text-xs text-zinc-500">{rotulo}</div>
              <div className="text-lg font-semibold">{valor}</div>
            </div>
          ))}
        </div>
      )}
      {r && (r.triagem_pendente > 0 || r.redigir > 0) && (
        <p className="text-xs text-zinc-500">
          Na fila da IA: {r.triagem_pendente} comentário(s) para triar e {r.redigir} resposta(s) para escrever.{" "}
          {v?.estado === "rodando" ? "A varredura em andamento continua daqui." : "A próxima varredura continua daqui."}
        </p>
      )}

      <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200 text-sm">
        {ABAS.map((a) => (
          <Link key={a.id} href={`/youtube?aba=${a.id}`}
            className={`shrink-0 border-b-2 px-3 py-2 ${aba === a.id ? "border-teal-700 font-semibold text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}>
            {a.rotulo}{a.id === "fila" && r?.para_revisar ? ` (${r.para_revisar})` : ""}
          </Link>
        ))}
      </nav>
      {conteudo}
      {aba === "leads" && (
        <p className="text-xs text-zinc-500">
          Etapas: {Object.values(ROTULO_ETAPA).join(" → ")}. Quem chamar no WhatsApp com o código (ex.: YT1234) é o lead daquele comentário: registre na ficha.
        </p>
      )}
    </div>
  );
}
