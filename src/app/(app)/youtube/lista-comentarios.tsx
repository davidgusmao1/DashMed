// Lista de comentários lidos: a aba "Comentários lidos" e o resultado da busca
// (15/11/26). Na busca, as palavras achadas aparecem marcadas. Com `acoes`,
// cada comentário ganha os botões de responder (responder-comentario.tsx).
// Sem "use client": roda no servidor.
import Link from "next/link";
import { dataHora } from "@/lib/conteudo";
import { pedacosRealcados } from "@/lib/busca-youtube";
import { LINK_VIDEO, ROTULO_CATEGORIA } from "@/lib/youtube";
import Porcentagens from "./porcentagens";
import ResponderComentario, { type ParaResponder } from "./responder-comentario";

const RESPOSTA: Record<string, string> = {
  nenhuma: "sem resposta", redigir: "IA vai escrever", rascunho: "na fila", publicando: "publicando…",
  publicada: "respondido", falhou: "na fila (problema)", ignorada: "ignorado",
};

export type ItemComentario = Partial<ParaResponder> & {
  id: string;
  comentario_id: string;
  video_id: string;
  video_titulo: string | null;
  autor_nome: string;
  texto: string;
  publicado_em: string;
  triagem: string;
  probabilidade: number | null;
  categoria: string | null;
  urgente: boolean;
  resposta: string;
  ja_respondido: boolean;
  lead_id: string | null;
  conversa_de?: string | null;
  resumo?: string | null;
  codigo?: string | null;
  consulta_pct?: number | null;
  cirurgia_pct?: number | null;
  socio_pct?: number | null;
  socio_motivo?: string | null;
};

const achou = (texto: string, rx: RegExp) => pedacosRealcados(texto, rx).some((p) => p.marca);

function Texto({ texto, realce }: { texto: string; realce: RegExp | null }) {
  return (
    <>
      {pedacosRealcados(texto, realce).map((p, i) => (p.marca
        ? <mark key={i} className="rounded bg-amber-100 px-0.5 text-zinc-900">{p.t}</mark>
        : <span key={i}>{p.t}</span>))}
    </>
  );
}

/** Para os botões de responder: o canal (para a confirmação) e o título dos vídeos que a IA indicou. */
export type AcoesLista = { canal: string; clienteId: string; titulosVideos: Record<string, string> };

export default function ListaComentarios({ itens, realce = null, vazio, acoes }: { itens: ItemComentario[]; realce?: RegExp | null; vazio: string; acoes?: AcoesLista }) {
  return (
    <div className="cartao divide-y divide-zinc-100">
      {itens.length === 0 && <p className="p-5 text-sm text-zinc-500">{vazio}</p>}
      {itens.map((c) => (
        <div key={c.id} className="space-y-1 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
            <b className="text-zinc-800">{c.autor_nome}</b>
            <span>{dataHora(c.publicado_em)}</span>
            {c.triagem === "feita" ? (
              <>
                <span title="Chance de marcar consulta ou procedimento (decide quem vira lead)" className="rounded bg-teal-50 px-1 font-semibold text-teal-800">{c.probabilidade ?? 0}%</span>
                <Porcentagens c={c} />
                <span>{ROTULO_CATEGORIA[c.categoria ?? ""] ?? c.categoria}</span>
              </>
            ) : <span>{c.triagem === "erro" ? "triagem falhou" : "aguardando triagem"}</span>}
            {c.urgente && <span className="font-semibold text-zinc-900">urgente</span>}
            {c.conversa_de && <span className="font-semibold text-zinc-800">↳ continuação da conversa</span>}
            <span>· {c.ja_respondido && c.resposta !== "publicada" ? "você respondeu no YouTube" : RESPOSTA[c.resposta] ?? c.resposta}</span>
            {c.lead_id && <Link href={`/youtube/leads/${c.lead_id}`} className="underline">{c.codigo ? `lead ${c.codigo}` : "lead"}</Link>}
            <a href={LINK_VIDEO(c.video_id, c.comentario_id)} target="_blank" rel="noreferrer" className="truncate hover:underline">{c.video_titulo ?? "vídeo"}</a>
          </div>
          <p className="line-clamp-4 whitespace-pre-line text-zinc-800"><Texto texto={c.texto} realce={realce} /></p>
          {/* a busca olha também o resumo da IA (pega comentário em outra língua): mostra quando foi ele que bateu */}
          {realce && c.resumo && !achou(c.texto, realce) && achou(c.resumo, realce) && (
            <p className="text-xs text-zinc-500">Resumo da IA: <Texto texto={c.resumo} realce={realce} /></p>
          )}
          {acoes && (
            <ResponderComentario c={c as ParaResponder} canal={acoes.canal} clienteId={acoes.clienteId}
              videoIndicado={c.video_sugerido ? acoes.titulosVideos[c.video_sugerido] ?? null : null} />
          )}
        </div>
      ))}
    </div>
  );
}
