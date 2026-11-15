"use client";

// Barra de busca do YouTube Seller (David, 15/11/26: "um campo de busca com
// uma lupinha ... buscar comentário da semana passada que contenha pedido sobre
// prótese, sobre dor"; e depois: "a minha intenção é que ela busque
// comentários do YouTube"). Duas etapas: a IA traduz a frase em critérios, e a
// edge busca direto no YouTube com eles, trazendo para o DashMed o que ainda
// não estava. Então a página mostra a busca no banco, que já tem tudo. Sem a
// IA, dá para buscar só pelas palavras; sem o YouTube, a tela diz o motivo e
// mostra o que já estava no DashMed (regra 2).
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { History, LoaderCircle, Search, X } from "lucide-react";
import { type FiltroBusca, filtroSoPalavras, hrefBusca, normalizarFiltro, type ResumoYoutube } from "@/lib/busca-youtube";
import { chamarFuncao } from "@/lib/funcoes";

// buscas recentes: conveniência deste navegador
const CHAVE_RECENTES = "dashmed:youtube:buscas-recentes";
const EXEMPLOS = [
  "comentários do vídeo da minha última quarta",
  "comentários da semana passada que falam de prótese ou de dor",
  "quem pediu para marcar consulta este mês",
  "alta chance de cirurgia nos últimos 30 dias",
  "dor depois da prótese, mais curtidos primeiro",
];

function lerRecentes(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_RECENTES) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}
function guardarRecente(frase: string) {
  try {
    localStorage.setItem(CHAVE_RECENTES, JSON.stringify([frase, ...lerRecentes().filter((x) => x !== frase)].slice(0, 8)));
  } catch {
    /* navegador sem armazenamento: só não lembra */
  }
}

/** Busca direto no YouTube com os critérios; nunca falha calada: o motivo volta no resumo. */
async function perguntarAoYoutube(clienteId: string, filtro: FiltroBusca): Promise<ResumoYoutube> {
  const r = await chamarFuncao<{ youtube: ResumoYoutube }>("youtube-responder", { acao: "buscar_youtube", cliente_id: clienteId, filtro });
  return r.ok ? r.dados.youtube : { erro: r.erro };
}

/** Na página de resultado: buscar no YouTube de novo com os critérios desta página. */
export function BotaoBuscarNoYoutube({ clienteId, q, filtro, obs, rotulo }: { clienteId: string; q: string | null; filtro: FiltroBusca; obs: string | null; rotulo: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  return (
    <button type="button" className="botao-claro" disabled={ocupado} onClick={async () => {
      setOcupado(true);
      const yt = await perguntarAoYoutube(clienteId, filtro);
      setOcupado(false);
      router.replace(hrefBusca({ q, filtro, obs, yt }));
    }}>
      {ocupado ? <><LoaderCircle size={14} className="animate-spin" /> Buscando no YouTube…</> : <><Search size={14} /> {rotulo}</>}
    </button>
  );
}

export default function BarraBusca({ clienteId, inicial }: { clienteId: string; inicial: string }) {
  const router = useRouter();
  const [texto, setTexto] = useState(inicial);
  const [fase, setFase] = useState<"" | "entendendo" | "youtube">("");
  const ocupado = fase !== "";
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [recentes, setRecentes] = useState<string[]>([]);
  const caixa = useRef<HTMLFormElement>(null);

  useEffect(() => setTexto(inicial), [inicial]);
  useEffect(() => {
    function fora(e: MouseEvent) { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); }
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  async function irParaResultado(q: string, filtro: FiltroBusca, obs: string | null) {
    setFase("youtube");
    const yt = await perguntarAoYoutube(clienteId, filtro);
    setFase("");
    router.push(hrefBusca({ q, filtro, obs, yt }));
  }

  async function buscar(frase: string) {
    const f = frase.replace(/\s+/g, " ").trim();
    if (f.length < 2 || ocupado) return;
    setTexto(f);
    setAberto(false);
    setErro(null);
    setFase("entendendo");
    const r = await chamarFuncao<{ filtro: unknown; observacao: string | null }>("youtube-responder", { acao: "buscar", cliente_id: clienteId, texto: f });
    if (!r.ok) {
      setFase("");
      setErro(r.erro);
      return;
    }
    const filtro = normalizarFiltro(r.dados.filtro);
    if (!filtro) {
      setFase("");
      setErro("A IA não achou nenhum critério nessa frase. Tente dizer o período, o assunto ou o vídeo.");
      return;
    }
    guardarRecente(f);
    await irParaResultado(f, filtro, r.dados.observacao);
  }

  async function soPalavras() {
    const filtro = filtroSoPalavras(texto);
    if (!filtro) {
      setErro("Não sobrou palavra para buscar (use palavras de 3 letras ou mais).");
      return;
    }
    setErro(null);
    await irParaResultado(texto.trim(), filtro, "Busca só pelas palavras da frase, sem a IA.");
  }

  const sugestoes = [...recentes.map((t) => ({ t, recente: true })), ...EXEMPLOS.filter((x) => !recentes.includes(x)).map((t) => ({ t, recente: false }))];

  return (
    <div className="space-y-2">
      <form ref={caixa} className="relative flex gap-2" role="search" onSubmit={(e) => { e.preventDefault(); buscar(texto); }}>
        <div className="relative flex-1">
          <label htmlFor="busca-comentarios" className="sr-only">Buscar comentários</label>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            id="busca-comentarios" type="search" data-1p-ignore autoComplete="off" maxLength={300}
            className="campo pl-9" value={texto} disabled={ocupado}
            placeholder="Buscar comentários: “da semana passada que falam de prótese ou dor”"
            onChange={(e) => setTexto(e.target.value)}
            onFocus={() => { setRecentes(lerRecentes()); setAberto(true); }}
            onKeyDown={(e) => { if (e.key === "Escape") setAberto(false); }}
          />
          {aberto && !texto.trim() && (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm shadow-lg">
              <li className="px-3 pt-2 text-xs text-zinc-500">Busca direto no YouTube e no que já está no DashMed. Escreva do seu jeito: período, assunto, vídeo, tipo de comentário, porcentagens. Por exemplo:</li>
              {sugestoes.slice(0, 10).map((s) => (
                <li key={s.t}>
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-50" onClick={() => buscar(s.t)}>
                    {s.recente ? <History size={14} className="shrink-0 text-zinc-400" /> : <Search size={14} className="shrink-0 text-zinc-300" />}
                    <span className="min-w-0 truncate">{s.t}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="submit" className="botao shrink-0" disabled={ocupado || texto.trim().length < 2}>
          {ocupado ? <><LoaderCircle size={14} className="animate-spin" /> {fase === "youtube" ? "Buscando no YouTube…" : "Entendendo…"}</> : <><Search size={14} /> Buscar</>}
        </button>
        {inicial && !ocupado && (
          <button type="button" className="botao-claro shrink-0" title="Limpar a busca" onClick={() => { setTexto(""); router.push("/youtube?aba=busca"); }}>
            <X size={14} /><span className="sr-only">Limpar a busca</span>
          </button>
        )}
      </form>
      {erro && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900">
          <span>Não consegui entender a busca: {erro}</span>
          <button type="button" className="botao-claro" onClick={soPalavras}>Buscar só pelas palavras</button>
        </div>
      )}
    </div>
  );
}
