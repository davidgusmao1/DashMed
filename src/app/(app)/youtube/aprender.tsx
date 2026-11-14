"use client";

// Aprender com as edições (David, 14/11/26). Quando o médico publica uma
// resposta diferente da que a IA sugeriu, a edição entra na conta. Aqui a IA
// compara sugestão × publicado, propõe regras com o motivo e exemplos, e o
// médico escolhe o que vira treinamento (nada entra sem ele aprovar).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GraduationCap, LoaderCircle, Sparkles, X } from "lucide-react";
import { chamarFuncao } from "@/lib/funcoes";
import { salvarTreino } from "./acoes";

type Proposta = { texto: string; motivo: string; exemplos: { comentario: string; sugestao: string; publicado: string }[] };

export default function AprenderEdicoes({ clienteId, edicoesNovas, podeTreinar }: { clienteId: string; edicoesNovas: number; podeTreinar: boolean }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [analisando, setAnalisando] = useState(false);
  const [propostas, setPropostas] = useState<(Proposta & { usar: boolean })[] | null>(null);
  const [analisadas, setAnalisadas] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  async function analisar() {
    setAberto(true);
    setAnalisando(true);
    setAviso(null);
    setPropostas(null);
    const r = await chamarFuncao<{ propostas: Proposta[]; analisadas: number }>("youtube-responder", { acao: "aprender", cliente_id: clienteId });
    setAnalisando(false);
    if (!r.ok) return setAviso({ ok: false, texto: r.erro });
    setAnalisadas(r.dados.analisadas);
    setPropostas(r.dados.propostas.map((p) => ({ ...p, usar: true })));
  }

  async function salvar() {
    if (!propostas) return;
    setSalvando(true);
    let salvos = 0;
    const erros: string[] = [];
    for (const p of propostas.filter((x) => x.usar && x.texto.trim())) {
      const r = await salvarTreino(clienteId, p.texto, "edicao", null);
      if (r.ok) salvos++;
      else erros.push(r.msg);
    }
    setSalvando(false);
    if (erros.length) return setAviso({ ok: false, texto: `${salvos} salvo(s); ${erros.length} com erro: ${erros[0]}` });
    setAviso({ ok: true, texto: salvos ? `${salvos} treinamento(s) salvo(s). Valem para as próximas triagens e respostas.` : "Nada salvo." });
    setPropostas(null);
    router.refresh();
  }

  function fechar() {
    setAberto(false);
    setPropostas(null);
    setAviso(null);
    router.refresh();
  }

  if (!podeTreinar || edicoesNovas < 1) return null;

  return (
    <>
      <div className="cartao flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <div className="flex items-center gap-2">
          <GraduationCap size={18} className="text-teal-700" />
          <span>Você editou <b>{edicoesNovas}</b> resposta(s) antes de publicar. A IA pode aprender o seu jeito com elas.</span>
        </div>
        <button className="botao" onClick={analisar}><Sparkles size={14} /> Aprender com minhas edições</button>
      </div>

      {aberto && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="titulo-aprender"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !analisando && !salvando) fechar(); }}>
          <div className="cartao max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="titulo-aprender" className="flex items-center gap-2 text-lg font-semibold"><GraduationCap size={20} /> Aprender com as suas edições</h2>
                <p className="text-sm text-zinc-600">A IA comparou o que ela sugeriu com o que você publicou. Escolha o que vira treinamento; você pode ajustar o texto de cada regra.</p>
              </div>
              <button type="button" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" onClick={fechar} disabled={analisando || salvando} aria-label="Fechar"><X size={18} /></button>
            </div>

            {analisando && (
              <p className="flex items-center gap-2 rounded-lg bg-zinc-50 p-3 text-sm"><LoaderCircle size={16} className="animate-spin text-teal-700" /> Comparando as suas edições… leva até 1 minuto.</p>
            )}

            {propostas && propostas.length === 0 && (
              <p className="rounded-lg bg-zinc-50 p-3 text-sm">
                Analisei {analisadas} edição(ões) e não achei um padrão claro — pareciam ajustes de cada caso. Continue editando; quando houver mais, tento de novo.
              </p>
            )}

            {propostas && propostas.length > 0 && (
              <>
                <p className="text-xs text-zinc-500">{analisadas} edição(ões) analisada(s) · {propostas.length} regra(s) proposta(s)</p>
                <ul className="space-y-3">
                  {propostas.map((p, i) => (
                    <li key={i} className={`space-y-2 rounded-lg border p-3 ${p.usar ? "border-teal-200 bg-teal-50/40" : "border-zinc-200 opacity-70"}`}>
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input type="checkbox" className="accent-teal-700" checked={p.usar}
                          onChange={(e) => setPropostas((ps) => ps!.map((x, j) => (j === i ? { ...x, usar: e.target.checked } : x)))} />
                        Salvar como treinamento
                      </label>
                      <textarea className="campo" rows={2} value={p.texto} aria-label={`Regra ${i + 1}`}
                        onChange={(e) => setPropostas((ps) => ps!.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))} />
                      <p className="text-xs text-zinc-600"><b>Por quê:</b> {p.motivo}</p>
                      {p.exemplos.length > 0 && (
                        <details className="text-xs text-zinc-600">
                          <summary className="cursor-pointer">Ver exemplo{p.exemplos.length > 1 ? "s" : ""}</summary>
                          {p.exemplos.map((ex, k) => (
                            <div key={k} className="mt-2 space-y-1 rounded-md bg-white p-2">
                              <div><b>Comentário:</b> {ex.comentario}</div>
                              <div><b>A IA sugeriu:</b> {ex.sugestao}</div>
                              <div><b>Você publicou:</b> {ex.publicado}</div>
                            </div>
                          ))}
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <button className="botao" onClick={salvar} disabled={salvando || !propostas.some((p) => p.usar && p.texto.trim().length >= 3)}>
                    {salvando ? <><LoaderCircle size={16} className="animate-spin" /> Salvando…</> : "Salvar selecionadas"}
                  </button>
                  <button className="botao-claro" onClick={fechar} disabled={salvando}>Descartar</button>
                </div>
              </>
            )}

            {aviso && <p className={`rounded-lg px-3 py-2 text-sm ${aviso.ok ? "bg-teal-50 text-teal-900" : "bg-zinc-100 text-zinc-900"}`}>{aviso.texto}</p>}
            {aviso?.ok && <button className="botao-claro" onClick={fechar}>Fechar</button>}
          </div>
        </div>
      )}
    </>
  );
}
