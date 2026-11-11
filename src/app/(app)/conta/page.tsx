import { usuarioAtual } from "@/lib/supabase/server";
import DefinirSenha from "./definir-senha";

// Minha conta: quem entrou pelo link do e-mail define aqui a senha para as
// próximas entradas (Jorge, 10/11/26: "entrei, funcionou onde coloco a senha?").
export default async function Conta({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const eu = await usuarioAtual();
  if (!eu) return null;
  // veio pelo link de primeiro acesso da tela de Usuários (11/11/26)
  const primeiro = (await searchParams).primeiro === "1";
  return (
    <div className="max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Minha conta</h1>
        <p className="text-sm text-zinc-500">{eu.nome} · {eu.email}</p>
      </div>
      {primeiro && (
        <p className="rounded-lg bg-teal-50 px-3 py-3 text-sm text-teal-900">
          Bem-vindo(a) à DashMed! O link de acesso vale uma vez só: defina agora a sua senha para entrar das próximas vezes com o e-mail e a senha.
        </p>
      )}
      <DefinirSenha />
    </div>
  );
}
