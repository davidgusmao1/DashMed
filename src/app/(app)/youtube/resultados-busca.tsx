// Resultado da busca por frase (15/11/26). Cada critério que o banco usou vira
// uma etiqueta com ×: o médico confere o que a IA entendeu e tira o que não
// queria (regras 3 e 4). Sem "use client": roda no servidor.
import Link from "next/link";
import { X } from "lucide-react";
import { etiquetasDoFiltro, type FiltroBusca, hrefBusca, POR_PAGINA, regexDeRealce, semCriterio } from "@/lib/busca-youtube";
import { ROTULO_CATEGORIA } from "@/lib/youtube";
import ListaComentarios, { type ItemComentario } from "./lista-comentarios";

export default function ResultadosBusca(p: {
  q: string | null; obs: string | null; filtro: FiltroBusca; total: number; itens: ItemComentario[]; pagina: number;
  titulos: Record<string, string>; faltamPorcentagens: number; videoSemComentario: boolean;
}) {
  const etiquetas = etiquetasDoFiltro(p.filtro, { videos: p.titulos, categorias: ROTULO_CATEGORIA });
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
        {p.faltamPorcentagens > 0 && (
          <p className="text-xs text-zinc-600">
            {p.faltamPorcentagens} comentário(s) antigo(s) ainda não têm as porcentagens (a varredura calcula aos poucos) e ficam de fora dos critérios de consulta, cirurgia e socioeconômica.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <b>{p.total === 0 ? "Nenhum comentário encontrado" : `${p.total} comentário(s) encontrado(s)`}</b>
        {p.total > POR_PAGINA && <span className="text-xs text-zinc-500">Mostrando {primeiro}–{ultimo}</span>}
      </div>
      <ListaComentarios itens={p.itens} realce={regexDeRealce(p.filtro)} vazio={p.videoSemComentario
        ? "A varredura ainda não leu nenhum comentário deste vídeo. Se ele é novo, rode a varredura; se foi uma live, a conversa ao vivo fica no chat, não nos comentários. Se você queria outro vídeo, diga qual (ex.: “Quarta do Quadril #223”)."
        : "Tire um critério (no × da etiqueta) ou escreva a busca de outro jeito."} />
      {paginas > 1 && (
        <div className="flex items-center justify-between text-sm">
          {p.pagina > 1 ? <Link className="botao-claro" href={hrefBusca({ q: p.q, filtro: p.filtro, obs: p.obs, pagina: p.pagina - 1 })}>← Anteriores</Link> : <span />}
          <span className="text-xs text-zinc-500">Página {p.pagina} de {paginas}</span>
          {p.pagina < paginas ? <Link className="botao-claro" href={hrefBusca({ q: p.q, filtro: p.filtro, obs: p.obs, pagina: p.pagina + 1 })}>Próximos →</Link> : <span />}
        </div>
      )}
    </div>
  );
}
