import { LINK_VIDEO } from "@/lib/youtube";

// Funil do YouTube Seller (David, 14/11/26): de comentário a tratamento, no
// total, por vídeo e por procedimento. Os números vêm de funil_youtube() (0014).
export type Funil = {
  totais: { comentarios: number; leads: number; respondidos: number; contato: number; agendado: number; tratamento: number; perdidos: number };
  por_video: { video_id: string; titulo: string | null; comentarios: number; leads: number; respondidos: number; contato: number; agendado: number; tratamento: number }[];
  por_procedimento: { procedimento: string; leads: number; contato: number; agendado: number; tratamento: number }[];
};

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default function Resultados({ funil }: { funil: Funil }) {
  const t = funil.totais;
  const etapas = [
    { rotulo: "Comentários lidos", valor: t.comentarios, de: null as number | null },
    { rotulo: "Leads", valor: t.leads, de: t.comentarios },
    { rotulo: "Respondidos", valor: t.respondidos, de: t.leads },
    { rotulo: "Entraram em contato", valor: t.contato, de: t.respondidos },
    { rotulo: "Consulta agendada", valor: t.agendado, de: t.contato },
    { rotulo: "Em tratamento", valor: t.tratamento, de: t.agendado },
  ];
  const maximo = Math.max(1, ...etapas.map((e) => e.valor));

  return (
    <div className="space-y-6">
      <section className="cartao space-y-3 p-5">
        <h2 className="text-sm font-semibold">Funil — do comentário ao tratamento</h2>
        <ol className="space-y-2">
          {etapas.map((e) => (
            <li key={e.rotulo} className="grid grid-cols-[9.5rem_1fr] items-center gap-3 text-sm sm:grid-cols-[12rem_1fr]">
              <span className="text-zinc-600">{e.rotulo}</span>
              <div className="flex items-center gap-2" title={`${e.rotulo}: ${e.valor}${e.de != null ? ` (${pct(e.valor, e.de)} da etapa anterior)` : ""}`}>
                <div className="h-5 min-w-[2px] rounded-r-[4px] bg-teal-600" style={{ width: `${Math.max(0.5, (e.valor / maximo) * 100)}%` }} />
                <span className="shrink-0 font-semibold tabular-nums text-zinc-900">{e.valor}</span>
                {e.de != null && <span className="shrink-0 text-xs tabular-nums text-zinc-500">{pct(e.valor, e.de)}</span>}
              </div>
            </li>
          ))}
        </ol>
        <p className="text-xs text-zinc-500">
          O percentual é sobre a etapa anterior. &quot;Entraram em contato&quot; e &quot;consulta&quot; dependem de a equipe registrar na ficha do lead quando a pessoa chama com o código.
          {t.perdidos ? ` ${t.perdidos} lead(s) marcados como perdidos.` : ""}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Por vídeo (os 25 que mais geraram leads)</h2>
        <div className="cartao overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-zinc-500">
              <tr className="border-b border-zinc-100">
                <th className="px-3 py-2 font-medium">Vídeo</th>
                <th className="px-3 py-2 text-right font-medium">Comentários</th>
                <th className="px-3 py-2 text-right font-medium">Leads</th>
                <th className="px-3 py-2 text-right font-medium">Respondidos</th>
                <th className="px-3 py-2 text-right font-medium">Contato</th>
                <th className="px-3 py-2 text-right font-medium">Consulta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 tabular-nums">
              {funil.por_video.map((v) => (
                <tr key={v.video_id}>
                  <td className="max-w-[22rem] px-3 py-2"><a href={LINK_VIDEO(v.video_id)} target="_blank" rel="noreferrer" className="line-clamp-2 hover:underline">{v.titulo ?? v.video_id}</a></td>
                  <td className="px-3 py-2 text-right">{v.comentarios}</td>
                  <td className="px-3 py-2 text-right font-semibold">{v.leads}</td>
                  <td className="px-3 py-2 text-right">{v.respondidos}</td>
                  <td className="px-3 py-2 text-right">{v.contato}</td>
                  <td className="px-3 py-2 text-right">{v.agendado}</td>
                </tr>
              ))}
              {funil.por_video.length === 0 && <tr><td colSpan={6} className="px-3 py-3 text-zinc-500">Nenhum comentário lido ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Por procedimento</h2>
        <div className="cartao overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="text-left text-xs text-zinc-500">
              <tr className="border-b border-zinc-100">
                <th className="px-3 py-2 font-medium">Procedimento</th>
                <th className="px-3 py-2 text-right font-medium">Leads</th>
                <th className="px-3 py-2 text-right font-medium">Contato</th>
                <th className="px-3 py-2 text-right font-medium">Consulta</th>
                <th className="px-3 py-2 text-right font-medium">Tratamento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 tabular-nums">
              {funil.por_procedimento.map((p) => (
                <tr key={p.procedimento}>
                  <td className="px-3 py-2">{p.procedimento}</td>
                  <td className="px-3 py-2 text-right font-semibold">{p.leads}</td>
                  <td className="px-3 py-2 text-right">{p.contato}</td>
                  <td className="px-3 py-2 text-right">{p.agendado}</td>
                  <td className="px-3 py-2 text-right">{p.tratamento}</td>
                </tr>
              ))}
              {funil.por_procedimento.length === 0 && <tr><td colSpan={5} className="px-3 py-3 text-zinc-500">Nenhum lead com procedimento ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
