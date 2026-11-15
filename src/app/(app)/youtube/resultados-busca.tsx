// Resultado da busca por frase (15/11/26). Cada critério que o banco usou vira
// uma etiqueta com ×: o médico confere o que a IA entendeu e tira o que não
// queria (regras 3 e 4). Sem "use client": roda no servidor.
import Link from "next/link";
import { X } from "lucide-react";
import { etiquetasDoFiltro, type FiltroBusca, hrefBusca, POR_PAGINA, regexDeRealce, type ResumoYoutube, semCriterio } from "@/lib/busca-youtube";
import { ORDENS_FILA, ROTULO_CATEGORIA } from "@/lib/youtube";
import { BotaoBuscarNoYoutube } from "./busca";
import ListaComentarios, { type AcoesLista, type ItemComentario } from "./lista-comentarios";
import Ordenar from "./ordenar";

// as ordens que o banco sabe fazer (buscar_comentarios, 0020); "recentes" é a de sempre
const ORDENS_BUSCA = [
  ...ORDENS_FILA.filter((o) => o.id).map((o) => ({ id: o.id as string, rotulo: o.rotulo as string })),
  { id: "probabilidade", rotulo: "Maior chance de virar paciente" },
  { id: "curtidas", rotulo: "Mais curtidos primeiro" },
];

/** O que a busca direto no YouTube fez, ou por que não fez (regra 2). */
function NoYoutube({ yt, clienteId, q, filtro, obs }: { yt: ResumoYoutube | null; clienteId: string; q: string | null; filtro: FiltroBusca; obs: string | null }) {
  const botao = (rotulo: string) => <BotaoBuscarNoYoutube clienteId={clienteId} q={q} filtro={filtro} obs={obs} rotulo={rotulo} />;
  if (!yt) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
        <span>Os critérios mudaram depois da busca no YouTube: a lista mostra só o que já está no DashMed.</span>
        {botao("Buscar também no YouTube")}
      </div>
    );
  }
  if ("erro" in yt) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-900">
        <span>Não consegui buscar no YouTube agora: {yt.erro} A lista mostra só o que já estava no DashMed.</span>
        {botao("Tentar no YouTube de novo")}
      </div>
    );
  }
  return (
    <div className="space-y-1 text-xs text-zinc-600">
      {yt.paginas > 0 && (
        <p>
          <b className="text-zinc-900">No YouTube agora:</b> {yt.achados} comentário(s) com essas palavras, vídeo ou período
          {yt.achados > 0 && (yt.novos ? `; ${yt.novos} ainda não estavam no DashMed e foram trazidos.` : "; todos já estavam no DashMed.")}
          {" "}A lista abaixo junta tudo e aplica todos os critérios.
        </p>
      )}
      {yt.aviso && <p>{yt.aviso}</p>}
      {yt.limite.length > 0 && (
        <p>Parei no limite de páginas em: {yt.limite.join(", ")}. Há comentários mais antigos no YouTube; diga um período (“em 2025”, “em março”) para ir mais fundo.</p>
      )}
      {yt.novos > 0 && (
        <p>Os que vieram agora aparecem como “aguardando triagem”: a IA tria na próxima varredura (botão Varrer agora). Até lá, tipo, porcentagens e lead não valem para eles.</p>
      )}
      <div>{botao("Buscar no YouTube de novo")}</div>
    </div>
  );
}

export default function ResultadosBusca(p: {
  clienteId: string; q: string | null; obs: string | null; filtro: FiltroBusca; total: number; itens: ItemComentario[]; pagina: number;
  titulos: Record<string, string>; faltamPorcentagens: number; videoSemComentario: boolean; yt: ResumoYoutube | null; acoes: AcoesLista;
}) {
  // a ordem tem o seletor próprio; as etiquetas ficam só para os critérios
  const etiquetas = etiquetasDoFiltro(p.filtro, { videos: p.titulos, categorias: ROTULO_CATEGORIA }).filter((e) => e.chave !== "ordem");
  const ordens = ORDENS_BUSCA.map((o) => ({
    ...o,
    // mudar a ordem não muda os critérios: o que veio do YouTube continua valendo
    href: hrefBusca({ q: p.q, filtro: { ...p.filtro, ordem: o.id === "recentes" ? undefined : o.id }, obs: p.obs, yt: p.yt }),
  }));
  const paginas = Math.max(1, Math.ceil(p.total / POR_PAGINA));
  const primeiro = p.total ? (p.pagina - 1) * POR_PAGINA + 1 : 0;
  const ultimo = Math.min(p.total, p.pagina * POR_PAGINA);
  const nGrupos = p.filtro.grupos?.length ?? 0;
  return (
    <div className="space-y-3">
      <div className="cartao space-y-2 p-4 text-sm">
        {p.q && <div className="text-zinc-500">Você buscou: <span className="text-zinc-900">“{p.q}”</span></div>}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-zinc-500">Critérios usados:</span>
          {etiquetas.map((e) => {
            const resto = semCriterio(p.filtro, e.chave);
            return (
              <span key={e.chave} className="inline-flex max-w-full items-center gap-1 rounded-full bg-zinc-100 py-0.5 pl-2.5 pr-1 text-xs text-zinc-800">
                <span className="min-w-0 truncate">{e.texto}</span>
                <Link href={resto ? hrefBusca({ q: p.q, filtro: resto }) : "/youtube?aba=busca"} className="rounded-full p-0.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900" title="Tirar este critério">
                  <X size={12} /><span className="sr-only">Tirar o critério {e.texto}</span>
                </Link>
              </span>
            );
          })}
          {nGrupos > 1 && (
            <Link href={hrefBusca({ q: p.q, filtro: { ...p.filtro, todos: !p.filtro.todos } })} className="text-xs text-teal-800 underline">
              {p.filtro.todos ? "Aceitar qualquer um dos assuntos" : "Exigir todos os assuntos no mesmo comentário"}
            </Link>
          )}
        </div>
        {p.obs && <p className="text-xs text-zinc-600">{p.obs}</p>}
        <NoYoutube yt={p.yt} clienteId={p.clienteId} q={p.q} filtro={p.filtro} obs={p.obs} />
        {p.faltamPorcentagens > 0 && (
          <p className="text-xs text-zinc-600">
            {p.faltamPorcentagens} comentário(s) antigo(s) ainda não têm as porcentagens (a varredura calcula aos poucos) e ficam de fora dos critérios de consulta, cirurgia e socioeconômica (e no fim, quando a ordem é por elas).
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          <b>{p.total === 0 ? "Nenhum comentário encontrado" : `${p.total} comentário(s) encontrado(s)`}</b>
          {p.total > POR_PAGINA && <span className="ml-2 text-xs text-zinc-500">Mostrando {primeiro}–{ultimo}</span>}
        </span>
        {p.total > 1 && <Ordenar id="ordem-busca" valor={p.filtro.ordem ?? "recentes"} opcoes={ordens} />}
      </div>
      <ListaComentarios itens={p.itens} realce={regexDeRealce(p.filtro)} acoes={p.acoes} vazio={!p.videoSemComentario
        ? "Tire um critério (no × da etiqueta) ou escreva a busca de outro jeito."
        : p.yt && !("erro" in p.yt)
          ? "Este vídeo não tem comentário, nem no YouTube nem no DashMed. Se foi uma live, a conversa ao vivo fica no chat, não nos comentários. Se você queria outro vídeo, diga qual (ex.: “Quarta do Quadril #223”)."
          : "O DashMed ainda não tem comentário deste vídeo. Busque no YouTube (botão acima); se foi uma live, a conversa ao vivo fica no chat, não nos comentários."} />
      {paginas > 1 && (
        <div className="flex items-center justify-between text-sm">
          {p.pagina > 1 ? <Link className="botao-claro" href={hrefBusca({ q: p.q, filtro: p.filtro, obs: p.obs, pagina: p.pagina - 1, yt: p.yt })}>← Anteriores</Link> : <span />}
          <span className="text-xs text-zinc-500">Página {p.pagina} de {paginas}</span>
          {p.pagina < paginas ? <Link className="botao-claro" href={hrefBusca({ q: p.q, filtro: p.filtro, obs: p.obs, pagina: p.pagina + 1, yt: p.yt })}>Próximos →</Link> : <span />}
        </div>
      )}
    </div>
  );
}
