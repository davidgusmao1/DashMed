"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ETAPAS, type Lead, LOCAIS } from "@/lib/youtube";
import { buscarPacientes, moverLead, registrarEvento, salvarLead } from "../../acoes";

export default function Ficha({ lead, usuarios, paciente }: {
  lead: Lead & { cliente_id: string };
  usuarios: { id: string; nome: string }[];
  paciente: { id: string; nome: string } | null;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [etapa, setEtapa] = useState(lead.etapa);
  const [campos, setCampos] = useState({
    telefone: lead.telefone ?? "",
    local_interesse: lead.local_interesse ?? "",
    proximo_passo_em: lead.proximo_passo_em ?? "",
    responsavel_id: lead.responsavel_id ?? "",
    paciente_id: lead.paciente_id ?? "",
    notas: lead.notas,
  });
  const [pacienteNome, setPacienteNome] = useState(paciente?.nome ?? "");
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<{ id: string; nome: string }[]>([]);
  const [evTipo, setEvTipo] = useState("whatsapp");
  const [evTexto, setEvTexto] = useState("");

  const mudar = (k: keyof typeof campos, v: string) => setCampos((c) => ({ ...c, [k]: v }));

  return (
    <div className="space-y-4">
      <section className="cartao space-y-3 p-5">
        <div>
          <label className="rotulo" htmlFor="etapa">Etapa</label>
          <select id="etapa" className="campo" value={etapa} disabled={pendente} onChange={(e) => {
            const nova = e.target.value as Lead["etapa"];
            const antes = etapa;
            setEtapa(nova);
            iniciar(async () => {
              const r = await moverLead(lead.id, nova);
              if (!r.ok) { setEtapa(antes); setAviso({ ok: false, texto: r.msg }); } else router.refresh();
            });
          }}>
            {ETAPAS.map((e) => <option key={e.id} value={e.id}>{e.rotulo}</option>)}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="rotulo" htmlFor="telefone">Telefone / WhatsApp</label>
            <input id="telefone" className="campo" value={campos.telefone} onChange={(e) => mudar("telefone", e.target.value)} placeholder="quando a pessoa chamar" />
          </div>
          <div>
            <label className="rotulo" htmlFor="local">Onde quer ser atendido</label>
            <select id="local" className="campo" value={campos.local_interesse} onChange={(e) => mudar("local_interesse", e.target.value)}>
              <option value="">Ainda não sabe</option>
              {LOCAIS.map((l) => <option key={l.id} value={l.id}>{l.rotulo}</option>)}
            </select>
          </div>
          <div>
            <label className="rotulo" htmlFor="proximo">Próximo passo em</label>
            <input id="proximo" type="date" className="campo" value={campos.proximo_passo_em} onChange={(e) => mudar("proximo_passo_em", e.target.value)} />
          </div>
          <div>
            <label className="rotulo" htmlFor="responsavel">Responsável</label>
            <select id="responsavel" className="campo" value={campos.responsavel_id} onChange={(e) => mudar("responsavel_id", e.target.value)}>
              <option value="">Ninguém</option>
              {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="rotulo" htmlFor="busca">Virou paciente? Ligue ao cadastro da Agenda/CRM</label>
          {campos.paciente_id ? (
            <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm">
              <span>{pacienteNome || "Paciente ligado"}</span>
              <button type="button" className="text-xs underline" onClick={() => { mudar("paciente_id", ""); setPacienteNome(""); }}>desligar</button>
            </div>
          ) : (
            <>
              <input id="busca" className="campo" value={busca} placeholder="Digite o nome do paciente"
                onChange={async (e) => {
                  setBusca(e.target.value);
                  setAchados(e.target.value.trim().length >= 2 ? await buscarPacientes(lead.cliente_id, e.target.value) : []);
                }} />
              {achados.length > 0 && (
                <ul className="mt-1 divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white text-sm">
                  {achados.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-zinc-50" onClick={() => { mudar("paciente_id", p.id); setPacienteNome(p.nome); setBusca(""); setAchados([]); }}>{p.nome}</button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div>
          <label className="rotulo" htmlFor="notas">Anotações</label>
          <textarea id="notas" className="campo" rows={4} value={campos.notas} onChange={(e) => mudar("notas", e.target.value)} />
        </div>
        <button className="botao" disabled={pendente} onClick={() => iniciar(async () => {
          const r = await salvarLead(lead.id, campos);
          setAviso({ ok: r.ok, texto: r.msg });
          if (r.ok) router.refresh();
        })}>{pendente ? "Salvando…" : "Salvar ficha"}</button>
        {aviso && <p className={`rounded-lg px-3 py-2 text-sm ${aviso.ok ? "bg-teal-50 text-teal-900" : "bg-zinc-100 text-zinc-900"}`}>{aviso.texto}</p>}
      </section>

      <section className="cartao space-y-3 p-5">
        <div className="text-sm font-semibold">Registrar contato</div>
        <div className="flex flex-wrap gap-1 text-xs">
          {[["whatsapp", "WhatsApp"], ["ligacao", "Ligação"], ["consulta", "Consulta"], ["nota", "Anotação"]].map(([id, rot]) => (
            <button key={id} type="button" onClick={() => setEvTipo(id)}
              className={`rounded-md px-2 py-1 ${evTipo === id ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700"}`}>{rot}</button>
          ))}
        </div>
        <textarea className="campo" rows={3} value={evTexto} onChange={(e) => setEvTexto(e.target.value)}
          placeholder="Ex.: chamou no WhatsApp com o código; quer teleconsulta na semana que vem" aria-label="O que aconteceu" />
        <button className="botao-claro" disabled={pendente || !evTexto.trim()} onClick={() => iniciar(async () => {
          const r = await registrarEvento(lead.id, evTipo, evTexto);
          setAviso({ ok: r.ok, texto: r.msg });
          if (r.ok) { setEvTexto(""); router.refresh(); }
        })}>Registrar</button>
      </section>
    </div>
  );
}
