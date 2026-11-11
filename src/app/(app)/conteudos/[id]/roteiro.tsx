"use client";

// Passo 2: roteiro de ~15 minutos, em blocos. A IA escreve um bloco por vez
// (cada um com o seu relógio); o médico edita ou pede para reescrever. Bloco
// editado não é trocado sem ele confirmar (regra 4).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, FileText, LoaderCircle, Pencil, RefreshCw, Sparkles } from "lucide-react";
import {
  type Bloco, citacao, contarPalavras, dataHora, minutosDe, minutosDesde, type Perfil, type Referencia, relogio, type Roteiro,
} from "@/lib/conteudo";
import { chamarFuncao } from "@/lib/funcoes";
import { salvarBloco } from "../acoes";

const META_MINUTOS = 15;

function BotaoCopiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="botao-claro" onClick={async () => {
      try { await navigator.clipboard.writeText(texto); setOk(true); setTimeout(() => setOk(false), 2000); } catch { setOk(false); }
    }}>
      {ok ? <Check size={16} /> : <Copy size={16} />} {ok ? "Copiado" : rotulo}
    </button>
  );
}

function BlocoView({ bloco, minutosPlano, podeReescrever }: { bloco: Bloco; minutosPlano: number | null; podeReescrever: boolean }) {
  const router = useRouter();
  const [modo, setModo] = useState<"ver" | "editar" | "reescrever">("ver");
  const [titulo, setTitulo] = useState(bloco.titulo);
  const [fala, setFala] = useState(bloco.fala);
  const [naTela, setNaTela] = useState(bloco.na_tela);
  const [instrucao, setInstrucao] = useState("");
  const [trocarEdicao, setTrocarEdicao] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const palavras = contarPalavras(bloco.fala);

  async function salvar() {
    setOcupado(true);
    const r = await salvarBloco(bloco.id, titulo, fala, naTela);
    setOcupado(false);
    if (!r?.ok) return setAviso(r?.msg ?? "Não salvou.");
    setAviso(null);
    setModo("ver");
    router.refresh();
  }

  async function reescrever() {
    setOcupado(true);
    setAviso(null);
    const r = await chamarFuncao("conteudos-roteiro", { acao: "reescrever_bloco", bloco_id: bloco.id, instrucao, sobrescrever: bloco.editado && trocarEdicao });
    setOcupado(false);
    if (!r.ok) return setAviso(r.erro);
    setInstrucao("");
    setModo("ver");
    router.refresh();
  }

  return (
    <div className="cartao space-y-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-semibold">{bloco.ordem}. {bloco.titulo}</div>
        <div className="text-xs text-zinc-500">
          {palavras} palavras · ~{relogio(minutosDe(palavras))}{minutosPlano ? ` (planejado ${relogio(minutosPlano)})` : ""}
          {bloco.editado && <span className="ml-2 rounded bg-teal-50 px-1.5 py-0.5 text-teal-800">editado por você</span>}
        </div>
      </div>

      {modo === "editar" ? (
        <div className="space-y-2">
          <input className="campo" value={titulo} onChange={(e) => setTitulo(e.target.value)} aria-label="Título do bloco" />
          <label className="rotulo" htmlFor={`fala-${bloco.id}`}>Fala (o que o avatar diz)</label>
          <textarea id={`fala-${bloco.id}`} className="campo leading-relaxed" rows={14} value={fala} onChange={(e) => setFala(e.target.value)} />
          <div className="text-xs text-zinc-500">{contarPalavras(fala)} palavras · ~{relogio(minutosDe(contarPalavras(fala)))}</div>
          <label className="rotulo" htmlFor={`tela-${bloco.id}`}>Na tela (não é falado)</label>
          <textarea id={`tela-${bloco.id}`} className="campo" rows={3} value={naTela} onChange={(e) => setNaTela(e.target.value)} />
          <div className="flex gap-2">
            <button className="botao" onClick={salvar} disabled={ocupado}>{ocupado ? "Salvando…" : "Salvar bloco"}</button>
            <button className="botao-claro" onClick={() => { setModo("ver"); setTitulo(bloco.titulo); setFala(bloco.fala); setNaTela(bloco.na_tela); }}>Cancelar</button>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-3 text-[15px] leading-relaxed text-zinc-800">
            {bloco.fala.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)}
          </div>
          {bloco.na_tela && (
            <details className="text-sm text-zinc-600">
              <summary className="cursor-pointer text-xs text-zinc-500">Na tela</summary>
              <p className="mt-1 whitespace-pre-line">{bloco.na_tela}</p>
            </details>
          )}
        </>
      )}

      {modo === "reescrever" && (
        <div className="space-y-2 rounded-lg bg-zinc-50 p-3">
          <label className="rotulo" htmlFor={`instr-${bloco.id}`}>O que mudar? (opcional)</label>
          <input id={`instr-${bloco.id}`} className="campo" value={instrucao} onChange={(e) => setInstrucao(e.target.value)} placeholder="Ex.: mais curto; explique melhor o labrum; menos números" />
          {bloco.editado && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-teal-700" checked={trocarEdicao} onChange={(e) => setTrocarEdicao(e.target.checked)} />
              Este bloco tem edição sua. Trocar o seu texto pela nova versão da IA.
            </label>
          )}
          <div className="flex gap-2">
            <button className="botao" onClick={reescrever} disabled={ocupado || (bloco.editado && !trocarEdicao)}>
              {ocupado ? <><LoaderCircle size={16} className="animate-spin" /> Reescrevendo… (até 2 min)</> : <><Sparkles size={16} /> Reescrever</>}
            </button>
            <button className="botao-claro" onClick={() => setModo("ver")} disabled={ocupado}>Cancelar</button>
          </div>
        </div>
      )}

      {modo === "ver" && (
        <div className="flex flex-wrap gap-2">
          <button className="botao-claro" onClick={() => setModo("editar")}><Pencil size={14} /> Editar</button>
          {podeReescrever && <button className="botao-claro" onClick={() => setModo("reescrever")}><Sparkles size={14} /> Reescrever com a IA</button>}
        </div>
      )}
      {aviso && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm">{aviso}</p>}
    </div>
  );
}

/** Descrição do YouTube montada com os dados (referências do banco, não da
 *  IA): resumo, capítulos, referências, identificação e aviso de avatar. */
function descricaoYoutube(p: {
  titulo: string; resumo: string; blocos: Bloco[]; refs: Referencia[]; perfil: Perfil | null; duracaoReal: number | null;
}): string {
  const palavras = p.blocos.map((b) => contarPalavras(b.fala));
  const estimado = palavras.reduce((s, x) => s + x, 0);
  // capítulos pelo ritmo de fala; com o vídeo pronto, ajusta à duração real
  const escala = p.duracaoReal && estimado ? p.duracaoReal / 60 / minutosDe(estimado) : 1;
  let acumulado = 0;
  const capitulos = p.blocos.map((b, i) => {
    const linha = `${relogio(acumulado * escala)} ${b.titulo}`;
    acumulado += minutosDe(palavras[i]);
    return linha;
  });
  const nome = p.perfil?.nome_exibicao?.trim();
  const ident = [nome, p.perfil?.especialidade, p.perfil?.crm, p.perfil?.rqe].map((s) => s?.trim()).filter(Boolean).join(" · ");
  return [
    p.titulo,
    "",
    p.resumo,
    "",
    "Capítulos:",
    ...capitulos,
    "",
    "Referências:",
    ...p.refs.map((r, i) => `${i + 1}. ${citacao(r)}`),
    "",
    ident,
    "Este vídeo tem caráter informativo e não substitui uma consulta médica.",
    `Vídeo apresentado por avatar digital${nome ? ` de ${nome}` : ""}, gerado com inteligência artificial a partir de roteiro revisado pelo médico.`,
  ].filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n").trim();
}

export default function PassoRoteiro({ conteudoId, assunto, roteiros, roteiro, blocos, referencias, perfil, temChave, duracaoReal }: {
  conteudoId: string;
  assunto: string;
  roteiros: { id: string; versao: number; estado: string; criado_em: string }[];
  roteiro: Roteiro | null;
  blocos: Bloco[];
  referencias: Referencia[];
  perfil: Perfil | null;
  temChave: boolean;
  duracaoReal: number | null;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const marcadas = referencias.filter((r) => r.selecionada).length;
  const algumEscrevendo = roteiros.some((r) => r.estado === "estrutura" || r.estado === "escrevendo");
  const escrevendo = roteiro && (roteiro.estado === "estrutura" || roteiro.estado === "escrevendo");
  const parado = !!roteiro && (roteiro.estado === "erro" || (!!escrevendo && minutosDesde(roteiro.atualizado_em) >= 3));
  const plano = roteiro?.estrutura?.blocos ?? [];
  const totalPalavras = blocos.reduce((s, b) => s + contarPalavras(b.fala), 0);
  const totalMin = minutosDe(totalPalavras);
  const refsDoRoteiro = referencias.filter((r) => roteiro?.pmids.includes(r.pmid));

  async function chamar(corpo: Record<string, unknown>) {
    setOcupado(true);
    setAviso(null);
    const r = await chamarFuncao<{ roteiro_id?: string; mensagem?: string }>("conteudos-roteiro", corpo);
    setOcupado(false);
    if (!r.ok) return setAviso(r.erro);
    if (r.dados.roteiro_id) router.push(`/conteudos/${conteudoId}?v=${r.dados.roteiro_id}`);
    router.refresh();
  }

  const textoRoteiro = roteiro
    ? [roteiro.titulo ?? assunto, "", ...blocos.flatMap((b) => [`${b.ordem}. ${b.titulo}`, "", b.fala, ...(b.na_tela ? ["", `[Na tela] ${b.na_tela}`] : []), ""])].join("\n").trim()
    : "";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">2. Roteiro</h2>
          <p className="text-sm text-zinc-500">Cerca de {META_MINUTOS} minutos, escrito pela IA a partir das referências marcadas, em blocos que você revisa.</p>
        </div>
        <button className="botao" onClick={() => chamar({ acao: "novo", conteudo_id: conteudoId })}
          disabled={ocupado || algumEscrevendo || marcadas < 3 || !temChave}>
          <FileText size={16} /> {roteiros.length ? "Escrever nova versão" : "Escrever roteiro"}
        </button>
      </div>
      {marcadas < 3 && <p className="text-xs text-zinc-500">Marque pelo menos 3 referências no passo 1 ({marcadas} marcadas).</p>}
      {aviso && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm">{aviso}</p>}

      {roteiros.length > 1 && (
        <div className="flex flex-wrap gap-1 text-xs">
          {roteiros.map((r) => (
            <Link key={r.id} href={`/conteudos/${conteudoId}?v=${r.id}`}
              className={`rounded-md px-2 py-1 ${r.id === roteiro?.id ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700"}`}>
              v{r.versao} · {dataHora(r.criado_em)}
            </Link>
          ))}
        </div>
      )}

      {roteiro && (
        <>
          {escrevendo && !parado && (
            <div className="cartao flex items-center gap-3 p-4 text-sm">
              <LoaderCircle size={18} className="animate-spin text-teal-700" />
              <div>
                {roteiro.estado === "estrutura" ? "Planejando os blocos do vídeo…" : `Escrevendo: ${blocos.length} de ${plano.length} blocos prontos.`}
                <div className="text-xs text-zinc-500">Cada bloco leva cerca de 1 minuto. Pode sair desta página: continua sozinho.</div>
              </div>
            </div>
          )}
          {parado && (
            <div className="cartao space-y-2 p-4 text-sm">
              <div><b>A escrita parou.</b> {roteiro.msg ?? "Sem avanço há mais de 3 minutos."}</div>
              <button className="botao-claro" onClick={() => chamar({ acao: "continuar", roteiro_id: roteiro.id })} disabled={ocupado}>
                <RefreshCw size={14} /> Continuar de onde parou
              </button>
            </div>
          )}

          {roteiro.titulo && (
            <div className="cartao space-y-2 p-5">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Título sugerido</div>
              <div className="text-lg font-semibold">{roteiro.titulo}</div>
              {roteiro.estrutura?.resumo && <p className="text-sm text-zinc-600">{roteiro.estrutura.resumo}</p>}
              <div className="text-sm">
                <b>{totalPalavras}</b> palavras · duração estimada <b>{relogio(totalMin)}</b>
                {roteiro.estado === "pronto" && Math.abs(totalMin - META_MINUTOS) > 2 && (
                  <span className="text-zinc-500"> (meta: {META_MINUTOS}:00 — ajuste editando ou reescrevendo blocos)</span>
                )}
              </div>
              {roteiro.estado === "pronto" && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <BotaoCopiar texto={textoRoteiro} rotulo="Copiar roteiro" />
                  <BotaoCopiar texto={descricaoYoutube({ titulo: roteiro.titulo, resumo: roteiro.estrutura?.resumo ?? "", blocos, refs: refsDoRoteiro, perfil, duracaoReal })} rotulo="Copiar descrição do YouTube" />
                </div>
              )}
              {!perfil?.crm && <p className="text-xs text-zinc-500">Dica: preencha nome, CRM e RQE em <a href="/configuracoes" className="underline">Configurações</a> para a identificação sair certa.</p>}
            </div>
          )}

          <div className="space-y-3">
            {plano.map((pl) => {
              const b = blocos.find((x) => x.ordem === pl.ordem);
              return b ? (
                <BlocoView key={b.id + b.atualizado_em} bloco={b} minutosPlano={pl.minutos} podeReescrever={roteiro.estado === "pronto" && temChave} />
              ) : (
                <div key={pl.ordem} className="cartao p-5 text-sm text-zinc-500">
                  <div className="font-semibold text-zinc-700">{pl.ordem}. {pl.titulo}</div>
                  <div>{pl.objetivo}</div>
                  <div className="mt-1 text-xs">{escrevendo && !parado ? "aguardando a IA…" : "não escrito"} · planejado {relogio(pl.minutos)}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
