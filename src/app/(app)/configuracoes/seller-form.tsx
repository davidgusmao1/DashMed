"use client";

import { useActionState } from "react";
import type { SellerConfig } from "@/lib/youtube";
import { salvarSeller, type EstadoForm } from "./acoes";

const PADRAO_PROCEDIMENTOS = [
  "Prótese de quadril", "Videoartroscopia de quadril", "Cirurgia para osteonecrose", "Ácido hialurônico",
  "Hidrogel bioativo", "Plasma rico em plaquetas (PRP)", "Concentrado de células",
];

export default function SellerForm({ config, podeEditar }: { config: SellerConfig | null; podeEditar: boolean }) {
  const [estado, acao, salvando] = useActionState<EstadoForm, FormData>(salvarSeller, null);
  const c = config;
  return (
    <form action={acao} className="cartao space-y-4 p-5">
      <div>
        <div className="text-sm font-semibold">O que a resposta oferece</div>
        <p className="text-xs text-zinc-500">
          A IA só usa telefone, cidade e endereço que estiverem escritos aqui (nunca inventa). Deixe em branco o que não quer oferecer.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="rotulo" htmlFor="telemedicina">Consulta por telemedicina</label>
          <textarea id="telemedicina" name="telemedicina" rows={2} className="campo" disabled={!podeEditar} defaultValue={c?.telemedicina ?? ""}
            placeholder="Ex.: agende a teleconsulta pelo WhatsApp (51) 99999-0000" />
        </div>
        <div>
          <label className="rotulo" htmlFor="telefone_estimativa">Estimativa de custo de tratamento</label>
          <textarea id="telefone_estimativa" name="telefone_estimativa" rows={2} className="campo" disabled={!podeEditar} defaultValue={c?.telefone_estimativa ?? ""}
            placeholder="Ex.: WhatsApp (51) 98888-0000 (equipe de orçamentos)" />
        </div>
        <div>
          <label className="rotulo" htmlFor="porto_alegre">Presencial em Porto Alegre</label>
          <textarea id="porto_alegre" name="porto_alegre" rows={2} className="campo" disabled={!podeEditar} defaultValue={c?.porto_alegre ?? ""}
            placeholder="Ex.: Hospital X, Av. Y 123 — agendamento (51) 3333-0000" />
        </div>
        <div>
          <label className="rotulo" htmlFor="sao_paulo">Presencial em São Paulo</label>
          <textarea id="sao_paulo" name="sao_paulo" rows={2} className="campo" disabled={!podeEditar} defaultValue={c?.sao_paulo ?? ""}
            placeholder="Ex.: Clínica Z, Rua W 456 — agendamento (11) 4444-0000" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="rotulo" htmlFor="procedimentos">Procedimentos que interessam (um por linha)</label>
          <textarea id="procedimentos" name="procedimentos" rows={7} className="campo" disabled={!podeEditar}
            defaultValue={(c?.procedimentos?.length ? c.procedimentos : PADRAO_PROCEDIMENTOS).join("\n")} />
        </div>
        <div className="space-y-4">
          <div>
            <label className="rotulo" htmlFor="instrucoes">Instruções para as respostas (opcional)</label>
            <textarea id="instrucoes" name="instrucoes" rows={3} className="campo" disabled={!podeEditar} defaultValue={c?.instrucoes ?? ""}
              placeholder="Ex.: trate por você; assine só como Davi; para dor no joelho, diga que atendo só quadril" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="rotulo" htmlFor="prob_minima">Lead a partir de (%)</label>
              <input id="prob_minima" name="prob_minima" type="number" min={0} max={100} className="campo" disabled={!podeEditar} defaultValue={c?.prob_minima ?? 40} />
            </div>
            <div>
              <label className="rotulo" htmlFor="limite_diario">Respostas por dia</label>
              <input id="limite_diario" name="limite_diario" type="number" min={1} max={150} className="campo" disabled={!podeEditar} defaultValue={c?.limite_diario ?? 40} />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="automatico" className="mt-0.5 accent-teal-700" disabled={!podeEditar} defaultChecked={c?.automatico ?? false} />
            <span>Ler e triar os comentários sozinho, de hora em hora. <span className="text-zinc-500">A publicação continua sempre com você.</span></span>
          </label>
        </div>
      </div>
      {estado && <p className={`rounded-lg px-3 py-2 text-sm ${estado.ok ? "bg-teal-50 text-teal-900" : "bg-zinc-100 text-zinc-900"}`}>{estado.msg}</p>}
      {podeEditar ? (
        <button className="botao" disabled={salvando}>{salvando ? "Salvando…" : "Salvar configuração"}</button>
      ) : (
        <p className="text-xs text-zinc-500">Só o administrador do cliente ou a equipe da plataforma muda esta configuração.</p>
      )}
    </form>
  );
}
