import { clientesDe, usuarioAtual } from "@/lib/supabase/server";
import MenuLateral from "./menu-lateral";
import SemAcesso from "./sem-acesso";

export default async function LayoutDoApp({ children }: { children: React.ReactNode }) {
  const eu = await usuarioAtual();
  // Conta sem cadastro em Usuários (ou desativada). Não dá para redirecionar
  // ao /login: o cookie continua valendo e o proxy mandaria de volta para cá.
  if (!eu) return <SemAcesso />;
  const { clientes, emFoco } = await clientesDe(eu);
  return (
    <div className="flex min-h-screen max-md:flex-col">
      <MenuLateral nome={eu.nome} email={eu.email} plataforma={eu.plataforma} clientes={clientes} emFoco={emFoco} />
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
