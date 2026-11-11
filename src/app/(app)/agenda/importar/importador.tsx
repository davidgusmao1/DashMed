"use client";

// Importação em duas etapas: (1) a DashMed lê a planilha e mostra o que achou,
// sem gravar; (2) a pessoa digita o prazo de cada procedimento e confirma, e
// tudo entra numa transação só (ou entra tudo, ou nada).
import Link from "next/link";
import { useState, useTransition } from "react";
import { importarPlanilha, previaImportacao, type Resultado } from "../acoes";
import type { Resumo } from "@/lib/planilha";

export default function Importador({ cliente }: { cliente: string }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Extract<Resultado, { ok: true }> | null>(null);
  const [ocupado, iniciar] = useTransition();

  function escolher(f: File | null) {
    setArquivo(f); setResumo(null); setErro(null); setResultado(null);
    if (!f) return;
    const fd = new FormData();
    fd.set("arquivo", f);
    iniciar(async () => {
      const r = await previaImportacao(fd);
      if (r.ok) setResumo(r.resumo); else setErro(r.texto);
    });
  }

  function importar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!arquivo) return;
    const fd = new FormData(e.currentTarget);
    fd.set("arquivo", arquivo);
    setErro(null);
    iniciar(async () => {
      const r = await importarPlanilha(fd);
      if (r.ok) { setResultado(r); setResumo(null); } else setErro(r.texto);
    });
  }

  if (resultado) {
    return (
      <div className="cartao space-y-3 p-6 text-sm">
        <p className="font-semibold text-teal-800">Importação concluída.</p>
        <ul className="space-y-0.5 text-zinc-700">
          <li>{resultado.pacientes_novos} pacientes novos</li>
          <li>{resultado.terapias_novas} terapias novas ({resultado.para_revisar} para revisar)</li>
          <li>{resultado.indicacoes_novas} indicações novas</li>
          <li>{resultado.ja_existiam} linhas que já estavam na DashMed (não duplicaram)</li>
          {resultado.com_erro > 0 && <li>{resultado.com_erro} linhas com erro ficaram de fora (veja no histórico abaixo)</li>}
        </ul>
        <div className="flex gap-2">
          <Link href="/agenda" className="botao">Ver a Agenda</Link>
          <button className="botao-claro" onClick={() => escolher(null)}>Importar outra</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="cartao space-y-2 p-5">
        <label className="rotulo" htmlFor="arquivo">Planilha (.xlsx ou .csv)</label>
        <input id="arquivo" type="file" accept=".xlsx,.csv" disabled={ocupado}
          onChange={(e) => escolher(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium" />
        <p className="text-xs text-zinc-500">
          Colunas obrigatórias: Paciente, Data e Procedimento. Usadas se existirem: Horário, Tipo atendimento, Trecho evolução, Telefone e Vencimento.
        </p>
      </div>

      {ocupado && !resumo && <p className="text-sm text-zinc-500">Lendo a planilha…</p>}
      {erro && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900">{erro}</p>}

      {resumo && (
        <form onSubmit={importar} className="space-y-4">
          <div className="cartao space-y-2 p-5 text-sm">
            <p><b>{resumo.validas}</b> linhas válidas · <b>{resumo.pacientes}</b> pacientes · <b>{resumo.paraRevisar}</b> marcadas para revisar</p>
            <p className="text-xs text-zinc-500">Colunas encontradas: {resumo.colunas.map((c) => c.titulo).join(", ")}</p>
            {resumo.erros.length > 0 && (
              <details className="text-xs text-zinc-700">
                <summary className="cursor-pointer">{resumo.erros.length} linhas com erro vão ficar de fora</summary>
                <ul className="mt-1 space-y-0.5">
                  {resumo.erros.slice(0, 50).map((e) => <li key={e.linha}>linha {e.linha}: {e.motivo}</li>)}
                  {resumo.erros.length > 50 && <li>… e mais {resumo.erros.length - 50}</li>}
                </ul>
              </details>
            )}
          </div>

          <div className="cartao space-y-3 p-5">
            <div>
              <div className="text-sm font-semibold">Prazo até o vencimento</div>
              <p className="text-xs text-zinc-500">Em meses, a partir da data da indicação. 0 = já entra como vencida (chamar logo). Depois dá para mudar a data de cada paciente.</p>
            </div>
            {resumo.procedimentos.map((p) => (
              <div key={p.nome} className="flex items-center gap-3">
                <label htmlFor={`prazo:${p.nome}`} className="w-40 shrink-0 text-sm">
                  {p.nome} <span className="text-xs text-zinc-500">({p.linhas})</span>
                </label>
                {p.semVencimento > 0 ? (
                  <>
                    <input id={`prazo:${p.nome}`} name={`prazo:${p.nome}`} type="number" min={0} max={120} step={1} required
                      className="campo w-24" />
                    <span className="text-xs text-zinc-500">meses</span>
                  </>
                ) : (
                  <span className="text-xs text-zinc-500">vencimento já vem na planilha</span>
                )}
              </div>
            ))}
          </div>

          <button className="botao" disabled={ocupado}>
            {ocupado ? "Importando…" : `Importar ${resumo.validas} linhas para ${cliente}`}
          </button>
        </form>
      )}
    </div>
  );
}
