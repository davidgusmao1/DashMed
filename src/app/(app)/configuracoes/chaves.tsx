"use client";

// Chaves de API do cliente. O valor digitado vai direto para a edge function
// "integracoes", que testa com o provedor e guarda no Vault; daqui para frente
// a tela só vê os 4 últimos caracteres (David, 10/11/26: "faça um local onde eu
// posso colocar as APIs/tokens necessárias").
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CircleCheck, CircleX, KeyRound } from "lucide-react";
import { dataHora, type Integracao, NOME_MOTOR, PRECO_MINUTO_HEYGEN } from "@/lib/conteudo";
import { chamarFuncao } from "@/lib/funcoes";

type Aviso = { ok: boolean; texto: string } | null;

const PROVEDORES = {
  anthropic: {
    nome: "Claude (Anthropic)",
    para: "Monta as buscas, faz a triagem dos artigos e escreve o roteiro.",
    onde: "Crie em console.anthropic.com → API Keys (a conta precisa de crédito).",
    link: "https://console.anthropic.com/settings/keys",
  },
  heygen: {
    nome: "HeyGen",
    para: "Gera o vídeo com o seu avatar digital e a sua voz.",
    onde: "Crie em app.heygen.com → Settings → API (a carteira de API precisa de saldo).",
    link: "https://app.heygen.com/settings?nav=API",
  },
} as const;

function CartaoChave({ clienteId, provedor, integ, podeEditar }: {
  clienteId: string; provedor: "anthropic" | "heygen"; integ: Integracao | undefined; podeEditar: boolean;
}) {
  const router = useRouter();
  const info = PROVEDORES[provedor];
  const [chave, setChave] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [confirmarRemocao, setConfirmarRemocao] = useState(false);

  async function chamar(acao: string, extra: Record<string, unknown> = {}) {
    setOcupado(acao);
    setAviso(null);
    const r = await chamarFuncao<{ ok: boolean; mensagem: string }>("integracoes", { acao, cliente_id: clienteId, provedor, ...extra });
    setOcupado(null);
    if (!r.ok) setAviso({ ok: false, texto: r.erro });
    else setAviso({ ok: r.dados.ok, texto: r.dados.mensagem });
    if (r.ok && acao === "salvar_chave") setChave("");
    setConfirmarRemocao(false);
    router.refresh();
  }

  return (
    <div className="cartao space-y-3 p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-600"><KeyRound size={18} /></span>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{info.nome}</div>
          <p className="text-xs text-zinc-500">{info.para}</p>
        </div>
      </div>

      {integ ? (
        <div className="rounded-lg bg-zinc-50 px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            {integ.teste_ok ? <CircleCheck size={16} className="text-teal-700" /> : <CircleX size={16} className="text-zinc-500" />}
            <span>Chave salva, termina em <b className="font-mono">••••{integ.final}</b></span>
          </div>
          {integ.teste_msg && <p className="mt-1 text-xs text-zinc-600">{integ.teste_msg} <span className="text-zinc-400">(testada em {dataHora(integ.testada_em)})</span></p>}
        </div>
      ) : (
        <p className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600">Nenhuma chave salva. <a href={info.link} target="_blank" rel="noreferrer" className="underline">{info.onde}</a></p>
      )}

      {podeEditar && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (chave.trim()) chamar("salvar_chave", { chave: chave.trim() }); }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input
            type="password" autoComplete="off" spellCheck={false} className="campo font-mono" value={chave}
            onChange={(e) => setChave(e.target.value)} placeholder={integ ? "Colar uma chave nova para trocar" : "Colar a chave"}
            aria-label={`Chave da ${info.nome}`}
          />
          <button className="botao shrink-0" disabled={!chave.trim() || !!ocupado}>{ocupado === "salvar_chave" ? "Testando…" : "Testar e salvar"}</button>
        </form>
      )}

      {integ && (
        <div className="flex flex-wrap gap-2">
          <button className="botao-claro" onClick={() => chamar("testar")} disabled={!!ocupado}>{ocupado === "testar" ? "Testando…" : "Testar de novo"}</button>
          {podeEditar && !confirmarRemocao && (
            <button className="botao-claro" onClick={() => setConfirmarRemocao(true)} disabled={!!ocupado}>Remover chave</button>
          )}
          {podeEditar && confirmarRemocao && (
            <>
              <button className="botao-perigo" onClick={() => chamar("apagar_chave")} disabled={!!ocupado}>{ocupado === "apagar_chave" ? "Removendo…" : "Confirmar remoção"}</button>
              <button className="botao-claro" onClick={() => setConfirmarRemocao(false)}>Cancelar</button>
            </>
          )}
        </div>
      )}

      {aviso && <p className={`rounded-lg px-3 py-2 text-sm ${aviso.ok ? "bg-teal-50 text-teal-900" : "bg-zinc-100 text-zinc-900"}`}>{aviso.texto}</p>}

      {provedor === "heygen" && integ && <EscolhaAvatar clienteId={clienteId} integ={integ} podeEditar={podeEditar} />}
    </div>
  );
}

type Opcoes = {
  avatares: { id: string; nome: string; tipo: string; imagem: string | null; voz_padrao: string | null; motores: string[]; estado: string | null }[];
  vozes: { id: string; nome: string; idioma: string | null; propria: boolean; estado: string | null }[];
};

function EscolhaAvatar({ clienteId, integ, podeEditar }: { clienteId: string; integ: Integracao; podeEditar: boolean }) {
  const router = useRouter();
  const p = integ.parametros;
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null);
  const [avatar, setAvatar] = useState(p.avatar_id ?? "");
  const [voz, setVoz] = useState(p.voz_id ?? "");
  const [motor, setMotor] = useState(p.motor ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);

  async function carregar() {
    setOcupado(true);
    setAviso(null);
    const r = await chamarFuncao<Opcoes & { ok: boolean }>("integracoes", { acao: "heygen_opcoes", cliente_id: clienteId });
    setOcupado(false);
    if (!r.ok) return setAviso({ ok: false, texto: r.erro });
    setOpcoes(r.dados);
    if (!r.dados.avatares.length) setAviso({ ok: false, texto: "Nenhum avatar próprio na sua conta da HeyGen ainda. Crie o seu gêmeo digital no app da HeyGen e volte aqui." });
  }

  async function salvar() {
    const a = opcoes?.avatares.find((x) => x.id === avatar);
    const v = opcoes?.vozes.find((x) => x.id === voz);
    setOcupado(true);
    setAviso(null);
    const r = await chamarFuncao<{ ok: boolean; mensagem: string }>("integracoes", {
      acao: "salvar_heygen", cliente_id: clienteId, avatar_id: avatar, avatar_nome: a?.nome, voz_id: voz, voz_nome: v?.nome, motor: motor || null,
    });
    setOcupado(false);
    setAviso(r.ok ? { ok: true, texto: r.dados.mensagem } : { ok: false, texto: r.erro });
    if (r.ok) router.refresh();
  }

  const escolhido = opcoes?.avatares.find((x) => x.id === avatar);
  const motores = escolhido?.motores.length ? escolhido.motores : ["avatar_iv", "avatar_iii"];

  return (
    <div className="space-y-3 border-t border-zinc-100 pt-3">
      <div className="text-sm font-semibold">Seu avatar e sua voz</div>
      {p.avatar_id ? (
        <p className="text-sm text-zinc-700">
          Avatar <b>{p.avatar_nome || p.avatar_id}</b> · voz <b>{p.voz_nome || p.voz_id}</b>
          {p.motor ? <> · {NOME_MOTOR[p.motor] ?? p.motor}</> : <> · motor padrão da HeyGen (Avatar IV)</>}
        </p>
      ) : (
        <p className="text-sm text-zinc-600">Ainda não escolhido. O vídeo só é gerado depois desta escolha.</p>
      )}
      {podeEditar && !opcoes && (
        <button className="botao-claro" onClick={carregar} disabled={ocupado}>{ocupado ? "Carregando…" : p.avatar_id ? "Trocar avatar ou voz" : "Carregar meus avatares e vozes"}</button>
      )}
      {opcoes && (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            {escolhido?.imagem && (
              // a prévia vem da HeyGen
              // eslint-disable-next-line @next/next/no-img-element
              <img src={escolhido.imagem} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <label className="rotulo" htmlFor="avatar">Avatar</label>
              <select id="avatar" className="campo" value={avatar} onChange={(e) => {
                setAvatar(e.target.value);
                const a = opcoes.avatares.find((x) => x.id === e.target.value);
                if (a?.voz_padrao && !voz) setVoz(a.voz_padrao);
              }}>
                <option value="">Escolha…</option>
                {opcoes.avatares.map((a) => (
                  <option key={a.id} value={a.id} disabled={!!a.estado && a.estado !== "completed"}>
                    {a.nome} · {a.tipo === "digital_twin" ? "gêmeo digital" : a.tipo === "photo_avatar" ? "avatar de foto" : a.tipo}
                    {a.estado && a.estado !== "completed" ? ` (${a.estado})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="rotulo" htmlFor="voz">Voz</label>
            <select id="voz" className="campo" value={voz} onChange={(e) => setVoz(e.target.value)}>
              <option value="">Escolha…</option>
              <optgroup label="Suas vozes (clonadas)">
                {opcoes.vozes.filter((v) => v.propria).map((v) => <option key={v.id} value={v.id} disabled={v.estado === "FAILED" || v.estado === "PENDING"}>{v.nome}{v.idioma ? ` · ${v.idioma}` : ""}</option>)}
              </optgroup>
              <optgroup label="Vozes públicas em português">
                {opcoes.vozes.filter((v) => !v.propria).map((v) => <option key={v.id} value={v.id}>{v.nome}{v.idioma ? ` · ${v.idioma}` : ""}</option>)}
              </optgroup>
            </select>
          </div>
          <div>
            <label className="rotulo" htmlFor="motor">Motor do avatar</label>
            <select id="motor" className="campo" value={motor} onChange={(e) => setMotor(e.target.value)}>
              <option value="">Padrão da HeyGen (Avatar IV)</option>
              {motores.map((m) => (
                <option key={m} value={m}>{NOME_MOTOR[m] ?? m}{PRECO_MINUTO_HEYGEN[m] != null ? ` · ~US$ ${PRECO_MINUTO_HEYGEN[m]!.toFixed(2)}/min` : ""}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button className="botao" onClick={salvar} disabled={ocupado || !avatar || !voz}>{ocupado ? "Salvando…" : "Salvar escolha"}</button>
            <button className="botao-claro" onClick={() => setOpcoes(null)} disabled={ocupado}>Cancelar</button>
          </div>
        </div>
      )}
      {aviso && <p className={`rounded-lg px-3 py-2 text-sm ${aviso.ok ? "bg-teal-50 text-teal-900" : "bg-zinc-100 text-zinc-900"}`}>{aviso.texto}</p>}
    </div>
  );
}

export default function Chaves({ clienteId, integracoes, podeEditar }: { clienteId: string; integracoes: Integracao[]; podeEditar: boolean }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CartaoChave clienteId={clienteId} provedor="anthropic" integ={integracoes.find((i) => i.provedor === "anthropic")} podeEditar={podeEditar} />
      <CartaoChave clienteId={clienteId} provedor="heygen" integ={integracoes.find((i) => i.provedor === "heygen")} podeEditar={podeEditar} />
    </div>
  );
}
