"use client";

// Conexão do canal do YouTube para o YouTube Seller (David, 12/11/26). Dois
// passos: (1) o Client ID e o Client Secret do OAuth, criados no Google Cloud
// do próprio médico; (2) "Conectar canal", que leva ao Google e volta. O
// acesso contínuo (refresh token) fica no Vault; a tela vê só o canal.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CircleCheck, CircleX, Copy } from "lucide-react";
import { dataHora, type Integracao } from "@/lib/conteudo";
import { chamarFuncao } from "@/lib/funcoes";
import { REDIRECT_OAUTH } from "@/lib/youtube";

type Aviso = { ok: boolean; texto: string } | null;

export default function YoutubeConexao({ clienteId, google, youtube, podeEditar, retorno }: {
  clienteId: string;
  google: Integracao | undefined;
  youtube: Integracao | undefined;
  podeEditar: boolean;
  retorno: { ok: boolean; texto: string } | null;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso>(retorno);
  const [confirmar, setConfirmar] = useState<"google" | "youtube" | null>(null);
  const [copiado, setCopiado] = useState(false);
  const canal = youtube?.parametros as { canal_titulo?: string; canal_foto?: string | null; canal_id?: string; conectado_em?: string } | undefined;
  const gid = (google?.parametros as { client_id?: string } | undefined)?.client_id;

  async function chamar(acao: string, extra: Record<string, unknown>) {
    setOcupado(acao + (extra.provedor ?? ""));
    setAviso(null);
    const r = await chamarFuncao<{ ok: boolean; mensagem: string }>("integracoes", { acao, cliente_id: clienteId, ...extra });
    setOcupado(null);
    setConfirmar(null);
    setAviso(r.ok ? { ok: r.dados.ok, texto: r.dados.mensagem } : { ok: false, texto: r.erro });
    if (r.ok && acao === "salvar_chave") { setClientId(""); setSecret(""); }
    router.refresh();
  }

  async function conectar() {
    setOcupado("conectar");
    setAviso(null);
    const r = await chamarFuncao<{ url: string }>("youtube-oauth", { cliente_id: clienteId, retorno: `${window.location.origin}/configuracoes` });
    if (!r.ok) {
      setOcupado(null);
      return setAviso({ ok: false, texto: r.erro });
    }
    window.location.href = r.dados.url;
  }

  return (
    <div className="cartao space-y-4 p-5">
      <div>
        <div className="text-sm font-semibold">Canal do YouTube</div>
        <p className="text-xs text-zinc-500">Para ler os comentários e publicar as respostas que você aprovar, em seu nome.</p>
      </div>

      {/* 1. credenciais do Google */}
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">1. Credenciais do Google (OAuth)</div>
        {google ? (
          <p className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm">
            <CircleCheck size={16} className="text-teal-700" />
            <span className="min-w-0 truncate">Client ID <span className="font-mono text-xs">{gid}</span> · secret ••••{google.final}</span>
          </p>
        ) : (
          <p className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600">Ainda não configurado. Veja o passo a passo abaixo.</p>
        )}
        {podeEditar && (
          <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => {
            e.preventDefault();
            if (clientId.trim() && secret.trim()) chamar("salvar_chave", { provedor: "google", client_id: clientId.trim(), chave: secret.trim() });
          }}>
            <input className="campo font-mono text-xs" placeholder="Client ID (…apps.googleusercontent.com)" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client ID" />
            <input className="campo font-mono text-xs" type="password" autoComplete="off" placeholder="Client Secret" value={secret} onChange={(e) => setSecret(e.target.value)} aria-label="Client Secret" />
            <button className="botao" disabled={!clientId.trim() || !secret.trim() || !!ocupado}>{google ? "Trocar" : "Salvar"}</button>
          </form>
        )}
        <div className="text-xs text-zinc-500">
          URI de redirecionamento autorizado (cole no Google Cloud):{" "}
          <button type="button" className="inline-flex items-center gap-1 font-mono text-zinc-700 underline" onClick={async () => {
            try { await navigator.clipboard.writeText(REDIRECT_OAUTH); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sem área de transferência */ }
          }}>{REDIRECT_OAUTH} <Copy size={11} /></button>{copiado && " copiado"}
        </div>
      </div>

      {/* 2. canal */}
      <div className="space-y-2 border-t border-zinc-100 pt-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">2. Canal conectado</div>
        {youtube && canal ? (
          <div className="flex items-center gap-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm">
            {canal.canal_foto && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={canal.canal_foto} alt="" className="size-9 rounded-full" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-medium">
                {youtube.teste_ok ? <CircleCheck size={15} className="text-teal-700" /> : <CircleX size={15} className="text-zinc-500" />}
                {canal.canal_titulo}
              </div>
              <div className="text-xs text-zinc-500">{youtube.teste_msg} · {dataHora(youtube.testada_em)}</div>
            </div>
          </div>
        ) : (
          <p className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600">Nenhum canal conectado.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {podeEditar && (
            <button className="botao" onClick={conectar} disabled={!google || !!ocupado}>
              {ocupado === "conectar" ? "Abrindo o Google…" : youtube ? "Conectar de novo" : "Conectar canal do YouTube"}
            </button>
          )}
          {youtube && <button className="botao-claro" onClick={() => chamar("testar", { provedor: "youtube" })} disabled={!!ocupado}>{ocupado === "testaryoutube" ? "Testando…" : "Testar"}</button>}
          {youtube && podeEditar && confirmar !== "youtube" && <button className="botao-claro" onClick={() => setConfirmar("youtube")}>Desconectar</button>}
          {confirmar === "youtube" && (
            <>
              <button className="botao-perigo" onClick={() => chamar("apagar_chave", { provedor: "youtube" })} disabled={!!ocupado}>Confirmar desconexão</button>
              <button className="botao-claro" onClick={() => setConfirmar(null)}>Cancelar</button>
            </>
          )}
          {google && !youtube && podeEditar && confirmar !== "google" && <button className="botao-claro" onClick={() => setConfirmar("google")}>Remover credenciais</button>}
          {confirmar === "google" && (
            <>
              <button className="botao-perigo" onClick={() => chamar("apagar_chave", { provedor: "google" })} disabled={!!ocupado}>Confirmar remoção</button>
              <button className="botao-claro" onClick={() => setConfirmar(null)}>Cancelar</button>
            </>
          )}
        </div>
        {!google && <p className="text-xs text-zinc-500">Salve primeiro as credenciais do passo 1.</p>}
      </div>

      {aviso && <p className={`rounded-lg px-3 py-2 text-sm ${aviso.ok ? "bg-teal-50 text-teal-900" : "bg-zinc-100 text-zinc-900"}`}>{aviso.texto}</p>}

      <details className="text-sm text-zinc-700">
        <summary className="cursor-pointer font-medium">Passo a passo no Google Cloud (uma vez só, ~10 min)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Em <b>console.cloud.google.com</b>, com a conta do Google dona do canal, crie um projeto (ex.: &quot;DashMed&quot;).</li>
          <li>Em <b>APIs e serviços → Biblioteca</b>, ative a <b>YouTube Data API v3</b>.</li>
          <li>Em <b>Tela de consentimento OAuth</b> (Google Auth Platform): tipo <b>Externo</b>, nome do app &quot;DashMed&quot;, seu e-mail; em <b>Acesso a dados</b> adicione o escopo <code>youtube.force-ssl</code>.</li>
          <li>Em <b>Público-alvo</b>, clique em <b>Publicar app</b> (&quot;Em produção&quot;). Em modo de teste o Google derruba o acesso a cada 7 dias. Sem a verificação do Google, o login mostra um aviso de &quot;app não verificado&quot;: clique em <b>Avançado → Acessar DashMed</b>. É o seu próprio app.</li>
          <li>Em <b>Credenciais → Criar credenciais → ID do cliente OAuth</b>: tipo <b>Aplicativo da Web</b>; em <b>URIs de redirecionamento autorizados</b> cole o endereço acima.</li>
          <li>Copie o <b>Client ID</b> e o <b>Client Secret</b> para o passo 1 e clique em <b>Conectar canal do YouTube</b>.</li>
        </ol>
        <p className="mt-2 text-xs text-zinc-500">A cota grátis da API é de 10.000 unidades por dia: ler 100 comentários custa 1, publicar uma resposta custa 50 (dá cerca de 180 respostas por dia).</p>
      </details>
    </div>
  );
}
