import Link from "next/link";
import { clientesDe, supabaseServidor, usuarioAtual } from "@/lib/supabase/server";
import { dataHora } from "@/lib/conteudo";
import { type Comentario, LINK_VIDEO, type Resumo, ROTULO_CATEGORIA, ROTULO_ETAPA, type Varredura } from "@/lib/youtube";
import Atualizador from "./atualizador";
import Fila from "./fila";
import Quadro, { type CartaoLead } from "./quadro";
import Varrer from "./varrer";

// YouTube Seller (David, 12/11/26: "um social seller automatizado"): o robô
// lê os comentários do canal, separa quem tem chance de virar consulta ou
// procedimento e escreve a resposta; o médico revisa e publica; o CRM
// acompanha cada lead.
const ABAS = [
  { id: "fila", rotulo: "Respostas para revisar" },
  { id: "leads", rotulo: "Leads (CRM)" },
  { id: "comentarios", rotulo: "Comentários lidos" },
] as const;

const RESPOSTA: Record<string, string> = {
  nenhuma: "sem resposta", redigir: "IA vai escrever", rascunho: "na fila", publicando: "publicando…",
  publicada: "respondido", falhou: "na fila (problema)", ignorada: "ignorado",
};

export default async function YoutubeSeller({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const eu = await usuarioAtual();
  if (!eu) return null;
  const { emFoco } = await clientesDe(eu);
  if (!emFoco) return <p className="text-sm text-zinc-500">Nenhum cliente cadastrado.</p>;
  const { aba: abaPedida } = await searchParams;
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
    const { data } = await supabase.from("yt_comentarios")
      .select("id, comentario_id, video_id, video_titulo, autor_nome, autor_foto_url, texto, publicado_em, curtidas, ja_respondido, triagem, probabilidade, categoria, procedimentos, urgente, resumo, resposta, rascunho, rascunho_editado, resposta_msg, publicada_em, lead_id")
      .eq("cliente_id", emFoco.id).in("resposta", ["rascunho", "falhou"]).is("deleted_at", null)
      .order("urgente", { ascending: false }).order("probabilidade", { ascending: false }).order("publicado_em", { ascending: false }).limit(40);
    const lista = (data ?? []) as Comentario[];
    const ids = [...new Set(lista.map((c) => c.lead_id).filter(Boolean))] as string[];
    const { data: leads } = ids.length ? await supabase.from("leads").select("id, codigo").in("id", ids) : { data: [] };
    conteudo = <Fila comentarios={lista} codigos={Object.fromEntries((leads ?? []).map((l) => [l.id, l.codigo]))} canal={canal?.canal_titulo ?? "seu canal"} />;
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
  } else {
    const { data } = await supabase.from("yt_comentarios")
      .select("id, comentario_id, video_id, video_titulo, autor_nome, texto, publicado_em, triagem, probabilidade, categoria, urgente, resposta, ja_respondido, lead_id")
      .eq("cliente_id", emFoco.id).is("deleted_at", null).order("publicado_em", { ascending: false }).limit(100);
    conteudo = (
      <div className="cartao divide-y divide-zinc-100">
        {(data ?? []).length === 0 && <p className="p-5 text-sm text-zinc-500">Nenhum comentário lido ainda.</p>}
        {(data ?? []).map((c) => (
          <div key={c.id} className="space-y-1 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
              <b className="text-zinc-800">{c.autor_nome}</b>
              <span>{dataHora(c.publicado_em)}</span>
              {c.triagem === "feita" ? (
                <>
                  <span className="rounded bg-teal-50 px-1 font-semibold text-teal-800">{c.probabilidade ?? 0}%</span>
                  <span>{ROTULO_CATEGORIA[c.categoria ?? ""] ?? c.categoria}</span>
                </>
              ) : <span>{c.triagem === "erro" ? "triagem falhou" : "aguardando triagem"}</span>}
              {c.urgente && <span className="font-semibold text-zinc-900">urgente</span>}
              <span>· {c.ja_respondido && c.resposta !== "publicada" ? "você respondeu no YouTube" : RESPOSTA[c.resposta] ?? c.resposta}</span>
              {c.lead_id && <Link href={`/youtube/leads/${c.lead_id}`} className="underline">lead</Link>}
              <a href={LINK_VIDEO(c.video_id, c.comentario_id)} target="_blank" rel="noreferrer" className="truncate hover:underline">{c.video_titulo ?? "vídeo"}</a>
            </div>
            <p className="line-clamp-3 text-zinc-800">{c.texto}</p>
          </div>
        ))}
      </div>
    );
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
      </div>

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
