import { clientesDe, supabaseServidor, usuarioAtual } from "@/lib/supabase/server";

// Início em branco por enquanto: o cliente em foco e o estado da plataforma
// (a edge function "saude" responde — Supabase, edge e Vercel ligados).
export default async function Inicio() {
  const eu = await usuarioAtual();
  if (!eu) return null;
  const { emFoco } = await clientesDe(eu);
  const supabase = await supabaseServidor();
  const { data: saude, error } = await supabase.functions.invoke<{ ok: boolean; banco: boolean; em: string }>("saude", { method: "GET" });
  const noAr = !error && !!saude?.ok && !!saude?.banco;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Olá, {eu.nome.split(" ")[0]}</h1>
        <p className="text-sm text-zinc-500">{emFoco ? `Cliente: ${emFoco.nome}` : "Nenhum cliente cadastrado"}</p>
      </div>
      <div className="cartao max-w-md p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Plataforma</div>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <span className={`size-2.5 rounded-full ${noAr ? "bg-teal-600" : "bg-zinc-400"}`} />
          {noAr ? "Banco e funções no ar" : `Funções sem resposta${error ? ` (${error.message})` : ""}`}
        </div>
      </div>
    </div>
  );
}
