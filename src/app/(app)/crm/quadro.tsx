"use client";

// Quadro Kanban do resgate: uma coluna por etapa, um cartão por terapia
// (paciente + procedimento indicado). No computador arrasta-se o cartão; no
// celular, move-se pelo "Mover para" do registro da ligação.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Phone, PhoneOff, X } from "lucide-react";
import { ETAPAS, ROTULO_ETAPA, ROTULO_RESULTADO, type Etapa } from "@/lib/crm";
import { dataBR, diasEntre, instanteBR } from "@/lib/datas";
import { telefoneBR } from "@/lib/telefone";
import { moverEtapa } from "./acoes";
import { EscolherResponsavel, RegistrarLigacao } from "./registrar-ligacao";

export type Cartao = {
  id: string;
  procedimento: string;
  ultima_indicacao_em: string | null;
  revisar: boolean;
  revisar_motivo: string | null;
  situacao: Etapa;
  retornar_em: string | null;
  contatos_qtd: number;
  ultimo_contato_em: string | null;
  ultimo_resultado: string | null;
  responsavel_id: string | null;
  pacientes: { nome: string; telefone: string | null } | null;
};
export type Coluna = { etapa: Etapa; total: number; cartoes: Cartao[] };

function tempoDesde(iso: string | null, hoje: string): string {
  if (!iso) return "";
  const d = diasEntre(iso, hoje);
  if (d < 31) return `há ${d} dias`;
  const m = Math.round(d / 30.4);
  return m < 12 ? `há ${m} ${m === 1 ? "mês" : "meses"}` : `há ${Math.floor(m / 12)} ano${m >= 24 ? "s" : ""}${m % 12 ? ` e ${m % 12} m` : ""}`;
}

function iniciais(nome: string): string {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

export default function Quadro({ colunas, usuarios, hoje }: {
  colunas: Coluna[]; usuarios: { id: string; nome: string }[]; hoje: string;
}) {
  const router = useRouter();
  const [movidos, setMovidos] = useState<Record<string, Etapa>>({});
  const [aberto, setAberto] = useState<Cartao | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<Etapa | null>(null);
  const [, iniciar] = useTransition();

  const todos = colunas.flatMap((c) => c.cartoes);
  const etapaDe = (c: Cartao) => movidos[c.id] ?? c.situacao;
  const nomeDe = (id: string | null) => usuarios.find((u) => u.id === id)?.nome ?? null;

  function mover(id: string, etapa: Etapa) {
    const cartao = todos.find((c) => c.id === id);
    if (!cartao || etapaDe(cartao) === etapa) return;
    const antes = etapaDe(cartao);
    setMovidos((m) => ({ ...m, [id]: etapa }));
    setAviso(null);
    iniciar(async () => {
      const r = await moverEtapa(id, etapa);
      if (!r.ok) {
        setMovidos((m) => ({ ...m, [id]: antes }));
        setAviso(r.texto);
      } else router.refresh();
    });
  }

  return (
    <>
      {aviso && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900">{aviso}</p>}
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
        {colunas.map((col) => {
          const cartoes = todos.filter((c) => etapaDe(c) === col.etapa);
          const delta = cartoes.length - col.cartoes.length;
          return (
            <section key={col.etapa}
              onDragOver={(e) => { e.preventDefault(); setSobre(col.etapa); }}
              onDragLeave={() => setSobre((s) => (s === col.etapa ? null : s))}
              onDrop={(e) => { e.preventDefault(); setSobre(null); const id = e.dataTransfer.getData("text/plain"); if (id) mover(id, col.etapa); }}
              className={`flex w-72 shrink-0 snap-start flex-col rounded-xl border bg-zinc-100/70 ${sobre === col.etapa ? "border-teal-600 ring-2 ring-teal-200" : "border-zinc-200"}`}>
              <header className="flex items-center justify-between px-3 py-2">
                <h2 className="text-sm font-semibold">{ROTULO_ETAPA[col.etapa]}</h2>
                <span className="rounded-full bg-white px-2 text-xs text-zinc-600">{col.total + delta}</span>
              </header>
              <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
                {cartoes.map((c) => {
                  const atrasado = c.retornar_em ? diasEntre(hoje, c.retornar_em) <= 0 : false;
                  const resp = nomeDe(c.responsavel_id);
                  return (
                    <article key={c.id} draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.id); setArrastando(c.id); }}
                      onDragEnd={() => setArrastando(null)}
                      onClick={() => setAberto(c)}
                      className={`cursor-pointer rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm hover:border-zinc-300 ${arrastando === c.id ? "opacity-50" : ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold leading-tight">{c.pacientes?.nome ?? "—"}</div>
                        {resp && <span title={resp} className="grid size-6 shrink-0 place-items-center rounded-full bg-teal-700 text-[10px] font-semibold text-white">{iniciais(resp)}</span>}
                      </div>
                      <div className="mt-1 text-xs text-zinc-600">
                        <span className="font-medium text-zinc-800">{c.procedimento}</span> · indicado {dataBR(c.ultima_indicacao_em)} ({tempoDesde(c.ultima_indicacao_em, hoje)})
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-xs text-zinc-600">
                        {c.pacientes?.telefone ? <><Phone size={11} /> {telefoneBR(c.pacientes.telefone)}</> : <><PhoneOff size={11} /> sem telefone</>}
                      </div>
                      {c.contatos_qtd > 0 && (
                        <div className="mt-1 text-xs text-zinc-500">
                          {c.contatos_qtd} {c.contatos_qtd === 1 ? "ligação" : "ligações"} · última: {ROTULO_RESULTADO[c.ultimo_resultado ?? ""] ?? "—"} ({instanteBR(c.ultimo_contato_em).slice(0, 5)})
                        </div>
                      )}
                      {(c.retornar_em || c.revisar) && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {c.retornar_em && (
                            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${atrasado ? "bg-red-50 text-red-700" : "bg-zinc-100 text-zinc-700"}`}>
                              ligar {diasEntre(hoje, c.retornar_em) === 0 ? "hoje" : `em ${dataBR(c.retornar_em).slice(0, 5)}`}
                            </span>
                          )}
                          {c.revisar && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">{c.revisar_motivo ?? "revisar"}</span>}
                        </div>
                      )}
                    </article>
                  );
                })}
                {col.total > col.cartoes.length && (
                  <p className="px-1 text-[11px] text-zinc-500">Mostrando {col.cartoes.length} de {col.total}. Use a busca ou o filtro para achar os outros.</p>
                )}
                {cartoes.length === 0 && <p className="px-1 py-4 text-center text-xs text-zinc-400">Nenhum cartão</p>}
              </div>
            </section>
          );
        })}
      </div>

      {aberto && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 md:items-center" onClick={() => setAberto(null)}>
          <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold leading-tight">{aberto.pacientes?.nome}</div>
                <div className="text-sm text-zinc-500">{aberto.procedimento} · {ROTULO_ETAPA[etapaDe(aberto)]}</div>
              </div>
              <button onClick={() => setAberto(null)} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100" title="Fechar"><X size={18} /></button>
            </div>
            {aberto.pacientes?.telefone && (
              <a href={`tel:+55${aberto.pacientes.telefone.replace(/^55(?=\d{10,11}$)/, "")}`} className="mb-4 inline-flex items-center gap-1.5 text-base font-semibold text-teal-800">
                <Phone size={16} /> {telefoneBR(aberto.pacientes.telefone)}
              </a>
            )}
            <RegistrarLigacao terapiaId={aberto.id} etapaAtual={etapaDe(aberto)} retornarEm={aberto.retornar_em} aoRegistrar={() => setAberto(null)} />
            <div className="mt-4 space-y-3 border-t border-zinc-100 pt-4">
              <EscolherResponsavel terapiaId={aberto.id} responsavelId={aberto.responsavel_id} usuarios={usuarios} />
              <Link href={`/agenda/${aberto.id}`} className="botao-claro w-full">Abrir ficha completa (prontuário, ligações, telefones)</Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
