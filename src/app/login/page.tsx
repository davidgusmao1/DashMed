"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { supabase } from "@/lib/supabase/client";

// Entrada sem senha: o link vai para o e-mail cadastrado (só quem já tem
// conta — o cadastro aberto está desligado no Supabase).
function Entrada() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(params.get("erro") === "link" ? "O link venceu ou já foi usado. Peça outro." : null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setEnviando(false);
    if (error) {
      setErro(/signups? not allowed|not found|user/i.test(error.message) ? "Este e-mail não tem acesso à DashMed."
        : /rate|too many|seconds/i.test(error.message) ? "Muitos pedidos seguidos. Espere alguns minutos e tente de novo."
        : error.message);
      return;
    }
    setEnviado(true);
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={enviar} className="cartao w-full max-w-sm space-y-4 p-8 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-teal-700 text-xs font-bold text-white">DM</span>
          <div>
            <div className="text-lg font-bold leading-tight">DashMed</div>
            <div className="text-xs text-zinc-500">Acesso à plataforma</div>
          </div>
        </div>
        {enviado ? (
          <p className="rounded-lg bg-teal-50 px-3 py-3 text-sm text-teal-900">
            Enviamos um link de acesso para <b>{email.trim().toLowerCase()}</b>. Abra o e-mail neste mesmo navegador e clique em entrar.
          </p>
        ) : (
          <>
            <div>
              <label className="rotulo" htmlFor="email">E-mail</label>
              <input id="email" type="email" autoComplete="email" required className="campo" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {erro && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900">{erro}</p>}
            <button className="botao w-full" disabled={enviando}>{enviando ? "Enviando…" : "Receber link de acesso"}</button>
          </>
        )}
      </form>
    </main>
  );
}

export default function Login() {
  return <Suspense><Entrada /></Suspense>;
}
