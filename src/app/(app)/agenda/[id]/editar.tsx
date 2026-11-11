"use client";

// Formulários da ficha da terapia. Cada um mostra o resultado que a ação
// devolveu — inclusive a recusa (falha silenciosa é bug duplo).
import { useActionState } from "react";
import { confirmarIndicacao, mudarSituacao, salvarTelefone, salvarVencimento, type Retorno } from "../acoes";
import { telefoneBR } from "@/lib/telefone";

function Aviso({ r }: { r: Retorno }) {
  if (!r) return null;
  return <p className={`rounded-lg px-3 py-2 text-sm ${r.ok ? "bg-teal-50 text-teal-900" : "bg-zinc-100 text-zinc-900"}`}>{r.texto}</p>;
}

export function FormTelefone({ pacienteId, telefone }: { pacienteId: string; telefone: string | null }) {
  const [r, acao, salvando] = useActionState(salvarTelefone, null);
  return (
    <form action={acao} className="space-y-2">
      <input type="hidden" name="paciente_id" value={pacienteId} />
      <label className="rotulo" htmlFor="telefone">Telefone do paciente</label>
      <div className="flex gap-2">
        <input id="telefone" name="telefone" type="tel" inputMode="tel" autoComplete="off" placeholder="(11) 98765-4321"
          defaultValue={telefoneBR(telefone)} className="campo" />
        <button className="botao shrink-0" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
      </div>
      <Aviso r={r} />
    </form>
  );
}

export function FormVencimento({ terapiaId, venceEm }: { terapiaId: string; venceEm: string | null }) {
  const [r, acao, salvando] = useActionState(salvarVencimento, null);
  return (
    <form action={acao} className="space-y-2">
      <input type="hidden" name="terapia_id" value={terapiaId} />
      <label className="rotulo" htmlFor="vence_em">Vence em</label>
      <div className="flex gap-2">
        <input id="vence_em" name="vence_em" type="date" required defaultValue={venceEm ?? ""} className="campo" />
        <button className="botao shrink-0" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
      </div>
      <Aviso r={r} />
    </form>
  );
}

const OPCOES = [
  { valor: "a_chamar", rotulo: "A chamar" },
  { valor: "agendado", rotulo: "Agendado" },
  { valor: "nao_renovar", rotulo: "Não vai renovar" },
];

export function FormSituacao({ terapiaId, situacao }: { terapiaId: string; situacao: string }) {
  const [r, acao, salvando] = useActionState(mudarSituacao, null);
  return (
    <form action={acao} className="space-y-2">
      <input type="hidden" name="terapia_id" value={terapiaId} />
      <div className="rotulo">Situação</div>
      <div className="flex flex-wrap gap-2">
        {OPCOES.map((o) => (
          <button key={o.valor} name="situacao" value={o.valor} disabled={salvando || o.valor === situacao}
            className={o.valor === situacao ? "botao disabled:opacity-100" : "botao-claro"}>
            {o.rotulo}
          </button>
        ))}
      </div>
      <Aviso r={r} />
    </form>
  );
}

export function FormConfirmar({ terapiaId }: { terapiaId: string }) {
  const [r, acao, salvando] = useActionState(confirmarIndicacao, null);
  return (
    <form action={acao} className="space-y-2">
      <input type="hidden" name="terapia_id" value={terapiaId} />
      <button className="botao" disabled={salvando}>{salvando ? "Confirmando…" : "Confirmar indicação"}</button>
      <Aviso r={r} />
    </form>
  );
}
