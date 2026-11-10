"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function SemAcesso() {
  const router = useRouter();
  async function sair() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="cartao max-w-sm space-y-3 p-8 text-center">
        <p className="font-semibold">Acesso desativado</p>
        <p className="text-sm text-zinc-600">Esta conta não está ativa na DashMed. Fale com quem administra os usuários.</p>
        <button onClick={sair} className="botao-claro">Sair</button>
      </div>
    </main>
  );
}
