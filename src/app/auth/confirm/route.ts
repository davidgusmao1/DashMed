import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServidor } from "@/lib/supabase/server";

// Link de primeiro acesso gerado na tela de Usuários (11/11/26): o hash do
// token vira sessão aqui, e a pessoa cai em Minha conta para definir a senha.
// Serve também para links de e-mail no formato token_hash, quando houver
// e-mail próprio. Link vencido ou já usado volta para o login com aviso.
const TIPOS: EmailOtpType[] = ["email", "magiclink", "invite", "recovery", "signup", "email_change"];

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const tokenHash = sp.get("token_hash");
  const tipoBruto = sp.get("type") as EmailOtpType | null;
  const proximo = sp.get("next");
  // só caminhos internos: o link não pode mandar para fora da DashMed
  const destino = proximo && /^\/[a-z0-9/_-]*$/i.test(proximo) ? proximo : "/conta?primeiro=1";
  if (tokenHash && tipoBruto && TIPOS.includes(tipoBruto)) {
    const supabase = await supabaseServidor();
    // "magiclink" é o nome antigo do tipo "email" no Auth
    const type: EmailOtpType = tipoBruto === "magiclink" ? "email" : tipoBruto;
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(destino, request.url));
  }
  return NextResponse.redirect(new URL("/login?erro=link", request.url));
}
