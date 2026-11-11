import { clientesDe, supabaseServidor, usuarioAtual } from "@/lib/supabase/server";
import Gestao, { type Conta } from "./gestao";

// Usuários (David, 11/11/26: "criar a tela de usuários ... Assim você mesmo
// cria e desativa as contas delas" — as secretárias do CRM). Só o admin do
// cliente e a equipe da plataforma; a edge function `usuarios` confere de novo.
export default async function Usuarios() {
  const eu = await usuarioAtual();
  if (!eu) return null;
  const { emFoco } = await clientesDe(eu);
  if (!emFoco) return <p className="text-sm text-zinc-500">Nenhum cliente cadastrado.</p>;
  if (!(eu.plataforma || (eu.papel === "admin" && eu.cliente_id === emFoco.id))) {
    return <p className="cartao max-w-md p-6 text-sm text-zinc-600">Só o administrador do cliente ou a equipe da plataforma gerencia as contas.</p>;
  }

  const supabase = await supabaseServidor();
  const { data, error } = await supabase.functions.invoke<{ usuarios: Conta[] }>("usuarios", {
    body: { acao: "listar", cliente_id: emFoco.id },
  });
  let erro: string | null = null;
  if (error) {
    erro = error.message;
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try { erro = ((await ctx.json()) as { erro?: string }).erro ?? erro; } catch { /* mantém a mensagem genérica */ }
    }
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Usuários</h1>
        <p className="text-sm text-zinc-500">Quem entra na DashMed do cliente {emFoco.nome}</p>
      </div>
      {erro && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900">Não consegui listar as contas: {erro}</p>}
      <Gestao clienteId={emFoco.id} contas={data?.usuarios ?? []} euId={eu.id} euPlataforma={eu.plataforma} />
    </div>
  );
}
