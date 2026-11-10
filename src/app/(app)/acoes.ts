"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { COOKIE_DO_CLIENTE } from "@/lib/config";
import { supabaseServidor } from "@/lib/supabase/server";

/** A equipe da plataforma troca o cliente em que está trabalhando. A RLS
 *  confere: cliente que ele não enxerga não entra no cookie. */
export async function escolherCliente(id: string): Promise<void> {
  const supabase = await supabaseServidor();
  const { data } = await supabase.from("clientes").select("id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!data) return;
  (await cookies()).set(COOKIE_DO_CLIENTE, id, { path: "/", httpOnly: true, sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
