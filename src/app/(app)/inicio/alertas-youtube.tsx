import Link from "next/link";
import { CalendarClock, MessageCircleReply, Siren, Target, TriangleAlert } from "lucide-react";
import { supabaseServidor } from "@/lib/supabase/server";

// Alertas do YouTube Seller no Início (David, 14/11/26, seguindo as
// recomendações): o que está esperando o médico, sem precisar abrir a aba.
// Cada número vem do banco na hora (regra 3) e leva direto para onde resolve.
const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export default async function AlertasYoutube({ clienteId }: { clienteId: string }) {
  const supabase = await supabaseServidor();
  const { data: integ } = await supabase.from("integracoes").select("provedor").eq("cliente_id", clienteId).eq("provedor", "youtube").maybeSingle();
  if (!integ) return null;

  const fila = () => supabase.from("yt_comentarios").select("id", { count: "exact", head: true })
    .eq("cliente_id", clienteId).in("resposta", ["rascunho", "falhou"]).is("deleted_at", null);
  const [urgentes, altaChance, conversas, problemas, atrasados, varredura] = await Promise.all([
    fila().eq("urgente", true),
    fila().gte("probabilidade", 80),
    fila().not("conversa_de", "is", null),
    supabase.from("yt_comentarios").select("id", { count: "exact", head: true }).eq("cliente_id", clienteId).eq("resposta", "falhou").is("deleted_at", null),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("cliente_id", clienteId).is("deleted_at", null)
      .lte("proximo_passo_em", hojeSP()).not("etapa", "in", "(perdido,tratamento)"),
    supabase.from("yt_varreduras").select("estado, msg").eq("cliente_id", clienteId).maybeSingle(),
  ]);
  const erroLeitura = [urgentes, altaChance, conversas, problemas, atrasados].find((r) => r.error)?.error;

  const itens = [
    { id: "urgentes", n: urgentes.count ?? 0, icone: Siren, texto: (n: number) => `${n} comentário(s) urgente(s) esperando resposta`, href: "/youtube?aba=fila&f=urgente" },
    { id: "conversas", n: conversas.count ?? 0, icone: MessageCircleReply, texto: (n: number) => `${n} pessoa(s) responderam à sua resposta`, href: "/youtube?aba=fila&f=conversa" },
    { id: "alta", n: altaChance.count ?? 0, icone: Target, texto: (n: number) => `${n} resposta(s) com chance de 80% ou mais para revisar`, href: "/youtube?aba=fila" },
    { id: "atrasados", n: atrasados.count ?? 0, icone: CalendarClock, texto: (n: number) => `${n} lead(s) com o próximo passo para hoje ou atrasado`, href: "/youtube?aba=leads" },
    { id: "problemas", n: problemas.count ?? 0, icone: TriangleAlert, texto: (n: number) => `${n} resposta(s) com problema para publicar`, href: "/youtube?aba=fila" },
  ].filter((i) => i.n > 0);
  const varreduraComErro = varredura.data?.estado === "erro";

  return (
    <div className="cartao max-w-2xl space-y-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">YouTube Seller · precisa de você</div>
        <Link href="/youtube" className="text-xs text-zinc-500 underline">abrir</Link>
      </div>
      {erroLeitura && <p className="text-sm text-zinc-900">Não consegui ler os alertas: {erroLeitura.message}</p>}
      {varreduraComErro && (
        <Link href="/youtube" className="flex items-start gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-200">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <span>A última varredura parou com erro{varredura.data?.msg ? `: ${varredura.data.msg}` : "."}</span>
        </Link>
      )}
      {itens.length === 0 && !varreduraComErro && !erroLeitura && <p className="text-sm text-zinc-600">Nada esperando por você no YouTube agora.</p>}
      {itens.length > 0 && (
        <ul className="divide-y divide-zinc-100">
          {itens.map((i) => (
            <li key={i.id}>
              <Link href={i.href} className="flex items-center gap-3 py-2 text-sm hover:text-zinc-900">
                <i.icone size={16} className="shrink-0 text-teal-700" aria-hidden />
                <span className="flex-1 text-zinc-800">{i.texto(i.n)}</span>
                <span className="text-xs text-zinc-500 underline">resolver</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
