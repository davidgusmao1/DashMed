import Link from "next/link";
import { clientesDe, supabaseServidor, usuarioAtual } from "@/lib/supabase/server";
import { dataHora } from "@/lib/conteudo";
import NovoConteudo from "./novo-conteudo";

// Conteúdos para mídias sociais (David, 10/11/26): assunto → referências →
// roteiro de ~15 min → vídeo com o avatar do médico.
const PASSO_PESQUISA: Record<string, string> = {
  nao_iniciada: "Referências: não buscadas",
  buscando: "Referências: buscando…",
  pronta: "Referências prontas",
  erro: "Referências: erro",
};
const PASSO_ROTEIRO: Record<string, string> = {
  estrutura: "Roteiro: planejando…",
  escrevendo: "Roteiro: escrevendo…",
  pronto: "Roteiro pronto",
  erro: "Roteiro: parou",
};
const PASSO_VIDEO: Record<string, string> = {
  enviando: "Vídeo: enviando…",
  processando: "Vídeo: na HeyGen…",
  pronto: "Vídeo pronto",
  falhou: "Vídeo: falhou",
};

export default async function Conteudos() {
  const eu = await usuarioAtual();
  if (!eu) return null;
  const { emFoco } = await clientesDe(eu);
  if (!emFoco) return <p className="text-sm text-zinc-500">Nenhum cliente cadastrado.</p>;
  const supabase = await supabaseServidor();
  const { data: conteudos } = await supabase.from("conteudos")
    .select("id, assunto, pesquisa_estado, criado_em, atualizado_em")
    .eq("cliente_id", emFoco.id).is("deleted_at", null).order("criado_em", { ascending: false }).limit(100);
  const ids = (conteudos ?? []).map((c) => c.id);
  const [{ data: roteiros }, { data: videos }] = ids.length
    ? await Promise.all([
      supabase.from("roteiros").select("id, conteudo_id, versao, estado").in("conteudo_id", ids).is("deleted_at", null).order("versao", { ascending: false }),
      supabase.from("videos").select("roteiro_id, estado, criado_em").eq("cliente_id", emFoco.id).is("deleted_at", null).order("criado_em", { ascending: false }).limit(500),
    ])
    : [{ data: [] }, { data: [] }];
  // o roteiro mais novo de cada conteúdo e o vídeo mais novo de cada roteiro
  const roteiroDe = new Map<string, { id: string; versao: number; estado: string }>();
  for (const r of roteiros ?? []) if (!roteiroDe.has(r.conteudo_id)) roteiroDe.set(r.conteudo_id, r);
  const videoDe = new Map<string, string>();
  for (const v of videos ?? []) if (!videoDe.has(v.roteiro_id)) videoDe.set(v.roteiro_id, v.estado);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Conteúdos para mídias sociais</h1>
        <p className="text-sm text-zinc-500">Assunto → referências médicas → roteiro de ~15 minutos → vídeo com o seu avatar.</p>
      </div>
      <NovoConteudo />
      <div className="space-y-2">
        {(conteudos ?? []).length === 0 && <p className="text-sm text-zinc-500">Nenhum conteúdo ainda. Comece pelo assunto acima.</p>}
        {(conteudos ?? []).map((c) => {
          const r = roteiroDe.get(c.id);
          const v = r ? videoDe.get(r.id) : undefined;
          const passos = [PASSO_PESQUISA[c.pesquisa_estado], r && `${PASSO_ROTEIRO[r.estado]} (v${r.versao})`, v && PASSO_VIDEO[v]].filter(Boolean);
          return (
            <Link key={c.id} href={`/conteudos/${c.id}`} className="cartao block p-4 transition hover:border-zinc-300">
              <div className="font-medium">{c.assunto}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                {passos.map((p) => <span key={p as string}>{p}</span>)}
                <span className="text-zinc-400">criado em {dataHora(c.criado_em)}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
