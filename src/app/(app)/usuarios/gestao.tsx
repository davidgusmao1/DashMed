"use client";

// Criar conta, gerar o link de primeiro acesso, mudar o papel, desativar e
// reativar. Tudo pela edge function `usuarios`, que confere quem pediu; aqui só
// se mostra o resultado — inclusive a recusa, com o motivo.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, MessageCircle, UserPlus } from "lucide-react";
import { chamarFuncao } from "@/lib/funcoes";
import { instanteBR } from "@/lib/datas";

export type Conta = {
  id: string; nome: string; email: string; papel: "admin" | "membro"; plataforma: boolean; ativo: boolean;
  criado_em: string; ultimo_acesso: string | null; ja_entrou: boolean; bloqueado_no_auth: boolean;
};
type Link = { token_hash: string; tipo: string; vale_minutos: number };
type Aviso = { ok: boolean; texto: string } | null;

function CaixaDoLink({ nome, link, fechar }: { nome: string; link: Link; fechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const url = `${window.location.origin}/auth/confirm?token_hash=${encodeURIComponent(link.token_hash)}&type=${encodeURIComponent(link.tipo)}`;
  const mensagem = `Olá, ${nome.split(" ")[0]}! Este é o seu acesso à DashMed: ${url}\nO link vale ${link.vale_minutos} minutos e funciona uma vez só. Ao entrar, defina a sua senha em "Minha conta".`;
  return (
    <div className="cartao space-y-3 border-teal-200 bg-teal-50/40 p-5">
      <div className="text-sm font-semibold">Link de primeiro acesso de {nome}</div>
      <p className="text-xs text-zinc-600">
        Vale {link.vale_minutos} minutos e funciona uma vez só. Quem abrir este link entra na conta de {nome.split(" ")[0]}: mande só para ela, nunca em grupo.
      </p>
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="campo font-mono text-xs" />
      <div className="flex flex-wrap gap-2">
        <button className="botao" onClick={async () => { await navigator.clipboard.writeText(mensagem); setCopiado(true); }}>
          {copiado ? <Check size={16} /> : <Copy size={16} />} {copiado ? "Copiado" : "Copiar mensagem com o link"}
        </button>
        <a className="botao-claro" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`}>
          <MessageCircle size={16} /> Enviar pelo WhatsApp
        </a>
        <button className="botao-claro" onClick={fechar}>Fechar</button>
      </div>
    </div>
  );
}

export default function Gestao({ clienteId, contas, euId, euPlataforma }: {
  clienteId: string; contas: Conta[]; euId: string; euPlataforma: boolean;
}) {
  const router = useRouter();
  const [aviso, setAviso] = useState<Aviso>(null);
  const [link, setLink] = useState<{ nome: string; link: Link } | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  function acao(corpo: Record<string, unknown>, depois?: (d: { mensagem?: string; nome?: string; link?: Link }) => void) {
    setAviso(null);
    iniciar(async () => {
      const r = await chamarFuncao<{ mensagem?: string; nome?: string; link?: Link }>("usuarios", { cliente_id: clienteId, ...corpo });
      if (!r.ok) return setAviso({ ok: false, texto: r.erro });
      if (r.dados.mensagem) setAviso({ ok: true, texto: r.dados.mensagem });
      depois?.(r.dados);
      router.refresh();
    });
  }

  function criar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const form = e.currentTarget;
    acao({ acao: "criar", nome: fd.get("nome"), email: fd.get("email"), papel: fd.get("papel") }, (d) => {
      form.reset();
      if (d.link && d.nome) setLink({ nome: d.nome, link: d.link });
    });
  }

  return (
    <div className="space-y-5">
      <form onSubmit={criar} className="cartao space-y-3 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold"><UserPlus size={16} /> Nova conta</div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="rotulo" htmlFor="nome">Nome</label>
            <input id="nome" name="nome" required minLength={2} maxLength={120} className="campo" placeholder="Ex.: Maria Souza" />
          </div>
          <div>
            <label className="rotulo" htmlFor="email">E-mail</label>
            <input id="email" name="email" type="email" required className="campo" placeholder="maria@clinica.com.br" />
          </div>
          <div>
            <label className="rotulo" htmlFor="papel">Papel</label>
            <select id="papel" name="papel" defaultValue="membro" className="campo">
              <option value="membro">Membro (secretária)</option>
              <option value="admin">Administrador(a)</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-zinc-500">Membro usa a Agenda e o CRM. Administrador(a) também cria e desativa contas e mexe nas chaves de API.</p>
        <button className="botao" disabled={ocupado}>{ocupado ? "Aguarde…" : "Criar conta e gerar o link de acesso"}</button>
      </form>

      {aviso && <p className={`rounded-lg px-3 py-2 text-sm ${aviso.ok ? "bg-teal-50 text-teal-900" : "bg-zinc-100 text-zinc-900"}`}>{aviso.texto}</p>}
      {link && <CaixaDoLink nome={link.nome} link={link.link} fechar={() => setLink(null)} />}

      <div className="cartao divide-y divide-zinc-100">
        {contas.map((c) => {
          const proprio = c.id === euId;
          const travada = proprio || (c.plataforma && !euPlataforma);
          const podeLink = !travada && c.ativo && !c.plataforma && (!c.ja_entrou || euPlataforma);
          return (
            <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {c.nome}
                  {proprio && <span className="text-xs font-normal text-zinc-500">(você)</span>}
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${c.papel === "admin" ? "bg-teal-50 text-teal-800" : "bg-zinc-100 text-zinc-700"}`}>
                    {c.papel === "admin" ? "Administrador(a)" : "Membro"}
                  </span>
                  {c.plataforma && <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[11px] font-medium text-white">Equipe da plataforma</span>}
                  {!c.ativo && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">Desativada</span>}
                </div>
                <div className="text-xs text-zinc-500">
                  {c.email} · {c.ja_entrou ? `último acesso ${instanteBR(c.ultimo_acesso)}` : "ainda não entrou"}
                </div>
              </div>
              {!travada && (
                <div className="flex flex-wrap gap-2">
                  {podeLink && (
                    <button className="botao-claro py-1.5 text-xs" disabled={ocupado}
                      onClick={() => acao({ acao: "link", usuario_id: c.id }, (d) => d.link && setLink({ nome: c.nome, link: d.link }))}>
                      <KeyRound size={14} /> Link de {c.ja_entrou ? "acesso" : "primeiro acesso"}
                    </button>
                  )}
                  {c.ativo && (
                    <button className="botao-claro py-1.5 text-xs" disabled={ocupado}
                      onClick={() => acao({ acao: "papel", usuario_id: c.id, papel: c.papel === "admin" ? "membro" : "admin" })}>
                      {c.papel === "admin" ? "Tornar membro" : "Tornar administrador(a)"}
                    </button>
                  )}
                  {c.ativo ? (
                    confirmando === c.id ? (
                      <>
                        <button className="botao-perigo py-1.5 text-xs" disabled={ocupado}
                          onClick={() => { setConfirmando(null); acao({ acao: "desativar", usuario_id: c.id }); }}>
                          Confirmar: desativar {c.nome.split(" ")[0]}
                        </button>
                        <button className="botao-claro py-1.5 text-xs" onClick={() => setConfirmando(null)}>Cancelar</button>
                      </>
                    ) : (
                      <button className="botao-claro py-1.5 text-xs" disabled={ocupado} onClick={() => setConfirmando(c.id)}>Desativar</button>
                    )
                  ) : (
                    <button className="botao-claro py-1.5 text-xs" disabled={ocupado} onClick={() => acao({ acao: "reativar", usuario_id: c.id })}>Reativar</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {contas.length === 0 && <p className="p-4 text-sm text-zinc-500">Nenhuma conta ainda.</p>}
      </div>
      <p className="text-xs text-zinc-500">
        Desativar bloqueia a entrada na hora e mantém o histórico (ligações e mudanças continuam com o nome da pessoa). Dá para reativar depois.
      </p>
    </div>
  );
}
