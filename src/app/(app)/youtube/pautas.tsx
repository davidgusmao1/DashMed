"use client";

// Pautas (David, 14/11/26: perguntas frequentes viram conteúdo): a IA agrupa
// as perguntas dos comentários em temas de vídeo; a equipe escolhe o que vira
// conteúdo em "Conteúdos para mídias sociais".
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExternalLink, Lightbulb, LoaderCircle } from "lucide-react";
import { dataHora } from "@/lib/conteudo";
import { chamarFuncao } from "@/lib/funcoes";
import { LINK_VIDEO } from "@/lib/youtube";
import { criarConteudoDaPauta, descartarPauta } from "./acoes";

export type Pauta = {
  id: string; titulo: string; porque: string; procedimento: string | null; comentarios: number; conteudo_id: string | null; criado_em: string;
  exemplos: { id: string; texto: string; link: string | null }[];
};

function CartaoPauta({ p }: { p: Pauta }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<"criar" | "descartar" | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function criar() {
    setOcupado("criar");
    const r = await criarConteudoDaPauta(p.id);
    if (!r.ok || !r.conteudoId) { setOcupado(null); return setAviso(r.msg); }
    router.push(`/conteudos/${r.conteudoId}`);
  }
  async function descartar() {
    setOcupado("descartar");
    const r = await descartarPauta(p.id);
    setOcupado(null);
    if (!r.ok) setAviso(r.msg);
    router.refresh();
  }

  return (
    <li className="cartao space-y-2 p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="font-semibold">{p.titulo}</h3>
        <span className="text-xs text-zinc-500">{p.comentarios} comentário(s) perguntam isto</span>
        {p.procedimento && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700">{p.procedimento}</span>}
      </div>
      {p.porque && <p className="text-sm text-zinc-700">{p.porque}</p>}
      {p.exemplos.length > 0 && (
        <ul className="space-y-1 border-l-2 border-zinc-200 pl-3 text-xs text-zinc-600">
          {p.exemplos.map((e) => (
            <li key={e.id}>
              <span className="line-clamp-2">“{e.texto}”</span>
              {e.link && <a href={e.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-zinc-500 underline">ver no YouTube <ExternalLink size={10} /></a>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {p.conteudo_id ? (
          <Link href={`/conteudos/${p.conteudo_id}`} className="botao-claro">Abrir o conteúdo</Link>
        ) : (
          <>
            <button className="botao" onClick={criar} disabled={!!ocupado}>
              {ocupado === "criar" ? <><LoaderCircle size={14} className="animate-spin" /> Criando…</> : "Criar conteúdo"}
            </button>
            <button className="botao-claro" onClick={descartar} disabled={!!ocupado}>{ocupado === "descartar" ? "…" : "Descartar"}</button>
          </>
        )}
      </div>
      {aviso && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900">{aviso}</p>}
    </li>
  );
}

export default function Pautas({ clienteId, pautas }: { clienteId: string; pautas: Pauta[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const novas = pautas.filter((p) => !p.conteudo_id);
  const usadas = pautas.filter((p) => p.conteudo_id);

  async function achar() {
    setOcupado(true);
    setAviso(null);
    const r = await chamarFuncao<{ mensagem: string }>("youtube-responder", { acao: "pautas", cliente_id: clienteId });
    setOcupado(false);
    setAviso(r.ok ? { ok: true, texto: r.dados.mensagem } : { ok: false, texto: r.erro });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="cartao flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <div className="min-w-0 space-y-0.5">
          <div className="font-medium">O que o público mais pergunta, em temas de vídeo</div>
          <p className="text-zinc-600">
            A IA lê as dúvidas dos comentários triados e agrupa as que se repetem. Você escolhe as que viram conteúdo.
            {novas.length > 0 && ` Uma nova análise troca as ${novas.length} pauta(s) abaixo que ainda não viraram conteúdo.`}
          </p>
          {pautas[0] && <p className="text-xs text-zinc-500">Última análise: {dataHora(pautas.reduce((a, p) => (p.criado_em > a ? p.criado_em : a), pautas[0].criado_em))}</p>}
        </div>
        <button className="botao" onClick={achar} disabled={ocupado}>
          {ocupado ? <><LoaderCircle size={16} className="animate-spin" /> Lendo as perguntas… (até 2 min)</> : <><Lightbulb size={16} /> Achar pautas</>}
        </button>
      </div>
      {aviso && <p className={`rounded-lg px-3 py-2 text-sm ${aviso.ok ? "bg-teal-50 text-teal-900" : "bg-zinc-100 text-zinc-900"}`}>{aviso.texto}</p>}

      {novas.length === 0 && usadas.length === 0 && !ocupado && (
        <p className="cartao p-5 text-sm text-zinc-500">Nenhuma pauta ainda. Clique em &quot;Achar pautas&quot;.</p>
      )}
      {novas.length > 0 && <ul className="space-y-3">{novas.map((p) => <CartaoPauta key={p.id} p={p} />)}</ul>}
      {usadas.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Já viraram conteúdo</h2>
          <ul className="space-y-3">{usadas.map((p) => <CartaoPauta key={p.id} p={p} />)}</ul>
        </section>
      )}
    </div>
  );
}
