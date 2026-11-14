"use client";

// Filtros da fila de respostas (David, 14/11/26: revisão mais rápida). Ficam
// na URL e o servidor filtra a fila inteira, não só as 40 da tela.
import Link from "next/link";
import { useRouter } from "next/navigation";

export type ContagemFila = {
  total: number;
  urgentes: number;
  conversas: number;
  procedimentos: [string, number][];
  videos: { id: string; titulo: string; n: number }[];
};
export type FiltroFila = { f: "" | "urgente" | "conversa"; proc: string; video: string };

function url(filtro: FiltroFila) {
  const p = new URLSearchParams({ aba: "fila" });
  if (filtro.f) p.set("f", filtro.f);
  if (filtro.proc) p.set("proc", filtro.proc);
  if (filtro.video) p.set("video", filtro.video);
  return `/youtube?${p}`;
}

export default function FiltrosFila({ contagem, filtro }: { contagem: ContagemFila; filtro: FiltroFila }) {
  const router = useRouter();
  const chips: [FiltroFila["f"], string, number][] = [
    ["", "Todas", contagem.total],
    ["urgente", "Urgentes", contagem.urgentes],
    ["conversa", "Continuação de conversa", contagem.conversas],
  ];
  const algum = filtro.f || filtro.proc || filtro.video;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {chips.map(([f, rotulo, n]) => (
        <Link key={f || "todas"} href={url({ ...filtro, f })} aria-current={filtro.f === f ? "true" : undefined}
          className={`rounded-full border px-3 py-1 ${filtro.f === f ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400"}`}>
          {rotulo} <span className="tabular-nums opacity-70">{n}</span>
        </Link>
      ))}
      <label className="sr-only" htmlFor="filtro-proc">Procedimento</label>
      <select id="filtro-proc" className="campo w-auto py-1" value={filtro.proc} onChange={(e) => router.push(url({ ...filtro, proc: e.target.value }))}>
        <option value="">Todos os procedimentos</option>
        {contagem.procedimentos.map(([p, n]) => <option key={p} value={p}>{p} ({n})</option>)}
      </select>
      <label className="sr-only" htmlFor="filtro-video">Vídeo</label>
      <select id="filtro-video" className="campo w-auto max-w-[18rem] py-1" value={filtro.video} onChange={(e) => router.push(url({ ...filtro, video: e.target.value }))}>
        <option value="">Todos os vídeos</option>
        {contagem.videos.map((v) => <option key={v.id} value={v.id}>{v.titulo.length > 60 ? `${v.titulo.slice(0, 58)}…` : v.titulo} ({v.n})</option>)}
      </select>
      {algum && <Link href="/youtube?aba=fila" className="text-xs text-zinc-500 underline">limpar filtros</Link>}
    </div>
  );
}
