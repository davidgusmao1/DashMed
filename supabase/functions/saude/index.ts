// Saúde da plataforma: a tela Início pergunta, e a resposta prova que o
// Supabase (banco), as edge functions e a Vercel estão ligados. A chave de
// serviço só existe aqui (o Supabase põe no ambiente da função).
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const { error } = await admin.from("clientes").select("id", { head: true, count: "exact" });
  return new Response(JSON.stringify({ ok: true, banco: !error, em: new Date().toISOString() }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
