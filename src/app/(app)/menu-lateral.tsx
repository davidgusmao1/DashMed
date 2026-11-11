"use client";

// Menu principal à esquerda, no desenho do Prospekt: ⏴ recolhe para o trilho
// de ícones, ⏵ expande. A escolha fica no navegador. No celular vira uma barra
// no topo. Os itens entram aos poucos (Jorge, 10/11/26: "tudo em branco nesse
// primeiro momento dps vamos com calma populando os menus da esquerda").
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Clapperboard, House, LogOut, Settings, SquareKanban, type LucideIcon } from "lucide-react";
import type { Cliente } from "@/lib/supabase/server";
import { supabase } from "@/lib/supabase/client";
import { escolherCliente } from "./acoes";

const ITENS: { href: string; label: string; icone: LucideIcon }[] = [
  { href: "/inicio", label: "Início", icone: House },
  // David, 10/11/26: "criar um menu na esquerda que vamos chamar de agenda
  // onde todos os pacientes que precisam renovar suas terapias precisam ser chamados"
  { href: "/agenda", label: "Agenda", icone: CalendarClock },
  // David, 11/11/26: "organizar um CRM estilo kanban para que minhas
  // secretárias entrem em contato com os pacientes que ainda não fizeram cirurgias"
  { href: "/crm", label: "CRM", icone: SquareKanban },
  // David, 10/11/26: "no menu da esquerda criarmos um item que vai chamar
  // conteúdos para mídias sociais"
  { href: "/conteudos", label: "Conteúdos", icone: Clapperboard },
  { href: "/configuracoes", label: "Configurações", icone: Settings },
];
const CHAVE = "menu-lateral-aberto";

export default function MenuLateral({ nome, email, plataforma, clientes, emFoco }: {
  nome: string; email: string; plataforma: boolean; clientes: Cliente[]; emFoco: Cliente | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [aberto, setAberto] = useState(true);
  const [trocando, iniciar] = useTransition();
  useEffect(() => {
    try { setAberto(localStorage.getItem(CHAVE) !== "0"); } catch { /* sem storage: aberto */ }
  }, []);
  function alternar(v: boolean) {
    setAberto(v);
    try { localStorage.setItem(CHAVE, v ? "1" : "0"); } catch { /* ok */ }
  }
  async function sair() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  const ativo = (href: string) => pathname === href || pathname.startsWith(href + "/");
  // a equipe da plataforma escolhe o cliente; quem é de um cliente só vê o dele
  const seletor = plataforma && clientes.length > 0 ? (
    <select
      aria-label="Cliente"
      className="campo py-1.5 text-xs"
      value={emFoco?.id ?? ""}
      disabled={trocando}
      onChange={(e) => { const id = e.target.value; iniciar(async () => { await escolherCliente(id); router.refresh(); }); }}
    >
      {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
    </select>
  ) : (
    <div className="truncate text-xs font-medium text-zinc-500">{emFoco?.nome ?? "Sem cliente"}</div>
  );

  return (
    <>
      {/* celular: barra no topo */}
      <header className="flex items-center gap-1 border-b border-zinc-200 bg-surface px-3 py-2 md:hidden">
        <span className="mr-1 grid size-8 shrink-0 place-items-center rounded-lg bg-teal-700 text-[10px] font-bold text-white">DM</span>
        {/* com cinco itens a fileira passa da largura do celular: rola de lado (11/11/26) */}
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {ITENS.map(({ href, label, icone: Icone }) => (
            <Link key={href} href={href} title={label} className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium ${ativo(href) ? "bg-teal-700 text-white" : "text-zinc-600"}`}>
              <Icone size={16} /> <span className="max-[479px]:sr-only">{label}</span>
            </Link>
          ))}
        </nav>
        <div className="w-28 shrink-0 sm:w-40">{seletor}</div>
        <button onClick={sair} className="rounded-lg p-2 text-zinc-500" title="Sair"><LogOut size={16} /></button>
      </header>

      <aside className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-zinc-200 bg-surface transition-all max-md:hidden ${aberto ? "w-60" : "w-16"}`}>
        <div className={`pb-3 pt-5 ${aberto ? "px-5" : "px-0 text-center"}`}>
          <div className="flex items-center justify-between">
            {aberto ? (
              <div className="flex items-center gap-2 font-bold">
                <span className="grid size-8 place-items-center rounded-lg bg-teal-700 text-[10px] font-bold text-white">DM</span>
                DashMed
              </div>
            ) : (
              <span className="mx-auto grid size-8 place-items-center rounded-lg bg-teal-700 text-[10px] font-bold text-white">DM</span>
            )}
            {aberto && (
              <button onClick={() => alternar(false)} title="Recolher o menu" className="rounded-md px-1 text-zinc-300 transition hover:bg-zinc-100 hover:text-zinc-600">
                <ChevronLeft size={16} />
              </button>
            )}
          </div>
          {aberto && <div className="mt-3">{seletor}</div>}
          {!aberto && (
            <button onClick={() => alternar(true)} title="Expandir o menu" className="mx-auto mt-2 grid size-8 place-items-center rounded-lg text-zinc-300 transition hover:bg-zinc-100 hover:text-zinc-600">
              <ChevronRight size={18} />
            </button>
          )}
        </div>
        <nav className="flex-1 space-y-1 px-2">
          {ITENS.map(({ href, label, icone: Icone }) => (
            <Link
              key={href}
              href={href}
              title={aberto ? undefined : label}
              className={`flex items-center rounded-lg py-2 text-sm font-medium transition ${aberto ? "gap-3 px-3" : "justify-center px-0"} ${
                ativo(href) ? "bg-teal-700 text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              }`}
            >
              <Icone size={aberto ? 18 : 22} strokeWidth={1.8} className="shrink-0" />
              {aberto && label}
            </Link>
          ))}
        </nav>
        <div className={`border-t border-zinc-100 py-4 ${aberto ? "space-y-1 px-5" : "px-2 text-center"}`}>
          {aberto ? (
            <>
              <Link href="/conta" title="Minha conta" className="block rounded-md hover:bg-zinc-50">
                <div className="truncate text-xs font-medium text-zinc-700">{nome}</div>
                <div className="truncate text-[11px] text-zinc-400">{email}</div>
              </Link>
              <button onClick={sair} className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900">
                <LogOut size={13} /> Sair
              </button>
            </>
          ) : (
            <button onClick={sair} title={`${nome} — sair`} className="mx-auto grid size-8 place-items-center rounded-full bg-teal-700 text-xs font-semibold text-white">
              {nome.charAt(0).toUpperCase()}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
