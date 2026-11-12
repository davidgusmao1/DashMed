"use client";

// Janela "Treinamento da IA" (David, 12/11/26). O médico escreve ou fala o que
// a IA deve aprender; fica gravado em seller_treinos até ele desativar e vale
// para todas as próximas triagens e respostas. Opcionalmente refaz na hora a
// resposta do comentário em que ele estava.
import { useEffect, useState } from "react";
import { GraduationCap, LoaderCircle, X } from "lucide-react";
import CampoVoz from "./campo-voz";
import { salvarTreino } from "./acoes";

export default function JanelaTreino({ clienteId, comentarioId, comentario, rascunho, editado, aoFechar, aoSalvar }: {
  clienteId: string;
  comentarioId: string | null;
  comentario?: string;
  rascunho?: string;
  editado?: boolean;
  aoFechar: () => void;
  /** depois de salvar; refazer = o médico quer a resposta deste comentário refeita */
  aoSalvar?: (refazer: boolean, trocarEdicao: boolean) => Promise<void> | void;
}) {
  const [texto, setTexto] = useState("");
  const [voz, setVoz] = useState(false);
  const [refazer, setRefazer] = useState(!!comentarioId);
  const [trocarEdicao, setTrocarEdicao] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !ocupado) aoFechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aoFechar, ocupado]);

  async function salvar() {
    setOcupado(true);
    setAviso(null);
    const r = await salvarTreino(clienteId, texto, voz ? "voz" : "texto", comentarioId);
    if (!r.ok) {
      setOcupado(false);
      return setAviso({ ok: false, texto: r.msg });
    }
    setAviso({ ok: true, texto: refazer ? `${r.msg} Refazendo esta resposta…` : r.msg });
    if (aoSalvar) await aoSalvar(refazer, trocarEdicao);
    setOcupado(false);
    aoFechar();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="titulo-treino"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupado) aoFechar(); }}>
      <div className="cartao max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="titulo-treino" className="flex items-center gap-2 text-lg font-semibold"><GraduationCap size={20} /> Treinamento da IA</h2>
            <p className="text-sm text-zinc-600">
              Diga como quer que a IA responda daqui para frente. Fica gravado e vale para todas as próximas triagens e respostas, até você desativar em Configurações → YouTube Seller.
            </p>
          </div>
          <button type="button" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" onClick={aoFechar} disabled={ocupado} aria-label="Fechar"><X size={18} /></button>
        </div>

        {(comentario || rascunho) && (
          <details className="rounded-lg bg-zinc-50 p-3 text-sm">
            <summary className="cursor-pointer text-xs font-medium text-zinc-600">Ver o comentário e a resposta atual</summary>
            {comentario && <p className="mt-2 whitespace-pre-line text-zinc-700"><b>Comentário:</b> {comentario}</p>}
            {rascunho && <p className="mt-2 whitespace-pre-line text-zinc-700"><b>Resposta atual:</b> {rascunho}</p>}
          </details>
        )}

        <CampoVoz id="texto-treino" valor={texto} aoMudar={setTexto} aoUsarVoz={() => setVoz(true)} linhas={6}
          placeholder={"Ex.: Comece sempre agradecendo a pergunta. Para tendinite do glúteo médio, explique que o tratamento costuma começar sem cirurgia. Não fale de SUS; diga que a consulta é particular."} />
        <div className="text-xs text-zinc-400">{texto.length} / 2.000 caracteres · uma orientação clara por treinamento funciona melhor</div>

        {comentarioId && (
          <div className="space-y-1 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="accent-teal-700" checked={refazer} onChange={(e) => setRefazer(e.target.checked)} />
              Refazer a resposta deste comentário já com este treinamento
            </label>
            {refazer && editado && (
              <label className="ml-6 flex items-center gap-2 text-zinc-600">
                <input type="checkbox" className="accent-teal-700" checked={trocarEdicao} onChange={(e) => setTrocarEdicao(e.target.checked)} />
                Você editou esta resposta: trocar o seu texto pela nova
              </label>
            )}
          </div>
        )}

        {aviso && <p className={`rounded-lg px-3 py-2 text-sm ${aviso.ok ? "bg-teal-50 text-teal-900" : "bg-zinc-100 text-zinc-900"}`}>{aviso.texto}</p>}

        <div className="flex flex-wrap gap-2">
          <button className="botao" onClick={salvar} disabled={ocupado || texto.trim().length < 3 || (refazer && !!editado && !trocarEdicao)}>
            {ocupado ? <><LoaderCircle size={16} className="animate-spin" /> Salvando…</> : "Salvar treinamento"}
          </button>
          <button className="botao-claro" onClick={aoFechar} disabled={ocupado}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
