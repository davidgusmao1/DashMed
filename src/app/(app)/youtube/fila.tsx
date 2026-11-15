"use client";

// Fila de respostas do YouTube Seller: a IA triou e escreveu; o médico lê,
// ajusta e publica (as políticas da API do YouTube exigem que quem publica
// tenha a palavra final — e a resposta sai no nome dele).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, GraduationCap, ListChecks, LoaderCircle, Send, Siren, Sparkles } from "lucide-react";
import { dataHora } from "@/lib/conteudo";
import { chamarFuncao } from "@/lib/funcoes";
import { type Comentario, editouDeVerdade, LINK_VIDEO, ROTULO_CATEGORIA } from "@/lib/youtube";
import { ignorarResposta, salvarRascunho } from "./acoes";
import Porcentagens from "./porcentagens";
import JanelaTreino from "./treino";

type Conversa = { comentario: string; resposta: string | null };

// Revisão mais rápida (David, 14/11/26): publicar sem a pergunta de
// confirmação é escolha de quem revisa, guardada só neste navegador.
const CHAVE_SEM_CONFIRMAR = "dashmed:youtube:publicar-sem-confirmar";
// No lote, uma por vez e com folga entre elas: rajada de respostas é o que o
// filtro de spam do YouTube procura. O limite diário continua valendo no servidor.
const INTERVALO_LOTE_MS = 4000;
const MAXIMO_LOTE = 20;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

type PropsCartao = {
  c: Comentario; codigo: string | null; canal: string; clienteId: string; conversa: Conversa | null;
  videoIndicado: string | null; semConfirmar: boolean; selecionado: boolean; travado: boolean;
  aoSelecionar: (sim: boolean) => void; aoMudarTexto: (texto: string) => void;
};

function Cartao({ c, codigo, canal, clienteId, conversa, videoIndicado, semConfirmar, selecionado, travado, aoSelecionar, aoMudarTexto }: PropsCartao) {
  const router = useRouter();
  const [texto, setTexto] = useState(c.rascunho ?? "");
  const [editado, setEditado] = useState(false);
  const [modo, setModo] = useState<"ver" | "confirmar" | "refazer">("ver");
  const [instrucao, setInstrucao] = useState("");
  const [trocarEdicao, setTrocarEdicao] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [treinando, setTreinando] = useState(false);

  // o lote publica o texto que está na tela, editado ou não
  useEffect(() => { aoMudarTexto(texto); }, [texto, aoMudarTexto]);

  /** depois de salvar um treinamento: refaz esta resposta já com ele */
  async function refazerComTreino(refazerAgora: boolean, trocar: boolean) {
    if (!refazerAgora) return;
    setOcupado("refazer");
    const r = await chamarFuncao<{ mensagem: string }>("youtube-responder", {
      acao: "refazer", comentario_id: c.id, sobrescrever: (c.rascunho_editado || editado) && trocar,
    });
    setOcupado(null);
    setAviso(r.ok ? { ok: true, texto: "Treinamento salvo e resposta refeita com ele." } : { ok: false, texto: `Treinamento salvo, mas a resposta não foi refeita: ${r.erro}` });
    router.refresh();
  }

  async function publicar() {
    setOcupado("publicar");
    setAviso(null);
    const r = await chamarFuncao<{ mensagem: string }>("youtube-responder", { acao: "publicar", comentario_id: c.id, texto });
    setOcupado(null);
    setModo("ver");
    // publicou diferente do que a IA sugeriu: vira material para ela aprender
    const aprende = r.ok && editouDeVerdade(c.sugestao_ia, texto);
    setAviso(r.ok ? { ok: true, texto: aprende ? `${r.dados.mensagem} Você editou o texto: ele entra em "Aprender com minhas edições", no topo da página.` : r.dados.mensagem } : { ok: false, texto: r.erro });
    router.refresh();
  }

  async function refazer() {
    setOcupado("refazer");
    setAviso(null);
    const r = await chamarFuncao<{ mensagem: string }>("youtube-responder", {
      acao: "refazer", comentario_id: c.id, instrucao, sobrescrever: (c.rascunho_editado || editado) && trocarEdicao,
    });
    setOcupado(null);
    if (!r.ok) return setAviso({ ok: false, texto: r.erro });
    setModo("ver");
    setInstrucao("");
    router.refresh();
  }

  async function guardar() {
    setOcupado("salvar");
    const r = await salvarRascunho(c.id, texto);
    setOcupado(null);
    setAviso(r.ok ? null : { ok: false, texto: r.msg });
    if (r.ok) { setEditado(false); router.refresh(); }
  }

  async function ignorar() {
    setOcupado("ignorar");
    const r = await ignorarResposta(c.id);
    setOcupado(null);
    if (!r.ok) setAviso({ ok: false, texto: r.msg });
    router.refresh();
  }

  const jaEditado = c.rascunho_editado || editado;
  const parado = !!ocupado || travado;
  return (
    <li className={`cartao space-y-3 p-4 ${selecionado ? "ring-2 ring-teal-600" : ""}`}>
      <div className="flex items-start gap-3">
        {c.autor_foto_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.autor_foto_url} alt="" className="size-9 shrink-0 rounded-full" />
        ) : <span className="size-9 shrink-0 rounded-full bg-zinc-200" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <b>{c.autor_nome}</b>
            {c.urgente && <span className="inline-flex items-center gap-1 rounded bg-zinc-900 px-1.5 py-0.5 text-xs font-semibold text-white"><Siren size={12} /> urgente</span>}
            <span title="Chance de marcar consulta ou procedimento (decide quem vira lead)" className="rounded bg-teal-50 px-1.5 py-0.5 text-xs font-semibold text-teal-800">{c.probabilidade ?? 0}%</span>
            <Porcentagens c={c} />
            {c.categoria && <span className="text-xs text-zinc-500">{ROTULO_CATEGORIA[c.categoria] ?? c.categoria}</span>}
            {c.conversa_de && <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs font-semibold text-white">continuação da conversa</span>}
            {c.procedimentos.map((p) => <span key={p} className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700">{p}</span>)}
            {codigo && c.lead_id && <Link href={`/youtube/leads/${c.lead_id}`} className="text-xs text-zinc-500 underline">lead {codigo}</Link>}
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600">
              <input type="checkbox" className="size-4 accent-teal-700" checked={selecionado} disabled={travado} onChange={(e) => aoSelecionar(e.target.checked)} />
              Selecionar
            </label>
          </div>
          <div className="text-xs text-zinc-400">
            {dataHora(c.publicado_em)} · <a href={LINK_VIDEO(c.video_id, c.comentario_id)} target="_blank" rel="noreferrer" className="hover:underline">{c.video_titulo ?? "vídeo"} <ExternalLink size={10} className="inline" /></a>
          </div>
          {conversa && (
            <details className="mt-2 rounded-lg bg-zinc-50 p-2 text-xs text-zinc-600">
              <summary className="cursor-pointer">Conversa até aqui</summary>
              <p className="mt-1 whitespace-pre-line"><b>Comentário:</b> {conversa.comentario}</p>
              {conversa.resposta && <p className="mt-1 whitespace-pre-line"><b>Você respondeu:</b> {conversa.resposta}</p>}
            </details>
          )}
          <p className="mt-2 whitespace-pre-line text-sm text-zinc-800">{c.conversa_de && <b>Nova mensagem: </b>}{c.texto}</p>
          {c.resumo && <p className="mt-1 text-xs text-zinc-500">IA: {c.resumo}</p>}
        </div>
      </div>

      {c.resposta === "falhou" && c.resposta_msg && (
        <p className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"><b>Atenção:</b> {c.resposta_msg}</p>
      )}

      <div>
        <label className="rotulo" htmlFor={`r-${c.id}`}>Resposta {jaEditado ? "(editada por você)" : "sugerida pela IA"}</label>
        <textarea id={`r-${c.id}`} className="campo leading-relaxed" rows={5} value={texto} disabled={parado}
          onChange={(e) => { setTexto(e.target.value); setEditado(true); }} />
        <div className="text-xs text-zinc-400">{texto.length} caracteres</div>
        {c.video_sugerido && (
          <p className="mt-1 text-xs text-zinc-600">
            A IA indicou o vídeo do canal{" "}
            <a href={LINK_VIDEO(c.video_sugerido)} target="_blank" rel="noreferrer" className="underline">
              {videoIndicado ?? c.video_sugerido} <ExternalLink size={10} className="inline" />
            </a>{" "}
            — confira se responde à dúvida antes de publicar.
          </p>
        )}
      </div>

      {modo === "confirmar" && (
        <div className="space-y-2 rounded-lg bg-zinc-50 p-3 text-sm">
          <p>Publicar esta resposta no YouTube, como <b>{canal}</b>? Ela fica pública em seu nome.</p>
          <div className="flex gap-2">
            <button className="botao" onClick={publicar} disabled={!!ocupado}>{ocupado === "publicar" ? <><LoaderCircle size={16} className="animate-spin" /> Publicando…</> : "Confirmar e publicar"}</button>
            <button className="botao-claro" onClick={() => setModo("ver")} disabled={!!ocupado}>Cancelar</button>
          </div>
        </div>
      )}

      {modo === "refazer" && (
        <div className="space-y-2 rounded-lg bg-zinc-50 p-3">
          <label className="rotulo" htmlFor={`i-${c.id}`}>O que mudar? (opcional)</label>
          <input id={`i-${c.id}`} className="campo" value={instrucao} onChange={(e) => setInstrucao(e.target.value)} placeholder="Ex.: mais curta; ofereça só a telemedicina; explique a recuperação" />
          {jaEditado && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-teal-700" checked={trocarEdicao} onChange={(e) => setTrocarEdicao(e.target.checked)} />
              Trocar o seu texto pela nova sugestão da IA.
            </label>
          )}
          <div className="flex gap-2">
            <button className="botao" onClick={refazer} disabled={!!ocupado || (jaEditado && !trocarEdicao)}>
              {ocupado === "refazer" ? <><LoaderCircle size={16} className="animate-spin" /> Escrevendo…</> : <><Sparkles size={16} /> Refazer</>}
            </button>
            <button className="botao-claro" onClick={() => setModo("ver")} disabled={!!ocupado}>Cancelar</button>
          </div>
        </div>
      )}

      {modo === "ver" && (
        <div className="flex flex-wrap gap-2">
          <button className="botao" onClick={() => (semConfirmar ? publicar() : setModo("confirmar"))} disabled={parado || texto.trim().length < 2}>
            {ocupado === "publicar" ? <><LoaderCircle size={14} className="animate-spin" /> Publicando…</> : <><Send size={14} /> Publicar</>}
          </button>
          {editado && <button className="botao-claro" onClick={guardar} disabled={parado}>{ocupado === "salvar" ? "Salvando…" : "Salvar rascunho"}</button>}
          <button className="botao-claro" onClick={() => setModo("refazer")} disabled={parado}><Sparkles size={14} /> Refazer com a IA</button>
          <button className="botao-claro" onClick={ignorar} disabled={parado}>{ocupado === "ignorar" ? "…" : "Ignorar"}</button>
          <button className="botao-claro" onClick={() => setTreinando(true)} disabled={parado}><GraduationCap size={14} /> Treinamento da IA</button>
          <a href={LINK_VIDEO(c.video_id, c.conversa_de ? c.thread_id : c.comentario_id)} target="_blank" rel="noreferrer" className="botao-claro"><ExternalLink size={14} /> Ver no YouTube</a>
        </div>
      )}
      {ocupado === "refazer" && modo === "ver" && <p className="flex items-center gap-2 text-sm text-zinc-600"><LoaderCircle size={14} className="animate-spin" /> Refazendo a resposta com o treinamento…</p>}
      {treinando && (
        <JanelaTreino clienteId={clienteId} comentarioId={c.id} comentario={c.texto} rascunho={texto} editado={c.rascunho_editado || editado}
          aoFechar={() => setTreinando(false)} aoSalvar={refazerComTreino} />
      )}
      {aviso && <p className={`rounded-lg px-3 py-2 text-sm ${aviso.ok ? "bg-teal-50 text-teal-900" : "bg-zinc-100 text-zinc-900"}`}>{aviso.texto}</p>}
    </li>
  );
}

type Lote = { total: number; feitos: number; ok: number; falhas: string[]; andando: boolean; parouNoLimite: boolean };

export default function Fila({ comentarios, codigos, canal, clienteId, conversas, titulosVideos = {}, filtrada = false }: {
  comentarios: Comentario[]; codigos: Record<string, string>; canal: string; clienteId: string; conversas: Record<string, Conversa>;
  titulosVideos?: Record<string, string>; filtrada?: boolean;
}) {
  const router = useRouter();
  const textos = useRef<Record<string, string>>({});
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [semConfirmar, setSemConfirmar] = useState(false);
  const [confirmandoLote, setConfirmandoLote] = useState(false);
  const [lote, setLote] = useState<Lote | null>(null);

  useEffect(() => {
    try { setSemConfirmar(localStorage.getItem(CHAVE_SEM_CONFIRMAR) === "1"); } catch { /* navegador sem armazenamento: pergunta sempre */ }
  }, []);
  function mudarSemConfirmar(sim: boolean) {
    setSemConfirmar(sim);
    try { localStorage.setItem(CHAVE_SEM_CONFIRMAR, sim ? "1" : "0"); } catch { /* fica só nesta visita */ }
  }

  // o que sumiu da fila (publicado, ignorado) sai da seleção sozinho
  const selecionados = comentarios.filter((c) => marcados.has(c.id));
  const andando = !!lote?.andando;
  const marcar = (id: string, sim: boolean) => setMarcados((m) => {
    const n = new Set(m);
    if (sim && n.size < MAXIMO_LOTE) n.add(id); else n.delete(id);
    return n;
  });
  const quaisCabem = comentarios.slice(0, MAXIMO_LOTE).map((c) => c.id);
  const todosMarcados = quaisCabem.length > 0 && quaisCabem.every((id) => marcados.has(id));

  async function publicarLote() {
    setConfirmandoLote(false);
    const fila = selecionados.map((c) => ({ id: c.id, autor: c.autor_nome, texto: (textos.current[c.id] ?? c.rascunho ?? "").trim() }));
    const estado: Lote = { total: fila.length, feitos: 0, ok: 0, falhas: [], andando: true, parouNoLimite: false };
    setLote({ ...estado });
    for (let i = 0; i < fila.length; i++) {
      const item = fila[i];
      const r = item.texto.length < 2
        ? { ok: false as const, erro: "a resposta está vazia" }
        : await chamarFuncao<{ mensagem: string }>("youtube-responder", { acao: "publicar", comentario_id: item.id, texto: item.texto });
      estado.feitos++;
      if (r.ok) estado.ok++; else estado.falhas.push(`${item.autor}: ${r.erro}`);
      setLote({ ...estado, falhas: [...estado.falhas] });
      if (!r.ok && /^Limite de \d+ respostas por dia/.test(r.erro)) { estado.parouNoLimite = true; break; }
      if (i < fila.length - 1) await esperar(INTERVALO_LOTE_MS);
    }
    setLote({ ...estado, falhas: [...estado.falhas], andando: false });
    setMarcados(new Set());
    router.refresh();
  }

  if (!comentarios.length) {
    return <p className="cartao p-5 text-sm text-zinc-500">{filtrada ? "Nenhuma resposta na fila com este filtro." : "Nenhuma resposta esperando revisão. Quando a varredura achar comentários com chance de virar consulta, as respostas aparecem aqui."}</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-zinc-600">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" className="size-4 accent-teal-700" checked={todosMarcados} disabled={andando}
            onChange={(e) => setMarcados(e.target.checked ? new Set(quaisCabem) : new Set())} />
          Selecionar {comentarios.length > MAXIMO_LOTE ? `as ${MAXIMO_LOTE} primeiras` : "todas"}
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" className="size-4 accent-teal-700" checked={semConfirmar} onChange={(e) => mudarSemConfirmar(e.target.checked)} />
          Publicar sem pedir confirmação
        </label>
      </div>

      {lote && (
        <div className="cartao space-y-1 p-3 text-sm" role="status">
          {lote.andando
            ? <p className="flex items-center gap-2 font-medium"><LoaderCircle size={14} className="animate-spin" /> Publicando {Math.min(lote.feitos + 1, lote.total)} de {lote.total}… (uma por vez, com intervalo)</p>
            : <p className="font-medium">{lote.ok} de {lote.total} publicada(s).{lote.parouNoLimite ? " Parou no limite diário; as outras continuam na fila." : ""}</p>}
          {lote.falhas.length > 0 && (
            <ul className="list-disc pl-5 text-zinc-700">{lote.falhas.map((f) => <li key={f}>{f}</li>)}</ul>
          )}
          {!lote.andando && <button className="text-xs underline" onClick={() => setLote(null)}>fechar</button>}
        </div>
      )}

      <ul className="space-y-3">
        {comentarios.map((c) => (
          <Cartao key={c.id + (c.rascunho ?? "")} c={c} codigo={c.lead_id ? codigos[c.lead_id] ?? null : null} canal={canal} clienteId={clienteId}
            conversa={c.conversa_de ? conversas[c.conversa_de] ?? null : null}
            videoIndicado={c.video_sugerido ? titulosVideos[c.video_sugerido] ?? null : null} semConfirmar={semConfirmar} selecionado={marcados.has(c.id)} travado={andando}
            aoSelecionar={(sim) => marcar(c.id, sim)} aoMudarTexto={(t) => { textos.current[c.id] = t; }} />
        ))}
      </ul>

      {selecionados.length > 0 && !andando && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-lg">
          <ListChecks size={18} className="text-teal-700" />
          {confirmandoLote ? (
            <>
              <span>Publicar <b>{selecionados.length}</b> resposta(s) no YouTube como <b>{canal}</b>? Ficam públicas em seu nome, com o texto que está em cada cartão.</span>
              <button className="botao" onClick={publicarLote}>Confirmar e publicar</button>
              <button className="botao-claro" onClick={() => setConfirmandoLote(false)}>Cancelar</button>
            </>
          ) : (
            <>
              <span><b>{selecionados.length}</b> selecionada(s){selecionados.length >= MAXIMO_LOTE ? ` (máximo ${MAXIMO_LOTE} por vez)` : ""}</span>
              <button className="botao" onClick={() => setConfirmandoLote(true)}><Send size={14} /> Publicar selecionadas</button>
              <button className="botao-claro" onClick={() => setMarcados(new Set())}>Limpar seleção</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
