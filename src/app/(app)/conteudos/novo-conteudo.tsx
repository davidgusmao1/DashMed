"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { criarConteudo, type EstadoForm } from "./acoes";

export default function NovoConteudo() {
  const [estado, acao, criando] = useActionState<EstadoForm, FormData>(criarConteudo, null);
  return (
    <form action={acao} className="cartao space-y-3 p-5">
      <div className="text-sm font-semibold">Novo conteúdo</div>
      <div>
        <label className="rotulo" htmlFor="assunto">Assunto</label>
        <input id="assunto" name="assunto" required maxLength={300} className="campo" placeholder="Ex.: Artroscopia do quadril no impacto femoroacetabular: quando vale a pena?" />
      </div>
      <div>
        <label className="rotulo" htmlFor="orientacoes">Orientações para a IA (opcional)</label>
        <textarea id="orientacoes" name="orientacoes" rows={3} maxLength={2000} className="campo"
          placeholder="Ex.: foco em atletas amadores; comparar com fisioterapia; explicar a recuperação; evitar termos técnicos." />
      </div>
      {estado && !estado.ok && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900">{estado.msg}</p>}
      <button className="botao" disabled={criando}><Plus size={16} /> {criando ? "Criando…" : "Criar e abrir"}</button>
    </form>
  );
}
