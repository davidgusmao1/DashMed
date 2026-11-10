import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { COOKIE_DO_CLIENTE, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

// Cliente de servidor ligado à sessão (cookies): tudo passa pela RLS de quem
// está logado.
export async function supabaseServidor() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (lista) => {
        try {
          for (const { name, value, options } of lista) cookieStore.set(name, value, options);
        } catch {
          // Server Component não escreve cookie; o proxy renova a sessão.
        }
      },
    },
  });
}

export type Usuario = { id: string; nome: string; email: string; papel: "admin" | "membro"; plataforma: boolean; cliente_id: string | null };
export type Cliente = { id: string; nome: string };

/** Quem está logado, ou null. Conta sem linha em usuarios (ou inativa) não entra. */
export async function usuarioAtual(): Promise<Usuario | null> {
  const supabase = await supabaseServidor();
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims?.sub;
  if (!id) return null;
  const { data: u } = await supabase.from("usuarios").select("id, nome, email, papel, plataforma, cliente_id, ativo")
    .eq("id", id).is("deleted_at", null).maybeSingle();
  return u?.ativo ? (u as Usuario) : null;
}

/** Os clientes que ele enxerga (a RLS decide) e o que está em foco: o do
 *  cookie, se ele enxerga; senão o dele; senão o primeiro. */
export async function clientesDe(eu: Usuario): Promise<{ clientes: Cliente[]; emFoco: Cliente | null }> {
  const supabase = await supabaseServidor();
  const { data } = await supabase.from("clientes").select("id, nome").is("deleted_at", null).order("nome");
  const clientes = (data ?? []) as Cliente[];
  const escolhido = (await cookies()).get(COOKIE_DO_CLIENTE)?.value;
  const emFoco = clientes.find((c) => c.id === escolhido) ?? clientes.find((c) => c.id === eu.cliente_id) ?? clientes[0] ?? null;
  return { clientes, emFoco };
}
