import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

// Cliente do navegador: mesma sessão (cookies) que o proxy renova.
export const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
