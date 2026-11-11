"use client";

import { useActionState } from "react";
import type { Perfil } from "@/lib/conteudo";
import { salvarPerfil, type EstadoForm } from "./acoes";

const CAMPOS: { nome: keyof Perfil; rotulo: string; dica: string; longo?: boolean }[] = [
  { nome: "nome_exibicao", rotulo: "Nome no vídeo", dica: "Ex.: Dra. Ana Souza" },
  { nome: "especialidade", rotulo: "Especialidade", dica: "Ex.: Ortopedia — cirurgia do quadril" },
  { nome: "crm", rotulo: "CRM", dica: "Ex.: CRM-SP 123456" },
  { nome: "rqe", rotulo: "RQE", dica: "Ex.: RQE 12345" },
  { nome: "publico", rotulo: "Público do canal", dica: "Ex.: pacientes com dor no quadril, leigos, 30 a 60 anos", longo: true },
  { nome: "tom", rotulo: "Tom de voz", dica: "Ex.: próximo e didático, sem jargão, com exemplos do consultório", longo: true },
  { nome: "chamada_final", rotulo: "Chamada final", dica: "Ex.: deixe a sua dúvida nos comentários", longo: true },
];

export default function PerfilForm({ perfil, podeEditar }: { perfil: Perfil | null; podeEditar: boolean }) {
  const [estado, acao, salvando] = useActionState<EstadoForm, FormData>(salvarPerfil, null);
  return (
    <form action={acao} className="cartao space-y-4 p-5">
      <div>
        <div className="text-sm font-semibold">Perfil para os roteiros</div>
        <p className="text-xs text-zinc-500">
          Entra no texto do vídeo. Nome, CRM e RQE fazem a identificação que a Resolução CFM 2.336/2023 pede.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {CAMPOS.map((c) => (
          <div key={c.nome} className={c.longo ? "sm:col-span-2" : ""}>
            <label className="rotulo" htmlFor={c.nome}>{c.rotulo}</label>
            {c.longo ? (
              <textarea id={c.nome} name={c.nome} rows={2} className="campo" placeholder={c.dica} defaultValue={perfil?.[c.nome] ?? ""} disabled={!podeEditar} />
            ) : (
              <input id={c.nome} name={c.nome} className="campo" placeholder={c.dica} defaultValue={perfil?.[c.nome] ?? ""} disabled={!podeEditar} />
            )}
          </div>
        ))}
      </div>
      {estado && <p className={`rounded-lg px-3 py-2 text-sm ${estado.ok ? "bg-teal-50 text-teal-900" : "bg-zinc-100 text-zinc-900"}`}>{estado.msg}</p>}
      {podeEditar ? (
        <button className="botao" disabled={salvando}>{salvando ? "Salvando…" : "Salvar perfil"}</button>
      ) : (
        <p className="text-xs text-zinc-500">Só o administrador do cliente ou a equipe da plataforma muda o perfil.</p>
      )}
    </form>
  );
}
