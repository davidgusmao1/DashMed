import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { supabaseServidor, usuarioAtual } from "@/lib/supabase/server";
import { dataHora } from "@/lib/conteudo";
import { LINK_VIDEO, type Lead, ROTULO_CATEGORIA, TIPOS_EVENTO } from "@/lib/youtube";
import Ficha from "./ficha";

// Ficha do lead do YouTube Seller: quem é, o que comentou, o que respondemos
// e o acompanhamento até virar paciente (David, 12/11/26: "montando um
// acompanhamento de um CRM para acompanhar o que está sendo falado com cada um
// desses potenciais leads").
export default async function FichaLead({ params }: { params: Promise<{ id: string }> }) {
  const eu = await usuarioAtual();
  if (!eu) return null;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await supabaseServidor();
  const { data: l } = await supabase.from("leads")
    .select("id, cliente_id, nome, foto_url, codigo, etapa, etapa_em, probabilidade, procedimentos, local_interesse, telefone, notas, proximo_passo_em, responsavel_id, paciente_id, autor_canal_id, criado_em, atualizado_em")
    .eq("id", id).is("deleted_at", null).maybeSingle();
  if (!l) notFound();
  const lead = l as Lead & { cliente_id: string };

  const [{ data: comentarios }, { data: eventos }, { data: usuarios }, { data: paciente }] = await Promise.all([
    supabase.from("yt_comentarios").select("id, comentario_id, video_id, video_titulo, texto, publicado_em, probabilidade, categoria, urgente, resposta, rascunho, publicada_em")
      .eq("lead_id", id).is("deleted_at", null).order("publicado_em", { ascending: false }).limit(50),
    supabase.from("lead_eventos").select("id, tipo, texto, feito_por, feito_em").eq("lead_id", id).order("feito_em", { ascending: false }).limit(200),
    supabase.from("usuarios").select("id, nome").eq("ativo", true).is("deleted_at", null).order("nome"),
    lead.paciente_id ? supabase.from("pacientes").select("id, nome").eq("id", lead.paciente_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const nomes = new Map((usuarios ?? []).map((u) => [u.id as string, u.nome as string]));

  return (
    <div className="max-w-5xl space-y-6">
      <Link href="/youtube?aba=leads" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900"><ArrowLeft size={14} /> Leads</Link>
      <div className="flex items-center gap-3">
        {lead.foto_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lead.foto_url} alt="" className="size-12 rounded-full" />
        ) : <span className="size-12 rounded-full bg-zinc-200" />}
        <div>
          <h1 className="text-2xl font-bold">{lead.nome}</h1>
          <p className="text-sm text-zinc-500">
            Código <b className="font-mono text-zinc-800">{lead.codigo}</b> · {lead.probabilidade}% · lead desde {dataHora(lead.criado_em)}
            {lead.autor_canal_id && <> · <a href={`https://www.youtube.com/channel/${lead.autor_canal_id}`} target="_blank" rel="noreferrer" className="underline">canal no YouTube</a></>}
          </p>
          {lead.procedimentos.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">{lead.procedimentos.map((p) => <span key={p} className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs">{p}</span>)}</div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Ficha lead={lead} usuarios={(usuarios ?? []) as { id: string; nome: string }[]} paciente={(paciente ?? null) as { id: string; nome: string } | null} />

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Comentários no YouTube</h2>
            {(comentarios ?? []).map((c) => (
              <div key={c.id} className="cartao space-y-2 p-4 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                  <span>{dataHora(c.publicado_em)}</span>
                  {c.probabilidade != null && <span className="rounded bg-teal-50 px-1 font-semibold text-teal-800">{c.probabilidade}%</span>}
                  {c.categoria && <span>{ROTULO_CATEGORIA[c.categoria] ?? c.categoria}</span>}
                  {c.urgente && <b className="text-zinc-900">urgente</b>}
                  <a href={LINK_VIDEO(c.video_id, c.comentario_id)} target="_blank" rel="noreferrer" className="hover:underline">{c.video_titulo ?? "vídeo"} <ExternalLink size={10} className="inline" /></a>
                </div>
                <p className="whitespace-pre-line">{c.texto}</p>
                {c.resposta === "publicada" && c.rascunho && (
                  <div className="rounded-lg bg-teal-50 p-2 text-teal-900">
                    <div className="text-xs font-semibold">Respondido em {dataHora(c.publicada_em)}</div>
                    <p className="whitespace-pre-line">{c.rascunho}</p>
                  </div>
                )}
                {(c.resposta === "rascunho" || c.resposta === "falhou") && (
                  <Link href="/youtube?aba=fila" className="text-xs underline">resposta esperando revisão na fila</Link>
                )}
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Histórico</h2>
            <ol className="cartao divide-y divide-zinc-100">
              {(eventos ?? []).length === 0 && <li className="p-3 text-sm text-zinc-500">Nada registrado ainda.</li>}
              {(eventos ?? []).map((e) => (
                <li key={e.id} className="space-y-0.5 p-3 text-sm">
                  <div className="text-xs text-zinc-500">
                    <b className="text-zinc-700">{TIPOS_EVENTO[e.tipo] ?? e.tipo}</b> · {dataHora(e.feito_em)} · {e.feito_por ? nomes.get(e.feito_por) ?? "equipe" : "robô"}
                  </div>
                  {e.texto && <p className="line-clamp-4 whitespace-pre-line text-zinc-800">{e.texto}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
