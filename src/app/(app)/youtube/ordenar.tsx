"use client";

// "Ordenar por" da fila de respostas e do resultado da busca (David, 15/11/26:
// "ordenar por porcentagem de consulta, porcentagem de cirurgia e parte
// socioeconômica ... mais recente ou menos recente"). A ordem fica na URL e
// quem ordena é o servidor, na lista inteira (não só na página da tela).
import { useRouter } from "next/navigation";
import { ArrowDownUp } from "lucide-react";

export default function Ordenar({ id, valor, opcoes }: { id: string; valor: string; opcoes: { id: string; rotulo: string; href: string }[] }) {
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-zinc-600">
      <ArrowDownUp size={14} className="text-zinc-400" />
      <label htmlFor={id}>Ordenar por</label>
      <select id={id} className="campo w-auto py-1" value={valor}
        onChange={(e) => { const o = opcoes.find((x) => x.id === e.target.value); if (o) router.push(o.href); }}>
        {opcoes.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
      </select>
    </span>
  );
}
