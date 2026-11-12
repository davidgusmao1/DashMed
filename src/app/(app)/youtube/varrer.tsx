"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { dataHora, minutosDesde } from "@/lib/conteudo";
import { chamarFuncao } from "@/lib/funcoes";
import type { Varredura } from "@/lib/youtube";

const PASSO: Record<string, string> = {
  ler_novos: "lendo comentários novos",
  ler_historico: "lendo comentários antigos",
  triar: "a IA está triando os comentários",
  redigir: "a IA está escrevendo as respostas",
};

export default function Varrer({ clienteId, v, podeVarrer }: { clienteId: string; v: Varredura | null; podeVarrer: boolean }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const rodando = v?.estado === "rodando";
  const parada = rodando && minutosDesde(v!.atualizado_em) >= 5;

  async function varrer() {
    setOcupado(true);
    setAviso(null);
    const r = await chamarFuncao("youtube-varrer", { acao: "varrer", cliente_id: clienteId });
    setOcupado(false);
    if (!r.ok) setAviso(r.erro);
    router.refresh();
  }

  return (
    <div className="cartao flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
      <div className="min-w-0 space-y-0.5">
        {rodando ? (
          <div className="flex items-center gap-2 font-medium">
            <LoaderCircle size={16} className="animate-spin text-teal-700" /> Varredura andando: {PASSO[v!.passo ?? ""] ?? "trabalhando"}…
          </div>
        ) : v?.estado === "erro" ? (
          <div className="font-medium">A última varredura parou com erro.</div>
        ) : (
          <div className="font-medium">{v?.terminada_em ? `Última varredura: ${dataHora(v.terminada_em)}` : "Nenhuma varredura ainda."}</div>
        )}
        {v?.msg && <div className="text-zinc-600">{v.msg}</div>}
        {parada && <div className="text-xs text-zinc-500">Sem avanço há {minutosDesde(v!.atualizado_em)} min; se travou, o sistema marca erro em até 15 min.</div>}
        {v && (
          <div className="text-xs text-zinc-500">
            {v.lidos_total} comentário(s) lido(s) no total ·{" "}
            {v.historico_completo ? "histórico do canal lido por inteiro" : v.historico_ate ? `histórico lido até ${dataHora(v.historico_ate)}` : "histórico ainda não começou"}
          </div>
        )}
        {aviso && <div className="text-zinc-900">{aviso}</div>}
      </div>
      {podeVarrer && (
        <button className="botao" onClick={varrer} disabled={ocupado || (rodando && minutosDesde(v!.atualizado_em) < 15)}>
          {ocupado ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />} Varrer agora
        </button>
      )}
    </div>
  );
}
