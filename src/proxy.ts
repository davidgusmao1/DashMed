import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

// No Next 16 o proxy substitui o middleware: renova a sessão a cada request e
// manda quem não está logado para o /login.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (lista) => {
        for (const { name, value } of lista) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of lista) response.cookies.set(name, value, options);
      },
    },
  });
  // getClaims confere a assinatura do token e renova a sessão vencida.
  const { data } = await supabase.auth.getClaims();
  const logado = !!data?.claims?.sub;

  const { pathname } = request.nextUrl;
  // a volta do link do e-mail troca o código pela sessão (auth/callback)
  if (pathname.startsWith("/auth/")) return response;
  // Política de Privacidade é pública: o Google exige a URL dela para o app
  // OAuth do YouTube Seller (12/11/26)
  if (pathname === "/privacidade") return response;
  const naEntrada = pathname === "/login";
  if (!logado && !naEntrada) return NextResponse.redirect(new URL("/login", request.url));
  if (logado && (naEntrada || pathname === "/")) return NextResponse.redirect(new URL("/inicio", request.url));
  return response;
}

export const config = {
  // dashmed-apolo.user.js fica público: o Tampermonkey baixa e atualiza o
  // script sem a sessão da DashMed, e ele não tem nada secreto (12/11/26)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|dashmed-apolo\\.user\\.js).*)"],
};
