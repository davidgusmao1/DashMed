"use client";

// Passo 1: referências. A IA monta as buscas e faz a triagem; a lista vem da
// Europe PMC (PubMed, com PMID). O médico depura: marca o que entra no
// roteiro (David, 10/11/26: "uma vez depurado o assunto...").
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { BookOpen, ExternalLink, LoaderCircle, Search } from "lucide-react";
import { type Conteudo, dataHora, linkPubmed, minutosDesde, type Referencia, rotuloEvidencia } from "@/lib/conteudo";
import { chamarFuncao } from "@/lib/funcoes";
import { marcarReferencia } from "../acoes";

type Filtro = "todas" | "marcadas" | "sugeridas";

/** [PMID 123] vira link para o PubMed. */
function Sintese({ texto }: { texto: string }) {
  const partes = texto.split(/(\[PMID\s*\d+\])/g);
  return (
    <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-700">
      {partes.map((p, i) => {
        const m = p.match(/^\[PMID\s*(\d+)\]$/);
        return m ? <a key={i} href={linkPubmed(m[1])} target="_blank" rel="noreferrer" className="text-teal-700 underline">[PMID {m[1]}]</a> : p;
      })}
    </p>
  );
}

function LinhaReferencia({ r, marcada, onMarcar }: { r: Referencia; marcada: boolean; onMarcar: (v: boolean) => void }) {
  const [aberto, setAberto] = useState(false);
  return (
    <li className="flex gap-3 py-3">
      <input type="checkbox" className="mt-1 size-4 shrink-0 accent-teal-700" checked={marcada} onChange={(e) => onMarcar(e.target.checked)} aria-label="Usar no roteiro" />
      <div className="min-w-0 flex-1 space-y-1">
        <a href={linkPubmed(r.pmid)} target="_blank" rel="noreferrer" className="font-medium leading-snug hover:underline">
          {r.titulo} <ExternalLink size={12} className="inline text-zinc-400" />
        </a>
        <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-zinc-500">
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-700">{rotuloEvidencia(r.tipos)}</span>
          {r.ano && <span>{r.ano}</span>}
          {r.revista && <span>{r.revista}</span>}
          <span>{r.citacoes} citações</span>
          {r.acesso_aberto && <span className="text-teal-700">acesso aberto</span>}
          <span>PMID {r.pmid}</span>
          {r.relevancia != null && <span title="relevância segundo a IA">{"★".repeat(r.relevancia)}{"☆".repeat(5 - r.relevancia)}</span>}
          {r.sugerida && <span className="text-teal-700">sugerida pela IA</span>}
        </div>
        {r.nota && <p className="text-sm text-zinc-700">{r.nota}</p>}
        <button className="text-xs text-zinc-500 underline" onClick={() => setAberto(!aberto)}>{aberto ? "esconder resumo" : "ver resumo"}</button>
        {aberto && <p className="rounded-lg bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-600">{r.resumo || "Sem resumo."}</p>}
      </div>
    </li>
  );
}

export default function PassoReferencias({ conteudo, referencias, temChave }: { conteudo: Conteudo; referencias: Referencia[]; temChave: boolean }) {
  const router = useRouter();
  const [aviso, setAviso] = useState<string | null>(null);
  const [disparando, setDisparando] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  // escolha do médico aparece na hora; o banco confirma no refresh
  const [marcacoes, setMarcacoes] = useState<Record<string, boolean>>({});
  const [, iniciar] = useTransition();
  const marcada = (r: Referencia) => marcacoes[r.id] ?? r.selecionada;
  const totalMarcadas = referencias.filter(marcada).length;
  const buscando = conteudo.pesquisa_estado === "buscando";
  const minutos = minutosDesde(conteudo.pesquisa_iniciada_em);

  const visiveis = useMemo(() => referencias.filter((r) =>
    filtro === "todas" ? true : filtro === "sugeridas" ? r.sugerida : (marcacoes[r.id] ?? r.selecionada)), [referencias, filtro, marcacoes]);

  async function buscar() {
    setAviso(null);
    setDisparando(true);
    const r = await chamarFuncao("conteudos-pesquisa", { conteudo_id: conteudo.id });
    setDisparando(false);
    if (!r.ok) setAviso(r.erro);
    router.refresh();
  }

  function marcar(r: Referencia, v: boolean) {
    setMarcacoes((m) => ({ ...m, [r.id]: v }));
    iniciar(async () => {
      const res = await marcarReferencia(r.id, v);
      if (!res?.ok) {
        setMarcacoes((m) => ({ ...m, [r.id]: !v }));
        setAviso(`Não salvou a marcação: ${res?.msg ?? "erro"}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">1. Referências</h2>
          <p className="text-sm text-zinc-500">Artigos do PubMed (via Europe PMC), lidos e avaliados pela IA. Você marca o que entra no roteiro.</p>
        </div>
        <button className="botao" onClick={buscar} disabled={buscando || disparando || !temChave}>
          {buscando || disparando ? <LoaderCircle size={16} className="animate-spin" /> : <Search size={16} />}
          {conteudo.pesquisa_estado === "nao_iniciada" ? "Buscar referências" : "Buscar de novo"}
        </button>
      </div>
      {!temChave && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm">Falta a chave da Claude. <a href="/configuracoes" className="underline">Coloque em Configurações</a>.</p>}
      {aviso && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900">{aviso}</p>}

      {buscando && (
        <div className="cartao flex items-center gap-3 p-4 text-sm">
          <LoaderCircle size={18} className="animate-spin text-teal-700" />
          <div>
            Buscando no PubMed e lendo os resumos… {minutos > 0 && <span className="text-zinc-500">(há {minutos} min)</span>}
            {minutos >= 5 && <div className="text-xs text-zinc-500">Passou do tempo normal. Se travou, o sistema marca erro em até 10 minutos e você busca de novo.</div>}
          </div>
        </div>
      )}
      {conteudo.pesquisa_estado === "erro" && conteudo.pesquisa_msg && (
        <p className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900"><b>A busca não terminou:</b> {conteudo.pesquisa_msg}</p>
      )}
      {conteudo.pesquisa_estado === "pronta" && conteudo.pesquisa_msg && (
        <p className="text-xs text-zinc-500">{conteudo.pesquisa_msg} Terminada em {dataHora(conteudo.pesquisa_terminada_em)}.</p>
      )}

      {conteudo.sintese && (
        <div className="cartao space-y-2 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold"><BookOpen size={16} /> O que a evidência mostra (síntese da IA)</div>
          <Sintese texto={conteudo.sintese} />
          <p className="text-xs text-zinc-400">Confira os números nos artigos antes de gravar ou publicar.</p>
        </div>
      )}

      {conteudo.consultas.length > 0 && (
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer">Buscas usadas ({conteudo.consultas.length})</summary>
          <ul className="mt-2 space-y-1">
            {conteudo.consultas.map((q, i) => <li key={i}><b>{q.descricao}</b> — <code className="break-all">{q.consulta}</code> · {q.encontrados} resultados</li>)}
          </ul>
        </details>
      )}

      {referencias.length > 0 && (
        <div className="cartao p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-3">
            <div className="text-sm"><b>{totalMarcadas}</b> de {referencias.length} marcadas {totalMarcadas < 3 && <span className="text-zinc-500">(marque pelo menos 3 para o roteiro)</span>}</div>
            <div className="flex gap-1 text-xs">
              {(["todas", "sugeridas", "marcadas"] as Filtro[]).map((f) => (
                <button key={f} onClick={() => setFiltro(f)} className={`rounded-md px-2 py-1 ${filtro === f ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700"}`}>{f}</button>
              ))}
            </div>
          </div>
          <ul className="divide-y divide-zinc-100">
            {visiveis.map((r) => <LinhaReferencia key={r.id} r={r} marcada={marcada(r)} onMarcar={(v) => marcar(r, v)} />)}
          </ul>
        </div>
      )}
    </section>
  );
}
