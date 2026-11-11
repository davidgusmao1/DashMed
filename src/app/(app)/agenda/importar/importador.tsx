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
        <div className="flex flex-wrap gap-2">
          <Link href="/crm" className="botao">Ver o CRM</Link>
          <Link href="/agenda" className="botao-claro">Ver a Agenda</Link>
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
            <p>
              <b>{resumo.validas}</b> terapias indicadas · <b>{resumo.pacientes}</b> pacientes ({resumo.comTelefone} com telefone)
              {resumo.candidatos > 0 && <> · <b>{resumo.candidatos}</b> de candidatos</>}
              {resumo.paraRevisar - resumo.candidatos > 0 && <> · <b>{resumo.paraRevisar - resumo.candidatos}</b> para revisar</>}
            </p>
            {resumo.abas.filter(Boolean).length > 0 && <p className="text-xs text-zinc-500">Abas lidas: {resumo.abas.join(", ")}</p>}
            <p className="text-xs text-zinc-500">Colunas encontradas: {resumo.colunas.map((c) => c.titulo).join(", ")}</p>
            <p className="text-xs text-zinc-500">Uma linha com mais de um procedimento (ex.: &quot;ATQ/MAKO, AH&quot;) vira uma terapia para cada. Candidatos e indicações incertas entram marcados.</p>
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
              <div className="text-sm font-semibold">Prazo até o vencimento (opcional)</div>
              <p className="text-xs text-zinc-500">
                Em meses, a partir da data da indicação, para a <b>Agenda de renovação</b> (ex.: AH). Em branco = sem vencimento: o paciente
                entra só no <b>CRM de resgate</b> (é o caso das cirurgias). 0 = já entra vencido. Depois dá para mudar a data de cada um.
              </p>
            </div>
            {resumo.procedimentos.map((p) => (
              <div key={p.nome} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <label htmlFor={`prazo:${p.nome}`} className="w-44 shrink-0 text-sm">
                  {p.nome} <span className="text-xs text-zinc-500">({p.linhas}{p.realizados ? `, ${p.realizados} já aplicados` : ""})</span>
                </label>
                {p.semVencimento > 0 ? (
                  <>
                    <input id={`prazo:${p.nome}`} name={`prazo:${p.nome}`} type="number" min={0} max={120} step={1} placeholder="—"
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
