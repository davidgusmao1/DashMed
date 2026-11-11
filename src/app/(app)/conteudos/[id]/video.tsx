"use client";

// Passo 3: vídeo com o avatar do próprio médico na HeyGen (David, 10/11/26:
// "o vídeo deve seguir a imagem, ou seja eu"). Gerar custa dinheiro: a tela
// mostra a estimativa e só envia com a confirmação dele (regra 4).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Download, ExternalLink, LoaderCircle, Play, RefreshCw, Video as IconeVideo } from "lucide-react";
import {
  type Bloco, contarPalavras, dataHora, type Integracao, minutosDe, NOME_MOTOR, PRECO_MINUTO_HEYGEN, relogio, type Video,
} from "@/lib/conteudo";
import { chamarFuncao } from "@/lib/funcoes";

const ROTULO: Record<Video["estado"], string> = {
  enviando: "Enviando para a HeyGen…",
  processando: "A HeyGen está gerando o vídeo…",
  pronto: "Pronto",
  falhou: "Falhou",
};

type Links = { video_url: string; legendado_url: string | null; legenda_url: string | null; miniatura_url: string | null; pagina_url: string | null };

function LinhaVideo({ v }: { v: Video }) {
  const router = useRouter();
  const [links, setLinks] = useState<Links | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function chamar(acao: "atualizar" | "link") {
    setOcupado(acao);
    setAviso(null);
    const r = await chamarFuncao<Links & { estado?: string }>("conteudos-video", { acao, video_id: v.id });
    setOcupado(null);
    if (!r.ok) return setAviso(r.erro);
    if (acao === "link") setLinks(r.dados);
    router.refresh();
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {(v.estado === "enviando" || v.estado === "processando") && <LoaderCircle size={16} className="animate-spin text-teal-700" />}
        <b>{ROTULO[v.estado]}</b>
        <span className="text-zinc-500">{v.formato} · {v.avatar_nome ?? "avatar"} · {v.motor ? NOME_MOTOR[v.motor] ?? v.motor : "Avatar IV"}</span>
        <span className="text-xs text-zinc-400">pedido em {dataHora(v.criado_em)}</span>
        {v.duracao_seg != null && <span className="text-xs text-zinc-500">duração {relogio(v.duracao_seg / 60)}</span>}
      </div>
      {v.msg && <p className="text-sm text-zinc-700">{v.msg}</p>}
      <div className="flex flex-wrap gap-2">
        {v.estado === "processando" && (
          <button className="botao-claro" onClick={() => chamar("atualizar")} disabled={!!ocupado}><RefreshCw size={14} /> {ocupado === "atualizar" ? "Conferindo…" : "Conferir na HeyGen"}</button>
        )}
        {v.estado === "pronto" && !links && (
          <button className="botao" onClick={() => chamar("link")} disabled={!!ocupado}><Play size={14} /> {ocupado === "link" ? "Buscando…" : "Abrir vídeo"}</button>
        )}
      </div>
      {links && (
        <div className="space-y-2">
          <video src={links.video_url} poster={links.miniatura_url ?? undefined} controls className="w-full max-w-2xl rounded-lg bg-black" />
          <div className="flex flex-wrap gap-2 text-sm">
            <a className="botao-claro" href={links.video_url} target="_blank" rel="noreferrer"><Download size={14} /> Baixar vídeo</a>
            {links.legendado_url && <a className="botao-claro" href={links.legendado_url} target="_blank" rel="noreferrer"><Download size={14} /> Vídeo com legenda</a>}
            {links.legenda_url && <a className="botao-claro" href={links.legenda_url} target="_blank" rel="noreferrer"><Download size={14} /> Legenda (SRT)</a>}
            {links.pagina_url && <a className="botao-claro" href={links.pagina_url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Abrir na HeyGen</a>}
          </div>
          <p className="text-xs text-zinc-500">Os links da HeyGen expiram; baixe o arquivo. Para pegar links novos, clique em &quot;Abrir vídeo&quot; de novo.</p>
        </div>
      )}
      {aviso && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm">{aviso}</p>}
    </li>
  );
}

export default function PassoVideo({ roteiro, blocos, heygen, videos }: {
  roteiro: { id: string; estado: string; versao: number } | null;
  blocos: Bloco[];
  heygen: Integracao | null;
  videos: Video[];
}) {
  const router = useRouter();
  const [formato, setFormato] = useState<"16:9" | "9:16">("16:9");
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const par = heygen?.parametros ?? {};
  const pronto = roteiro?.estado === "pronto";
  const palavras = blocos.reduce((s, b) => s + contarPalavras(b.fala), 0);
  const minutos = minutosDe(palavras);
  const preco = PRECO_MINUTO_HEYGEN[par.motor ?? "avatar_iv"];
  const emAndamento = videos.filter((v) => v.estado === "processando");

  // enquanto a página está aberta, confere na HeyGen a cada minuto (o retorno
  // da HeyGen também avisa sozinho)
  useEffect(() => {
    if (!emAndamento.length) return;
    const t = setInterval(async () => {
      for (const v of emAndamento) await chamarFuncao("conteudos-video", { acao: "atualizar", video_id: v.id });
      router.refresh();
    }, 60_000);
    return () => clearInterval(t);
  }, [emAndamento.map((v) => v.id).join(","), router]); // eslint-disable-line react-hooks/exhaustive-deps

  async function gerar() {
    if (!roteiro) return;
    setOcupado(true);
    setAviso(null);
    const r = await chamarFuncao<{ mensagem: string }>("conteudos-video", { acao: "gerar", roteiro_id: roteiro.id, formato, confirmo_custo: true });
    setOcupado(false);
    setConfirmando(false);
    setAviso(r.ok ? { ok: true, texto: r.dados.mensagem } : { ok: false, texto: r.erro });
    router.refresh();
  }

  let bloqueio: React.ReactNode = null;
  if (!heygen) bloqueio = <>Falta a chave da HeyGen. <Link href="/configuracoes" className="underline">Coloque em Configurações</Link>.</>;
  else if (!par.avatar_id || !par.voz_id) bloqueio = <>Escolha o seu avatar e a sua voz em <Link href="/configuracoes" className="underline">Configurações → HeyGen</Link>.</>;
  else if (!roteiro) bloqueio = "Escreva o roteiro primeiro.";
  else if (!pronto) bloqueio = "Espere o roteiro terminar.";

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">3. Vídeo com o seu avatar</h2>
        <p className="text-sm text-zinc-500">A HeyGen gera o vídeo com o seu gêmeo digital falando o roteiro{roteiro ? ` (versão ${roteiro.versao})` : ""}, com a sua voz.</p>
      </div>

      {bloqueio ? (
        <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm">{bloqueio}</p>
      ) : (
        <div className="cartao space-y-3 p-5">
          <div className="text-sm">
            Avatar <b>{par.avatar_nome}</b> · voz <b>{par.voz_nome}</b> · {par.motor ? NOME_MOTOR[par.motor] ?? par.motor : "Avatar IV (padrão)"}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="rotulo" htmlFor="formato">Formato</label>
              <select id="formato" className="campo w-auto" value={formato} onChange={(e) => setFormato(e.target.value as "16:9" | "9:16")}>
                <option value="16:9">16:9 — YouTube</option>
                <option value="9:16">9:16 — vertical (Reels, Shorts)</option>
              </select>
            </div>
            <div className="text-sm text-zinc-700">
              Duração estimada <b>{relogio(minutos)}</b>
              {preco != null && <> · custo aproximado <b>US$ {(preco * minutos).toFixed(0)}</b> na HeyGen</>}
            </div>
          </div>
          {!confirmando ? (
            <button className="botao" onClick={() => setConfirmando(true)} disabled={ocupado}><IconeVideo size={16} /> Gerar vídeo com o meu avatar</button>
          ) : (
            <div className="space-y-2 rounded-lg bg-zinc-50 p-3 text-sm">
              <p>
                Isto consome créditos da sua conta da HeyGen{preco != null ? ` (cerca de US$ ${(preco * minutos).toFixed(0)}, pelo preço público; o valor certo é o da sua conta)` : ""}.
                Confira o roteiro antes: depois de enviado, não dá para editar o vídeo.
              </p>
              <div className="flex gap-2">
                <button className="botao" onClick={gerar} disabled={ocupado}>{ocupado ? "Enviando…" : "Confirmar e gerar"}</button>
                <button className="botao-claro" onClick={() => setConfirmando(false)} disabled={ocupado}>Cancelar</button>
              </div>
            </div>
          )}
          {aviso && <p className={`rounded-lg px-3 py-2 text-sm ${aviso.ok ? "bg-teal-50 text-teal-900" : "bg-zinc-100 text-zinc-900"}`}>{aviso.texto}</p>}
        </div>
      )}

      {videos.length > 0 && (
        <div className="cartao px-5 py-2">
          <ul className="divide-y divide-zinc-100">{videos.map((v) => <LinhaVideo key={v.id} v={v} />)}</ul>
        </div>
      )}

      {videos.some((v) => v.estado === "pronto") && (
        <div className="cartao space-y-2 p-5 text-sm text-zinc-700">
          <div className="font-semibold">Antes de publicar</div>
          <ul className="list-disc space-y-1 pl-5">
            <li>Assista ao vídeo inteiro e confira os números contra as referências.</li>
            <li>No YouTube Studio, marque <b>&quot;Conteúdo alterado ou sintético: Sim&quot;</b> (o avatar é realista e gerado por IA). No Instagram, use o rótulo de IA.</li>
            <li>Use a descrição pronta do passo 2: ela já tem as referências, a sua identificação e o aviso de avatar digital.</li>
            <li>Confira nome, CRM e RQE, e que não há promessa de resultado, preço ou caso de paciente (Resolução CFM 2.336/2023).</li>
          </ul>
        </div>
      )}
    </section>
  );
}
