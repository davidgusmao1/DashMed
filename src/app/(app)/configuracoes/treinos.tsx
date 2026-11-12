"use client";

// O que a IA do YouTube Seller aprendeu (David, 12/11/26: "isso tem que ficar
// gravado em algum lugar ... gostaria de saber até onde é que vai gravar").
// Tudo fica aqui, por cliente, até ser desativado. Os ativos entram em toda
// triagem e resposta nova (os 40 mais recentes, até ~8.000 caracteres).
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { GraduationCap, Mic, Pencil } from "lucide-react";
import { dataHora } from "@/lib/conteudo";
import { mudarTreino } from "../youtube/acoes";
import CampoVoz from "../youtube/campo-voz";
import JanelaTreino from "../youtube/treino";

export type Treino = { id: string; texto: string; origem: "texto" | "voz"; ativo: boolean; criado_em: string; autor: string | null; do_comentario: boolean };

function Linha({ t, podeEditar }: { t: Treino; podeEditar: boolean }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(t.texto);
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const mudar = (campos: { ativo?: boolean; texto?: string }) => iniciar(async () => {
    const r = await mudarTreino(t.id, campos);
    if (!r.ok) return setErro(r.msg);
    setErro(null);
    setEditando(false);
    router.refresh();
  });
  return (
    <li className={`space-y-2 p-3 text-sm ${t.ativo ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
        <span>{dataHora(t.criado_em)}</span>
        {t.autor && <span>· {t.autor}</span>}
        {t.origem === "voz" && <span className="inline-flex items-center gap-1">· <Mic size={11} /> por voz</span>}
        {t.do_comentario && <span>· feito num comentário</span>}
        {!t.ativo && <span className="font-semibold text-zinc-700">· desativado</span>}
      </div>
      {editando ? (
        <CampoVoz valor={texto} aoMudar={setTexto} linhas={4} />
      ) : (
        <p className="whitespace-pre-line text-zinc-800">{t.texto}</p>
      )}
      {podeEditar && (
        <div className="flex flex-wrap gap-2">
          {editando ? (
            <>
              <button className="botao" disabled={pendente} onClick={() => mudar({ texto })}>Salvar</button>
              <button className="botao-claro" disabled={pendente} onClick={() => { setEditando(false); setTexto(t.texto); }}>Cancelar</button>
            </>
          ) : (
            <>
              <button className="botao-claro" disabled={pendente} onClick={() => setEditando(true)}><Pencil size={13} /> Editar</button>
              <button className="botao-claro" disabled={pendente} onClick={() => mudar({ ativo: !t.ativo })}>{t.ativo ? "Desativar" : "Reativar"}</button>
            </>
          )}
        </div>
      )}
      {erro && <p className="rounded-lg bg-zinc-100 px-3 py-2">{erro}</p>}
    </li>
  );
}

export default function Treinos({ clienteId, treinos, podeEditar }: { clienteId: string; treinos: Treino[]; podeEditar: boolean }) {
  const router = useRouter();
  const [novo, setNovo] = useState(false);
  const ativos = treinos.filter((t) => t.ativo).length;
  return (
    <div className="cartao space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold"><GraduationCap size={16} /> Treinamento da IA</div>
          <p className="max-w-2xl text-xs text-zinc-500">
            O que você ensinou à IA, pelo botão &quot;Treinamento da IA&quot; nas respostas ou aqui. Fica gravado no banco da DashMed (só deste cliente) até você desativar;
            nada expira sozinho. Os ativos entram em toda triagem e resposta nova — até os 40 mais recentes — e, se dois se contradizem, vale o mais novo.
          </p>
        </div>
        {podeEditar && <button className="botao-claro" onClick={() => setNovo(true)}><GraduationCap size={14} /> Novo treinamento</button>}
      </div>
      <div className="text-xs text-zinc-500">{ativos} ativo(s) de {treinos.length}</div>
      {treinos.length === 0 ? (
        <p className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600">Nenhum treinamento ainda.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">{treinos.map((t) => <Linha key={t.id + t.texto + t.ativo} t={t} podeEditar={podeEditar} />)}</ul>
      )}
      {novo && <JanelaTreino clienteId={clienteId} comentarioId={null} aoFechar={() => { setNovo(false); router.refresh(); }} />}
    </div>
  );
}
