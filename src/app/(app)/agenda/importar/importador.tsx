"use client";

// Importação em duas etapas: (1) a DashMed lê a planilha e mostra o que achou,
// sem gravar; (2) a pessoa confere e confirma, e tudo entra numa transação só
// (ou entra tudo, ou nada).
//
// Dois tipos de lista, reconhecidos pelas colunas:
// - INDICAÇÕES: quem teve tratamento indicado (vira terapia no CRM/Agenda);
// - REALIZADOS (com "Data de Realização"): quem já fez — tira do resgate quem
//   operou, dá a data do AH e marca o lado que falta (David, 11/11/26). A
//   prévia já cruza com o CRM no banco e desfaz.
import Link from "next/link";
import { useState, useTransition } from "react";
import { importarPlanilha, previaImportacao, type NumerosRealizados, type Previa, type Resultado } from "../acoes";

type PreviaOk = Extract<Previa, { ok: true }>;

function ListaDeErros({ erros, rotulo }: { erros: { linha: number; motivo: string }[]; rotulo: string }) {
  if (!erros.length) return null;
  return (
    <details className="text-xs text-zinc-700">
      <summary className="cursor-pointer">{rotulo}</summary>
      <ul className="mt-1 space-y-0.5">
        {erros.slice(0, 100).map((e, i) => <li key={`${e.linha}-${i}`}>linha {e.linha}: {e.motivo}</li>)}
        {erros.length > 100 && <li>… e mais {erros.length - 100}</li>}
      </ul>
    </details>
  );
}

/** O que a lista de realizados faz no CRM (na prévia e no resultado). */
function NumerosDoCruzamento({ n, mesesAh }: { n: NumerosRealizados; mesesAh: number }) {
  const semPaciente = n.erros.filter((e) => e.motivo === "paciente não está no CRM");
  const outros = n.erros.filter((e) => e.motivo !== "paciente não está no CRM");
  return (
    <div className="space-y-2 text-sm">
      <p><b>{n.pacientes_encontrados}</b> pacientes da lista estão no CRM · <b>{n.sem_paciente}</b> linhas de quem não está no CRM (ficam de fora, nada é criado)</p>
      <ul className="space-y-1 text-zinc-700">
        <li>🩺 <b>{n.cirurgias_concluidas}</b> terapias de cirurgia saem da lista de ligação (já operaram)</li>
        <li>💉 <b>{n.ah_com_data}</b> AH ganham a data da última aplicação: <b>{n.ah_vencidos}</b> já passaram de {mesesAh} meses e voltam para &quot;A contatar&quot; (renovação); <b>{n.ah_em_dia}</b> ainda estão no prazo e ficam em &quot;Realizado&quot;</li>
        <li>↔️ <b>{n.lado_pendente}</b> com indicação bilateral e só um lado feito: continuam em &quot;A contatar&quot;, marcadas &quot;falta o outro lado&quot;</li>
        {n.outras_realizadas > 0 && <li>✔️ <b>{n.outras_realizadas}</b> de Hidrogel/PRP/BMAC feitos passam para &quot;Realizado&quot;</li>}
        {n.sem_terapia > 0 && <li>📝 <b>{n.sem_terapia}</b> realizações de procedimento que o paciente não tinha indicado no CRM (ex.: ATJ): ficam só registradas na ficha</li>}
        {n.outras_terapias_de_operados > 0 && <li>⚠️ <b>{n.outras_terapias_de_operados}</b> terapias ainda a contatar de pacientes que já fizeram ATQ (ex.: AH): continuam na lista — vale o médico olhar</li>}
        {n.mexidas_por_pessoa > 0 && <li>👤 <b>{n.mexidas_por_pessoa}</b> cartões que alguém já mexeu: a data entra, mas a etapa não muda</li>}
        <li className="text-xs text-zinc-500">{n.realizacoes_novas} realizações novas · {n.ja_existiam} já estavam registradas · {n.etapas_mudadas} cartões mudam de coluna</li>
      </ul>
      <ListaDeErros erros={semPaciente} rotulo={`${semPaciente.length} linhas de pacientes que não estão no CRM (nº da linha na planilha)`} />
      <ListaDeErros erros={outros} rotulo={`${outros.length} linhas com outro problema`} />
    </div>
  );
}

export default function Importador({ cliente }: { cliente: string }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<PreviaOk | null>(null);
  const [mesesAh, setMesesAh] = useState("6");
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Extract<Resultado, { ok: true }> | null>(null);
  const [ocupado, iniciar] = useTransition();

  function ler(f: File | null, meses = mesesAh) {
    setArquivo(f); setPrevia(null); setErro(null); setResultado(null);
    if (!f) return;
    const fd = new FormData();
    fd.set("arquivo", f);
    fd.set("meses_ah", meses);
    iniciar(async () => {
      const r = await previaImportacao(fd);
      if (r.ok) setPrevia(r); else setErro(r.texto);
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
      if (r.ok) { setResultado(r); setPrevia(null); } else setErro(r.texto);
    });
  }

  if (resultado) {
    return (
      <div className="cartao space-y-3 p-6 text-sm">
        <p className="font-semibold text-teal-800">Importação concluída.</p>
        {resultado.tipo === "indicacoes" ? (
          <ul className="space-y-0.5 text-zinc-700">
            <li>{resultado.pacientes_novos} pacientes novos</li>
            <li>{resultado.terapias_novas} terapias novas ({resultado.para_revisar} para revisar)</li>
            <li>{resultado.indicacoes_novas} indicações novas</li>
            <li>{resultado.ja_existiam} linhas que já estavam na DashMed (não duplicaram)</li>
            {resultado.com_erro > 0 && <li>{resultado.com_erro} linhas com erro ficaram de fora (veja no histórico abaixo)</li>}
          </ul>
        ) : (
          <NumerosDoCruzamento n={resultado.numeros} mesesAh={Number(mesesAh) || 6} />
        )}
        <div className="flex flex-wrap gap-2">
          <Link href="/crm" className="botao">Ver o CRM</Link>
          <Link href="/agenda" className="botao-claro">Ver a Agenda</Link>
          <button className="botao-claro" onClick={() => ler(null)}>Importar outra</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="cartao space-y-2 p-5">
        <label className="rotulo" htmlFor="arquivo">Planilha (.xlsx ou .csv)</label>
        <input id="arquivo" type="file" accept=".xlsx,.csv" disabled={ocupado}
          onChange={(e) => ler(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium" />
        <p className="text-xs text-zinc-500">
          <b>Indicações:</b> Paciente, Data e Procedimento (ou Categoria); usadas se existirem: Hora, Telefones, E-mail, Idade, Trecho do prontuário, Vencimento.
          {" "}<b>Já realizados:</b> Paciente, Data de Realização e Procedimento — tira do CRM quem já fez.
        </p>
      </div>

      {ocupado && !previa && <p className="text-sm text-zinc-500">Lendo a planilha…</p>}
      {erro && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900">{erro}</p>}

      {previa?.tipo === "realizados" && (
        <form onSubmit={importar} className="space-y-4">
          <div className="cartao space-y-2 p-5 text-sm">
            <p className="font-semibold">Lista de procedimentos já realizados</p>
            <p>
              <b>{previa.resumo.linhas}</b> realizações de <b>{previa.resumo.pacientes}</b> pacientes
              {" "}({previa.resumo.porFamilia.map((f) => `${f.nome} ${f.n}`).join(" · ")})
              {previa.resumo.daColunaExtra > 0 && <> · {previa.resumo.daColunaExtra} da lista ao lado (BMAC)</>}
            </p>
            <p className="text-xs text-zinc-500">
              {previa.resumo.bilaterais} bilaterais · {previa.resumo.unilaterais} unilaterais · o resto sem lado escrito. Visco (viscossuplementação) conta como AH;
              {" "}&quot;Visco BMAC&quot;, &quot;AH e Hidrogel&quot; etc. contam para os dois. O paciente é achado pelo nome (a lista não tem nascimento).
            </p>
            <ListaDeErros erros={previa.resumo.erros} rotulo={`${previa.resumo.erros.length} linhas que não consegui ler`} />
          </div>

          <div className="cartao space-y-3 p-5">
            <div className="text-sm font-semibold">O que muda no CRM (prévia, nada foi gravado)</div>
            <NumerosDoCruzamento n={previa.numeros} mesesAh={previa.mesesAh} />
            <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
              <label htmlFor="meses_ah" className="text-sm">Renovar o AH depois de</label>
              <input id="meses_ah" name="meses_ah" type="number" min={1} max={60} step={1} value={mesesAh}
                onChange={(e) => setMesesAh(e.target.value)} className="campo w-20" />
              <span className="text-sm">meses</span>
              {Number(mesesAh) !== previa.mesesAh && (
                <button type="button" className="botao-claro" disabled={ocupado} onClick={() => ler(arquivo)}>Recalcular prévia</button>
              )}
            </div>
          </div>

          <button className="botao" disabled={ocupado || Number(mesesAh) !== previa.mesesAh}>
            {ocupado ? "Gravando…" : `Gravar no CRM de ${cliente}`}
          </button>
        </form>
      )}

      {previa?.tipo === "indicacoes" && (() => {
        const resumo = previa.resumo;
        return (
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
              <ListaDeErros erros={resumo.erros} rotulo={`${resumo.erros.length} linhas com erro vão ficar de fora`} />
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
        );
      })()}
    </div>
  );
}
