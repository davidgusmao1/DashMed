"use client";

// Fila de respostas do YouTube Seller: a IA triou e escreveu; o médico lê,
// ajusta e publica (as políticas da API do YouTube exigem que quem publica
// tenha a palavra final — e a resposta sai no nome dele).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExternalLink, GraduationCap, LoaderCircle, Send, Siren, Sparkles } from "lucide-react";
import { dataHora } from "@/lib/conteudo";
import { chamarFuncao } from "@/lib/funcoes";
import { type Comentario, LINK_VIDEO, ROTULO_CATEGORIA } from "@/lib/youtube";
import { ignorarResposta, salvarRascunho } from "./acoes";
import JanelaTreino from "./treino";

function Cartao({ c, codigo, canal, clienteId }: { c: Comentario; codigo: string | null; canal: string; clienteId: string }) {
  const router = useRouter();
  const [texto, setTexto] = useState(c.rascunho ?? "");
  const [editado, setEditado] = useState(false);
  const [modo, setModo] = useState<"ver" | "confirmar" | "refazer">("ver");
  const [instrucao, setInstrucao] = useState("");
  const [trocarEdicao, setTrocarEdicao] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [treinando, setTreinando] = useState(false);

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
    setAviso(r.ok ? { ok: true, texto: r.dados.mensagem } : { ok: false, texto: r.erro });
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
  return (
    <li className="cartao space-y-3 p-4">
      <div className="flex items-start gap-3">
        {c.autor_foto_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.autor_foto_url} alt="" className="size-9 shrink-0 rounded-full" />
        ) : <span className="size-9 shrink-0 rounded-full bg-zinc-200" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <b>{c.autor_nome}</b>
            {c.urgente && <span className="inline-flex items-center gap-1 rounded bg-zinc-900 px-1.5 py-0.5 text-xs font-semibold text-white"><Siren size={12} /> urgente</span>}
            <span className="rounded bg-teal-50 px-1.5 py-0.5 text-xs font-semibold text-teal-800">{c.probabilidade ?? 0}%</span>
            {c.categoria && <span className="text-xs text-zinc-500">{ROTULO_CATEGORIA[c.categoria] ?? c.categoria}</span>}
            {c.procedimentos.map((p) => <span key={p} className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700">{p}</span>)}
            {codigo && c.lead_id && <Link href={`/youtube/leads/${c.lead_id}`} className="text-xs text-zinc-500 underline">lead {codigo}</Link>}
          </div>
          <div className="text-xs text-zinc-400">
            {dataHora(c.publicado_em)} · <a href={LINK_VIDEO(c.video_id, c.comentario_id)} target="_blank" rel="noreferrer" className="hover:underline">{c.video_titulo ?? "vídeo"} <ExternalLink size={10} className="inline" /></a>
          </div>
          <p className="mt-2 whitespace-pre-line text-sm text-zinc-800">{c.texto}</p>
          {c.resumo && <p className="mt-1 text-xs text-zinc-500">IA: {c.resumo}</p>}
        </div>
      </div>

      {c.resposta === "falhou" && c.resposta_msg && (
        <p className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"><b>Atenção:</b> {c.resposta_msg}</p>
      )}

      <div>
        <label className="rotulo" htmlFor={`r-${c.id}`}>Resposta {jaEditado ? "(editada por você)" : "sugerida pela IA"}</label>
        <textarea id={`r-${c.id}`} className="campo leading-relaxed" rows={5} value={texto} disabled={!!ocupado}
          onChange={(e) => { setTexto(e.target.value); setEditado(true); }} />
        <div className="text-xs text-zinc-400">{texto.length} caracteres</div>
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
          <button className="botao" onClick={() => setModo("confirmar")} disabled={!!ocupado || texto.trim().length < 2}><Send size={14} /> Publicar</button>
          {editado && <button className="botao-claro" onClick={guardar} disabled={!!ocupado}>{ocupado === "salvar" ? "Salvando…" : "Salvar rascunho"}</button>}
          <button className="botao-claro" onClick={() => setModo("refazer")} disabled={!!ocupado}><Sparkles size={14} /> Refazer com a IA</button>
          <button className="botao-claro" onClick={ignorar} disabled={!!ocupado}>{ocupado === "ignorar" ? "…" : "Ignorar"}</button>
          <button className="botao-claro" onClick={() => setTreinando(true)} disabled={!!ocupado}><GraduationCap size={14} /> Treinamento da IA</button>
          <a href={LINK_VIDEO(c.video_id, c.comentario_id)} target="_blank" rel="noreferrer" className="botao-claro"><ExternalLink size={14} /> Ver no YouTube</a>
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

export default function Fila({ comentarios, codigos, canal, clienteId }: { comentarios: Comentario[]; codigos: Record<string, string>; canal: string; clienteId: string }) {
  if (!comentarios.length) {
    return <p className="cartao p-5 text-sm text-zinc-500">Nenhuma resposta esperando revisão. Quando a varredura achar comentários com chance de virar consulta, as respostas aparecem aqui.</p>;
  }
  return (
    <ul className="space-y-3">
      {comentarios.map((c) => <Cartao key={c.id + (c.rascunho ?? "")} c={c} codigo={c.lead_id ? codigos[c.lead_id] ?? null : null} canal={canal} clienteId={clienteId} />)}
    </ul>
  );
}
