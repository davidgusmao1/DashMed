"use client";

// Responder embaixo do comentário achado na busca (David, 15/11/26: "embaixo
// do comentário coloque alguns botões ... responder e responder com IA ... mas
// não colocar a resposta automática ainda"). Fechado, mostra só os botões; a
// IA escreve quando o médico pede. Publicar é sempre clique dele, como na fila
// (as políticas da API do YouTube exigem que quem publica tenha a palavra final).
// Quem o médico responde vira lead, com código YT (David, 15/11/26: "Sim, virar
// lead"); agradecimento de elogio não. "Enviar para revisar" (15/11/26: "já
// cria uma resposta de [IA] pronta ... barrinha na lateral pintando de verde"):
// a IA escreve e a resposta vai para a fila com a barra verde, sem abrir aqui.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ExternalLink, GraduationCap, ListPlus, LoaderCircle, MessageSquareReply, Send, Sparkles } from "lucide-react";
import { dataHora } from "@/lib/conteudo";
import { chamarFuncao } from "@/lib/funcoes";
import { CHAVE_SEM_CONFIRMAR, editouDeVerdade, foiAnonimizado, LINK_VIDEO } from "@/lib/youtube";
import { ignorarResposta, marcarRevisada, salvarRascunho } from "./acoes";
import JanelaTreino from "./treino";

/** O que a tela precisa do comentário para responder. */
export type ParaResponder = {
  id: string;
  comentario_id: string;
  thread_id?: string | null;
  video_id: string;
  conversa_de?: string | null;
  texto: string;
  resposta: string;
  ja_respondido: boolean;
  pode_responder?: boolean;
  rascunho?: string | null;
  rascunho_editado?: boolean;
  sugestao_ia?: string | null;
  resposta_msg?: string | null;
  video_sugerido?: string | null;
  publicada_em?: string | null;
  lead_id?: string | null;
  codigo?: string | null;
  categoria?: string | null;
  /** barra verde na fila (0021) */
  revisada_em?: string | null;
};

/** `fila`: o aviso leva à resposta na fila */
type Aviso = { ok: boolean; texto: string; fila?: boolean } | null;
type Escrito = { mensagem: string; texto: string; problema: string | null; video_sugerido: string | null; codigo: string | null; revisada: boolean };
const NA_FILA = ["rascunho", "falhou"];

export default function ResponderComentario({ c, canal, clienteId, videoIndicado }: {
  c: ParaResponder; canal: string; clienteId: string; videoIndicado: string | null;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  // o último texto que a IA escreveu: trocar o que o médico escreveu por outro
  // da IA pede confirmação (regra 4)
  const [daIa, setDaIa] = useState<string | null>(null);
  const [video, setVideo] = useState<string | null>(c.video_sugerido ?? null);
  const [problema, setProblema] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [pedindo, setPedindo] = useState(false);
  const [instrucao, setInstrucao] = useState("");
  const [trocar, setTrocar] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [treinando, setTreinando] = useState(false);
  const [semConfirmar, setSemConfirmar] = useState(false);
  const [codigo, setCodigo] = useState<string | null>(c.codigo ?? null);

  useEffect(() => {
    try { setSemConfirmar(localStorage.getItem(CHAVE_SEM_CONFIRMAR) === "1"); } catch { /* sem armazenamento: pergunta sempre */ }
  }, []);

  const link = LINK_VIDEO(c.video_id, c.conversa_de && c.thread_id ? c.thread_id : c.comentario_id);
  const verNoYoutube = (
    <a href={link} target="_blank" rel="noreferrer" className="botao-claro"><ExternalLink size={14} /> Ver no YouTube</a>
  );

  const naFilaHref = `/youtube?aba=fila&f=revisada#c-${c.id}`;
  const avisoNaTela = aviso && (
    <p className={`rounded-lg px-3 py-2 text-sm ${aviso.ok ? "bg-teal-50 text-teal-900" : "bg-zinc-100 text-zinc-900"}`}>
      {aviso.texto}{aviso.fila && <> <Link href={aviso.ok ? naFilaHref : "/youtube?aba=fila"} className="font-medium underline">Abrir na fila</Link></>}
    </p>
  );

  // o que impede de responder aparece com o motivo (regra 2)
  if (foiAnonimizado(c.texto)) return null;
  if (c.resposta === "publicada") {
    return (
      <div className="space-y-2 pt-1">
        {avisoNaTela}
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
          <span className="font-semibold text-teal-800">Respondido pela DashMed{c.publicada_em ? ` em ${dataHora(c.publicada_em)}` : ""}</span>
          {verNoYoutube}
        </div>
        {c.rascunho && (
          <details className="rounded-lg bg-zinc-50 p-2 text-xs text-zinc-700">
            <summary className="cursor-pointer">Ver a resposta publicada</summary>
            <p className="mt-1 whitespace-pre-line">{c.rascunho}</p>
          </details>
        )}
      </div>
    );
  }
  if (c.resposta === "publicando") {
    return <p className="flex items-center gap-2 pt-1 text-xs text-zinc-600"><LoaderCircle size={12} className="animate-spin" /> A resposta está sendo publicada…</p>;
  }
  if (c.ja_respondido) {
    return <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-zinc-600"><span>Você já respondeu este comentário direto no YouTube.</span>{verNoYoutube}</div>;
  }
  if (c.pode_responder === false) {
    return <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-zinc-600"><span>O YouTube não deixa responder este comentário (o autor ou o vídeo bloqueou respostas).</span>{verNoYoutube}</div>;
  }

  const naFila = NA_FILA.includes(c.resposta) && !!c.rascunho;
  const revisada = c.resposta === "rascunho" && !!c.rascunho && !!c.revisada_em;
  // agradecimento de elogio não faz ninguém virar lead (o servidor decide igual)
  const elogio = !c.lead_id && c.categoria === "elogio";
  const parado = !!ocupado;
  // há texto do médico na tela (ou salvo) que a IA trocaria
  const temTextoDele = (!!texto.trim() && texto.trim() !== (daIa ?? "").trim()) || (!!c.rascunho_editado && !!c.rascunho && daIa === null);

  function abrir(inicial: string, ia: string | null) {
    setTexto(inicial);
    setDaIa(ia);
    setAberto(true);
    setConfirmar(false);
    setPedindo(false);
    setTrocar(false);
    setProblema(c.resposta === "falhou" ? c.resposta_msg ?? null : null);
  }

  /** A IA escreve (ou reescreve) a sugestão; ela entra na fila, nada é publicado. */
  async function escreverComIa(sobrescrever: boolean) {
    setOcupado("ia");
    setAviso(null);
    const r = await chamarFuncao<Escrito>("youtube-responder", {
      acao: "refazer", comentario_id: c.id, instrucao: instrucao.trim(), sobrescrever,
    });
    setOcupado(null);
    if (!r.ok) {
      setAviso({ ok: false, texto: r.erro });
      return;
    }
    if (r.dados.codigo) setCodigo(r.dados.codigo);
    setTexto(r.dados.texto);
    setDaIa(r.dados.texto);
    setVideo(r.dados.video_sugerido);
    setProblema(r.dados.problema);
    setAberto(true);
    setPedindo(false);
    setInstrucao("");
    setTrocar(false);
    setAviso({ ok: true, texto: "A IA escreveu a sugestão; revise antes de publicar. Ela também ficou em “Respostas para revisar”; nada foi publicado." });
    router.refresh();
  }

  /** "Enviar para revisar": resposta pronta na fila, com a barra verde, sem abrir aqui */
  async function enviarParaRevisar() {
    setAviso(null);
    // já tem resposta pronta na fila: só ganha a barra verde (sem gastar IA)
    if (c.resposta === "rascunho" && c.rascunho) {
      setOcupado("enviar");
      const m = await marcarRevisada(c.id, true);
      setOcupado(null);
      setAviso(m.ok ? { ok: true, texto: "Já estava em “Respostas para revisar”; agora com a barra verde.", fila: true } : { ok: false, texto: m.msg });
      if (m.ok) router.refresh();
      return;
    }
    setOcupado("enviar");
    const r = await chamarFuncao<Escrito>("youtube-responder", { acao: "refazer", comentario_id: c.id, marcar: true });
    setOcupado(null);
    if (!r.ok) {
      setAviso({ ok: false, texto: r.erro });
      return;
    }
    if (r.dados.codigo) setCodigo(r.dados.codigo);
    setAberto(false);
    setAviso(r.dados.revisada
      ? { ok: true, texto: `A IA escreveu a resposta e ela foi para “Respostas para revisar”, com a barra verde. Nada foi publicado.${!c.lead_id && r.dados.codigo ? ` A pessoa virou lead (${r.dados.codigo}).` : ""}`, fila: true }
      : { ok: false, texto: `A IA escreveu, mas há um problema: ${r.dados.problema ?? "veja na fila"}. A resposta está na fila sem a barra verde, para você corrigir.`, fila: true });
    router.refresh();
  }

  /** "Pôr o código no texto": a pessoa vira lead já e o código entra no fim da resposta */
  async function porCodigo() {
    let cod = codigo;
    if (!cod) {
      setOcupado("codigo");
      const r = await chamarFuncao<{ mensagem: string; codigo: string }>("youtube-responder", { acao: "lead", comentario_id: c.id });
      setOcupado(null);
      if (!r.ok) {
        setAviso({ ok: false, texto: r.erro });
        return;
      }
      cod = r.dados.codigo;
      setCodigo(cod);
      setAviso({ ok: true, texto: r.dados.mensagem });
      router.refresh();
    }
    setTexto((t) => `${t.trim()} (informe o código ${cod})`.trim());
  }

  async function responderComIa() {
    // já tem texto escrito para este comentário: mostra esse, sem gastar IA de novo
    if (c.rascunho) {
      abrir(c.rascunho, c.rascunho_editado ? null : c.rascunho);
      setAviso({
        ok: true,
        texto: c.rascunho_editado
          ? "Este é o texto que você já tinha salvo para este comentário."
          : `Esta é a sugestão que a IA já tinha escrito${naFila ? " (está na fila)" : ""}. Para outra, use “Refazer com a IA”.`,
      });
      return;
    }
    await escreverComIa(false);
  }

  /** depois de salvar um treinamento: refaz já com ele, sem apagar o texto do médico sem ele pedir */
  function depoisDoTreino(refazerAgora: boolean, trocarEdicao: boolean) {
    if (!refazerAgora) return;
    if (temTextoDele && !trocarEdicao) {
      setAviso({ ok: true, texto: "Treinamento salvo. O seu texto ficou como estava." });
      return;
    }
    return escreverComIa(trocarEdicao);
  }

  async function publicar() {
    setOcupado("publicar");
    setAviso(null);
    const t = texto.trim();
    const r = await chamarFuncao<{ mensagem: string }>("youtube-responder", { acao: "publicar", comentario_id: c.id, texto: t });
    setOcupado(null);
    setConfirmar(false);
    if (!r.ok) {
      setAviso({ ok: false, texto: r.erro });
      router.refresh();
      return;
    }
    const aprende = editouDeVerdade(daIa ?? c.sugestao_ia, t);
    setAviso({ ok: true, texto: aprende ? `${r.dados.mensagem} Você mudou o texto da IA: ele entra em "Aprender com minhas edições".` : r.dados.mensagem });
    setAberto(false);
    router.refresh();
  }

  async function guardar() {
    setOcupado("salvar");
    const r = await salvarRascunho(c.id, texto);
    setOcupado(null);
    setAviso(r.ok ? { ok: true, texto: "Salvo em “Respostas para revisar”. Dá para publicar de lá ou daqui." } : { ok: false, texto: r.msg });
    if (r.ok) {
      setDaIa(null);
      router.refresh();
    }
  }

  async function ignorar() {
    setOcupado("ignorar");
    const r = await ignorarResposta(c.id);
    setOcupado(null);
    setAviso(r.ok ? { ok: true, texto: "Tirado da fila de respostas." } : { ok: false, texto: r.msg });
    setAberto(false);
    router.refresh();
  }

  const carregando = (rotulo: string) => <><LoaderCircle size={14} className="animate-spin" /> {rotulo}</>;

  return (
    <div className="space-y-2 pt-1">
      {!aberto && revisada && (
        <p className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-emerald-800">Na fila de “Respostas para revisar”, com a barra verde.</span>
          <Link href={naFilaHref} className="underline">Abrir na fila</Link>
        </p>
      )}
      {!aberto && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="botao-claro" disabled={parado} onClick={() => abrir(c.rascunho_editado ? c.rascunho ?? "" : "", null)}>
            <MessageSquareReply size={14} /> Responder
          </button>
          <button type="button" className="botao-claro" disabled={parado} onClick={responderComIa}>
            {ocupado === "ia" ? carregando("A IA está escrevendo…") : <><Sparkles size={14} /> Responder com IA</>}
          </button>
          {!revisada && c.resposta !== "falhou" && (
            <button type="button" className="botao-claro" disabled={parado} onClick={enviarParaRevisar}
              title="A IA escreve a resposta e ela vai para “Respostas para revisar” com a barra verde, pronta para publicar no lote">
              {ocupado === "enviar" ? carregando(c.resposta === "rascunho" ? "Marcando…" : "A IA está escrevendo…") : <><ListPlus size={14} /> Enviar para revisar</>}
            </button>
          )}
          {naFila && (
            <button type="button" className="botao-claro" disabled={parado} onClick={ignorar}>{ocupado === "ignorar" ? "…" : "Ignorar"}</button>
          )}
          <button type="button" className="botao-claro" disabled={parado} onClick={() => setTreinando(true)}><GraduationCap size={14} /> Treinamento da IA</button>
          {verNoYoutube}
          {naFila && !revisada && <span className="text-xs text-zinc-500">{c.resposta === "falhou" ? "na fila, com um problema para corrigir" : "já tem resposta na fila"}</span>}
        </div>
      )}

      {aberto && (
        <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          {problema && <p className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"><b>Atenção:</b> {problema}</p>}
          <label className="rotulo" htmlFor={`resp-${c.id}`}>
            {daIa !== null && texto.trim() === daIa.trim() ? "Resposta sugerida pela IA" : "Sua resposta"}
          </label>
          <textarea id={`resp-${c.id}`} className="campo bg-white leading-relaxed" rows={4} value={texto} disabled={parado} autoFocus
            placeholder="Escreva a resposta que vai sair no YouTube em seu nome." onChange={(e) => setTexto(e.target.value)} />
          <div className="text-xs text-zinc-400">{texto.length} caracteres</div>
          <p className="text-xs text-zinc-600">
            {codigo
              ? <>Lead <b>{codigo}</b>: se indicar WhatsApp ou telefone, peça para a pessoa dizer este código.</>
              : elogio ? "Agradecimento de elogio: a pessoa não vira lead."
                : "Esta pessoa ainda não é lead: vira lead (com código) quando você publicar ou pedir à IA."}
            {!elogio && !(codigo && texto.toUpperCase().includes(codigo.toUpperCase())) && (
              <button type="button" className="ml-2 font-medium underline" disabled={parado} onClick={porCodigo}>
                {ocupado === "codigo" ? "Criando o lead…" : "Pôr o código no texto"}
              </button>
            )}
          </p>
          {video && (
            <p className="text-xs text-zinc-600">
              A IA indicou o vídeo do canal{" "}
              <a href={LINK_VIDEO(video)} target="_blank" rel="noreferrer" className="underline">{videoIndicado && video === c.video_sugerido ? videoIndicado : "(abrir o vídeo)"} <ExternalLink size={10} className="inline" /></a>
              {" "}— confira se responde à dúvida antes de publicar.
            </p>
          )}

          {confirmar ? (
            <div className="space-y-2 text-sm">
              <p>Publicar esta resposta no YouTube, como <b>{canal}</b>? Ela fica pública em seu nome.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="botao" onClick={publicar} disabled={parado}>{ocupado === "publicar" ? carregando("Publicando…") : "Confirmar e publicar"}</button>
                <button type="button" className="botao-claro" onClick={() => setConfirmar(false)} disabled={parado}>Cancelar</button>
              </div>
            </div>
          ) : pedindo ? (
            <div className="space-y-2">
              <label className="rotulo" htmlFor={`inst-${c.id}`}>O que a IA deve considerar? (opcional)</label>
              <input id={`inst-${c.id}`} className="campo bg-white" value={instrucao} onChange={(e) => setInstrucao(e.target.value)} maxLength={500}
                placeholder="Ex.: mais curta; ofereça só a telemedicina; explique a recuperação" />
              {temTextoDele && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="accent-teal-700" checked={trocar} onChange={(e) => setTrocar(e.target.checked)} />
                  Trocar o seu texto pela sugestão da IA.
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="botao" onClick={() => escreverComIa(trocar)} disabled={parado || (temTextoDele && !trocar)}>
                  {ocupado === "ia" ? carregando("Escrevendo…") : <><Sparkles size={14} /> {daIa !== null || texto.trim() ? "Refazer com a IA" : "Escrever com a IA"}</>}
                </button>
                <button type="button" className="botao-claro" onClick={() => setPedindo(false)} disabled={parado}>Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="botao" disabled={parado || texto.trim().length < 2} onClick={() => (semConfirmar ? publicar() : setConfirmar(true))}>
                {ocupado === "publicar" ? carregando("Publicando…") : <><Send size={14} /> Publicar</>}
              </button>
              <button type="button" className="botao-claro" disabled={parado} onClick={() => setPedindo(true)}>
                <Sparkles size={14} /> {daIa !== null || texto.trim() ? "Refazer com a IA" : "Escrever com a IA"}
              </button>
              {texto.trim().length >= 2 && texto.trim() !== (c.rascunho ?? "").trim() && (
                <button type="button" className="botao-claro" disabled={parado} onClick={guardar}>{ocupado === "salvar" ? "Salvando…" : "Salvar na fila"}</button>
              )}
              <button type="button" className="botao-claro" disabled={parado} onClick={() => setTreinando(true)}><GraduationCap size={14} /> Treinamento da IA</button>
              <button type="button" className="botao-claro" disabled={parado} onClick={() => { setAberto(false); setAviso(null); }}>Fechar</button>
            </div>
          )}
        </div>
      )}

      {ocupado === "ia" && aberto && <p className="flex items-center gap-2 text-xs text-zinc-600"><LoaderCircle size={12} className="animate-spin" /> A IA está escrevendo…</p>}
      {treinando && (
        <JanelaTreino clienteId={clienteId} comentarioId={c.id} comentario={c.texto} rascunho={texto} editado={temTextoDele}
          aoFechar={() => setTreinando(false)} aoSalvar={depoisDoTreino} />
      )}
      {avisoNaTela}
    </div>
  );
}
