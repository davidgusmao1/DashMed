"use client";

// Registrar uma ligação: o resultado sugere a etapa (a secretária pode trocar),
// e dá para marcar o dia de ligar de novo. Tudo numa transação só
// (registrar_contato), e a resposta — inclusive a recusa — aparece aqui.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ETAPAS, RESULTADOS } from "@/lib/crm";
import { atribuir, registrarContato, type Retorno } from "./acoes";

export function RegistrarLigacao({ terapiaId, etapaAtual, retornarEm, aoRegistrar }: {
  terapiaId: string; etapaAtual: string; retornarEm: string | null; aoRegistrar?: () => void;
}) {
  const router = useRouter();
  const [resultado, setResultado] = useState("");
  const [etapa, setEtapa] = useState(etapaAtual);
  const [msg, setMsg] = useState<Retorno | null>(null);
  const [enviando, iniciar] = useTransition();

  function escolher(valor: string) {
    setResultado(valor);
    setEtapa(RESULTADOS.find((r) => r.valor === valor)?.etapa ?? etapaAtual);
  }

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    iniciar(async () => {
      const r = await registrarContato(fd);
      setMsg(r);
      if (r.ok) {
        setResultado("");
        (e.target as HTMLFormElement).reset();
        router.refresh();
        aoRegistrar?.();
      }
    });
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <input type="hidden" name="terapia_id" value={terapiaId} />
      <div>
        <div className="rotulo">Resultado da ligação</div>
        <div className="grid grid-cols-2 gap-1.5">
          {RESULTADOS.map((r) => (
            <label key={r.valor} className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs font-medium ${resultado === r.valor ? "border-teal-700 bg-teal-50 text-teal-900" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"}`}>
              <input type="radio" name="resultado" value={r.valor} checked={resultado === r.valor} onChange={() => escolher(r.valor)} className="sr-only" required />
              {r.rotulo}
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="rotulo" htmlFor={`etapa-${terapiaId}`}>Mover para</label>
          <select id={`etapa-${terapiaId}`} name="etapa" value={etapa} onChange={(e) => setEtapa(e.target.value)} className="campo">
            {ETAPAS.map((x) => <option key={x.valor} value={x.valor}>{x.rotulo}</option>)}
          </select>
        </div>
        <div>
          <label className="rotulo" htmlFor={`retorno-${terapiaId}`}>Ligar de novo em</label>
          <input id={`retorno-${terapiaId}`} name="retornar_em" type="date" defaultValue={retornarEm ?? ""} className="campo" />
        </div>
      </div>
      <div>
        <label className="rotulo" htmlFor={`nota-${terapiaId}`}>Anotação</label>
        <textarea id={`nota-${terapiaId}`} name="nota" rows={2} maxLength={2000} className="campo" placeholder="O que o paciente disse, melhor horário, convênio…" />
      </div>
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-teal-50 text-teal-900" : "bg-zinc-100 text-zinc-900"}`}>{msg.texto}</p>}
      <button className="botao w-full" disabled={enviando || !resultado}>{enviando ? "Registrando…" : "Registrar ligação"}</button>
    </form>
  );
}

export function EscolherResponsavel({ terapiaId, responsavelId, usuarios }: {
  terapiaId: string; responsavelId: string | null; usuarios: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const [valor, setValor] = useState(responsavelId ?? "");
  const [msg, setMsg] = useState<Retorno | null>(null);
  const [salvando, iniciar] = useTransition();
  return (
    <div>
      <label className="rotulo" htmlFor={`resp-${terapiaId}`}>Responsável</label>
      <select id={`resp-${terapiaId}`} value={valor} disabled={salvando} className="campo"
        onChange={(e) => {
          const novo = e.target.value;
          const antes = valor;
          setValor(novo);
          iniciar(async () => {
            const r = await atribuir(terapiaId, novo);
            setMsg(r.ok ? null : r);
            if (!r.ok) setValor(antes); else router.refresh();
          });
        }}>
        <option value="">Ninguém</option>
        {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
      </select>
      {msg && <p className="mt-1 text-xs text-zinc-900">{msg.texto}</p>}
    </div>
  );
}
