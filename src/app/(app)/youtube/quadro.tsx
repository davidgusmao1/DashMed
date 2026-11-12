"use client";

// O CRM do YouTube Seller: uma coluna por etapa do lead. Mudar de etapa vai
// para o histórico do lead sozinho (gatilho no banco).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dataHora } from "@/lib/conteudo";
import { ETAPAS, type Lead } from "@/lib/youtube";
import { moverLead } from "./acoes";

export type CartaoLead = Pick<Lead, "id" | "nome" | "foto_url" | "codigo" | "etapa" | "probabilidade" | "procedimentos" | "proximo_passo_em" | "atualizado_em" | "paciente_id"> & {
  ultimo_comentario: string | null;
};

const LIMITE_COLUNA = 60;

function Cartao({ l }: { l: CartaoLead }) {
  const router = useRouter();
  const [etapa, setEtapa] = useState(l.etapa);
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  return (
    <li className="space-y-1.5 rounded-lg border border-zinc-200 bg-white p-3 text-sm">
      <Link href={`/youtube/leads/${l.id}`} className="flex items-center gap-2 font-medium hover:underline">
        {l.foto_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={l.foto_url} alt="" className="size-6 rounded-full" />
        ) : <span className="size-6 rounded-full bg-zinc-200" />}
        <span className="min-w-0 truncate">{l.nome}</span>
      </Link>
      <div className="flex flex-wrap gap-1 text-xs">
        <span className="font-mono text-zinc-500">{l.codigo}</span>
        <span className="rounded bg-teal-50 px-1 font-semibold text-teal-800">{l.probabilidade}%</span>
        {l.paciente_id && <span className="rounded bg-zinc-900 px-1 text-white">paciente</span>}
        {l.procedimentos.slice(0, 2).map((p) => <span key={p} className="rounded bg-zinc-100 px-1 text-zinc-700">{p}</span>)}
      </div>
      {l.ultimo_comentario && <p className="line-clamp-2 text-xs text-zinc-600">{l.ultimo_comentario}</p>}
      <div className="flex items-center justify-between gap-2">
        <select aria-label="Etapa" className="campo w-auto py-1 text-xs" value={etapa} disabled={pendente}
          onChange={(e) => {
            const nova = e.target.value as Lead["etapa"];
            const antes = etapa;
            setEtapa(nova);
            setErro(null);
            iniciar(async () => {
              const r = await moverLead(l.id, nova);
              if (!r.ok) { setEtapa(antes); setErro(r.msg); } else router.refresh();
            });
          }}>
          {ETAPAS.map((e) => <option key={e.id} value={e.id}>{e.rotulo}</option>)}
        </select>
        {l.proximo_passo_em && <span className="text-[11px] text-zinc-500">próx.: {l.proximo_passo_em.split("-").reverse().join("/")}</span>}
      </div>
      {erro && <p className="text-xs text-zinc-900">{erro}</p>}
      <div className="text-[11px] text-zinc-400">atualizado {dataHora(l.atualizado_em)}</div>
    </li>
  );
}

export default function Quadro({ leads }: { leads: CartaoLead[] }) {
  if (!leads.length) {
    return <p className="cartao p-5 text-sm text-zinc-500">Nenhum lead ainda. Cada pessoa cujo comentário passar da probabilidade mínima vira um lead aqui, com um código (ex.: YT1234) que vai na resposta.</p>;
  }
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {ETAPAS.map((e) => {
        const da = leads.filter((l) => l.etapa === e.id);
        return (
          <div key={e.id} className="w-64 shrink-0 rounded-xl bg-zinc-100 p-2">
            <div className="flex items-center justify-between px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-zinc-600">
              {e.rotulo} <span className="text-zinc-400">{da.length}</span>
            </div>
            <ul className="space-y-2">
              {da.slice(0, LIMITE_COLUNA).map((l) => <Cartao key={l.id + l.etapa} l={l} />)}
            </ul>
            {da.length > LIMITE_COLUNA && <p className="px-1 pt-2 text-xs text-zinc-500">Mostrando {LIMITE_COLUNA} de {da.length} (os de maior probabilidade).</p>}
          </div>
        );
      })}
    </div>
  );
}
