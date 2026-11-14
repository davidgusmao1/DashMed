"use client";

// A pessoa chama no WhatsApp e diz "vim do YouTube, código YT1234": a
// secretária digita o código aqui e cai na ficha do lead (David, 14/11/26).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Search } from "lucide-react";
import { ROTULO_ETAPA, type Etapa } from "@/lib/youtube";
import { buscarLeads } from "./acoes";

export default function BuscarLead({ clienteId }: { clienteId: string }) {
  const router = useRouter();
  const [termo, setTermo] = useState("");
  const [achados, setAchados] = useState<{ id: string; nome: string; codigo: string; etapa: string }[] | null>(null);
  const vez = useRef(0);

  async function buscar(t: string) {
    setTermo(t);
    const minha = ++vez.current;
    const r = t.trim().length >= 2 ? await buscarLeads(clienteId, t) : null;
    if (minha === vez.current) setAchados(r);
  }

  return (
    <form className="relative w-full sm:w-72" onSubmit={(e) => { e.preventDefault(); if (achados?.length === 1) router.push(`/youtube/leads/${achados[0].id}`); }}>
      <label htmlFor="buscar-lead" className="sr-only">Buscar lead pelo código ou nome</label>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
      <input id="buscar-lead" className="campo pl-9" placeholder="Código (YT1234) ou nome" value={termo} onChange={(e) => buscar(e.target.value)} autoComplete="off" />
      {achados && (
        <ul className="absolute z-20 mt-1 w-full divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm shadow-lg">
          {achados.length === 0 && <li className="px-3 py-2 text-zinc-500">Nenhum lead com esse código ou nome.</li>}
          {achados.map((l) => (
            <li key={l.id}>
              <Link href={`/youtube/leads/${l.id}`} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-zinc-50">
                <span className="min-w-0 truncate">{l.nome}</span>
                <span className="shrink-0 text-xs text-zinc-500"><b className="font-mono text-zinc-700">{l.codigo}</b> · {ROTULO_ETAPA[l.etapa as Etapa] ?? l.etapa}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
