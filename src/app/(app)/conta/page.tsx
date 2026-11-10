import { usuarioAtual } from "@/lib/supabase/server";
import DefinirSenha from "./definir-senha";

// Minha conta: quem entrou pelo link do e-mail define aqui a senha para as
// próximas entradas (Jorge, 10/11/26: "entrei, funcionou onde coloco a senha?").
export default async function Conta() {
  const eu = await usuarioAtual();
  if (!eu) return null;
  return (
    <div className="max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Minha conta</h1>
        <p className="text-sm text-zinc-500">{eu.nome} · {eu.email}</p>
      </div>
      <DefinirSenha />
    </div>
  );
}
