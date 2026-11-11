"use client";

import { useState, useTransition } from "react";
import { Archive, Pencil } from "lucide-react";
import { dataHora } from "@/lib/conteudo";
import { arquivarConteudo, salvarOrientacoes } from "../acoes";

export default function Cabecalho({ id, assunto, orientacoes, criadoEm }: { id: string; assunto: string; orientacoes: string; criadoEm: string }) {
  const [editando, setEditando] = useState(false);
  const [a, setA] = useState(assunto);
  const [o, setO] = useState(orientacoes);
  const [msg, setMsg] = useState<string | null>(null);
  const [arquivar, setArquivar] = useState(false);
  const [pendente, iniciar] = useTransition();

  if (editando) {
    return (
      <div className="cartao space-y-3 p-5">
        <div>
          <label className="rotulo" htmlFor="assunto">Assunto</label>
          <input id="assunto" className="campo" value={a} maxLength={300} onChange={(e) => setA(e.target.value)} />
        </div>
        <div>
          <label className="rotulo" htmlFor="orientacoes">Orientações para a IA</label>
          <textarea id="orientacoes" className="campo" rows={3} maxLength={2000} value={o} onChange={(e) => setO(e.target.value)} />
        </div>
        <p className="text-xs text-zinc-500">Vale para as próximas buscas e roteiros; o que já foi feito não muda.</p>
        {msg && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm">{msg}</p>}
        <div className="flex gap-2">
          <button className="botao" disabled={pendente} onClick={() => iniciar(async () => {
            const r = await salvarOrientacoes(id, a, o);
            if (r?.ok) { setEditando(false); setMsg(null); } else setMsg(r?.msg ?? "Não salvou.");
          })}>{pendente ? "Salvando…" : "Salvar"}</button>
          <button className="botao-claro" onClick={() => { setEditando(false); setA(assunto); setO(orientacoes); }}>Cancelar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">{assunto}</h1>
      {orientacoes && <p className="whitespace-pre-line text-sm text-zinc-600">{orientacoes}</p>}
      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
        <span>Criado em {dataHora(criadoEm)}</span>
        <button className="inline-flex items-center gap-1 hover:text-zinc-900" onClick={() => setEditando(true)}><Pencil size={12} /> Editar assunto e orientações</button>
        {!arquivar ? (
          <button className="inline-flex items-center gap-1 hover:text-zinc-900" onClick={() => setArquivar(true)}><Archive size={12} /> Arquivar</button>
        ) : (
          <span className="inline-flex items-center gap-2">
            Arquivar este conteúdo?
            <button className="font-semibold text-zinc-900 underline" disabled={pendente} onClick={() => iniciar(async () => { const r = await arquivarConteudo(id); if (r && !r.ok) setMsg(r.msg); })}>Sim, arquivar</button>
            <button className="underline" onClick={() => setArquivar(false)}>Não</button>
          </span>
        )}
      </div>
      {msg && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm">{msg}</p>}
    </div>
  );
}
