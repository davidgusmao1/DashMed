import { NextResponse, type NextRequest } from "next/server";
import { supabaseServidor } from "@/lib/supabase/server";

// A volta do link do e-mail: troca o código pela sessão (cookies) e entra.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await supabaseServidor();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/inicio", request.url));
  }
  return NextResponse.redirect(new URL("/login?erro=link", request.url));
}
