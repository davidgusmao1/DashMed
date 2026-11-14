"use client";

// LGPD (David, 14/11/26, seguindo as recomendações): a pessoa pede para sair e
// o administrador anonimiza o lead. Não tem volta, por isso pede o código do
// lead digitado. O que a função faz está em anonimizar_lead() (0018).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { anonimizarLead } from "../../acoes";

export default function Anonimizar({ leadId, codigo }: { leadId: string; codigo: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [digitado, setDigitado] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const confere = digitado.trim().toUpperCase() === codigo.toUpperCase();

  async function anonimizar() {
    setOcupado(true);
    const r = await anonimizarLead(leadId);
    setOcupado(false);
    setAviso({ ok: r.ok, texto: r.msg });
    if (r.ok) { setAberto(false); router.refresh(); }
  }

  return (
    <section className="cartao space-y-3 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} /> LGPD: a pessoa pediu para apagar os dados?</div>
      {!aberto ? (
        <button type="button" className="botao-claro" onClick={() => setAberto(true)}>Anonimizar este lead</button>
      ) : (
        <div className="space-y-2 text-sm">
          <p>No DashMed, apaga de vez: nome, foto, canal, telefone, anotações, o texto dos comentários, das respostas e do histórico, e os valores antigos na auditoria. Respostas na fila são canceladas e novos comentários desta pessoa deixam de ser lidos.</p>
          <p>Ficam só números sem identificação (etapa, procedimento, datas) para o funil. <b>Não apaga nada no YouTube</b>: o comentário público é da pessoa (ela apaga lá, ou você remove pelo YouTube Studio). O cadastro de paciente ligado, se houver, não muda.</p>
          <label className="rotulo" htmlFor="confirma-codigo">Para confirmar, digite o código do lead ({codigo})</label>
          <input id="confirma-codigo" className="campo" value={digitado} onChange={(e) => setDigitado(e.target.value)} autoComplete="off" data-1p-ignore />
          <div className="flex gap-2">
            <button type="button" className="botao" disabled={!confere || ocupado} onClick={anonimizar}>
              {ocupado ? <><LoaderCircle size={14} className="animate-spin" /> Anonimizando…</> : "Anonimizar de vez"}
            </button>
            <button type="button" className="botao-claro" disabled={ocupado} onClick={() => { setAberto(false); setDigitado(""); }}>Cancelar</button>
          </div>
        </div>
      )}
      {aviso && <p className={`rounded-lg px-3 py-2 text-sm ${aviso.ok ? "bg-teal-50 text-teal-900" : "bg-zinc-100 text-zinc-900"}`}>{aviso.texto}</p>}
    </section>
  );
}
