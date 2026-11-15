// As três porcentagens da triagem ao lado da de sempre (David, 15/11/26:
// "consulta, porcentagem. Depois, cirurgia, porcentagem. E aí depois é uma
// avaliação socioeconômica ... de 0 a 100%"). A de sempre (sem rótulo) é a
// chance de consulta ou procedimento e continua decidindo quem vira lead.
// Sem "use client": serve na fila (cliente) e nas páginas do servidor.
import type { Comentario } from "@/lib/youtube";

type ComPorcentagens = Pick<Comentario, "consulta_pct" | "cirurgia_pct" | "socio_pct" | "socio_motivo">;

function Pct({ rotulo, valor, dica }: { rotulo: string; valor: string; dica: string }) {
  return (
    <span title={dica} className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700">
      {rotulo} <b className="font-semibold text-zinc-900">{valor}</b>
    </span>
  );
}

/** Nada enquanto a varredura não calculou (comentário triado antes da 0019). */
export default function Porcentagens({ c }: { c: ComPorcentagens }) {
  if (c.consulta_pct == null) return null;
  return (
    <>
      <Pct rotulo="Consulta" valor={`${c.consulta_pct}%`} dica="Chance de marcar uma consulta" />
      <Pct rotulo="Cirurgia" valor={`${c.cirurgia_pct ?? 0}%`} dica="Chance de fazer uma cirurgia, pelo que o texto sugere (não é indicação médica)" />
      <Pct
        rotulo="Socioeconômica"
        valor={c.socio_pct == null ? "—" : `${c.socio_pct}%`}
        dica={c.socio_pct == null
          ? "O texto é curto demais para estimar"
          : `Estimativa pela escrita${c.socio_motivo ? `: ${c.socio_motivo}` : ""}. Só para você; não muda a resposta.`}
      />
    </>
  );
}
