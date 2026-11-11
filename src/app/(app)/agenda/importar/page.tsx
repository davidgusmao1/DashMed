import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { clientesDe, supabaseServidor, usuarioAtual } from "@/lib/supabase/server";
import { instanteBR } from "@/lib/datas";
import Importador from "./importador";

// Importar a planilha de indicações para a Agenda (David, 10/11/26: "esse é um
// exemplo" — indicacoes-protese-ah-hidrogel-ago-out-2026.xlsx). Embaixo, o
// histórico das importações do cliente, com o que entrou e o que deu erro.
export default async function Importar() {
  const eu = await usuarioAtual();
  if (!eu) return null;
  const { emFoco } = await clientesDe(eu);
  if (!emFoco) return <p className="text-sm text-zinc-500">Nenhum cliente cadastrado.</p>;

  const supabase = await supabaseServidor();
  const { data: importacoes, error } = await supabase.from("importacoes")
    .select("id, arquivo, linhas, pacientes_novos, terapias_novas, indicacoes_novas, ja_existiam, com_erro, erros, feita_em, concluida_em")
    .eq("cliente_id", emFoco.id).order("feita_em", { ascending: false }).limit(20);

  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/agenda" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900"><ArrowLeft size={14} /> Agenda</Link>
      <div>
        <h1 className="text-2xl font-bold">Importar planilha</h1>
        <p className="text-sm text-zinc-500">
          Para o cliente <b>{emFoco.nome}</b>. Reimportar a mesma planilha não duplica: paciente com o mesmo nome e consulta da mesma data são reconhecidos.
        </p>
      </div>

      <Importador cliente={emFoco.nome} />

      <div className="cartao p-5">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Importações anteriores</div>
        {error && <p className="text-sm">Não consegui ler o histórico: {error.message}</p>}
        {!error && !importacoes?.length && <p className="text-sm text-zinc-500">Nenhuma ainda.</p>}
        <ul className="divide-y divide-zinc-100 text-sm">
          {(importacoes ?? []).map((i) => (
            <li key={i.id} className="py-2">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">{i.arquivo}</span>
                <span className="text-xs text-zinc-500">{instanteBR(i.feita_em)}</span>
              </div>
              <div className="text-xs text-zinc-600">
                {i.concluida_em
                  ? `${i.linhas} linhas · ${i.pacientes_novos} pacientes novos · ${i.terapias_novas} terapias novas · ${i.indicacoes_novas} indicações novas · ${i.ja_existiam} já existiam · ${i.com_erro} com erro`
                  : "Interrompida: nada desta importação foi gravado."}
              </div>
              {Array.isArray(i.erros) && i.erros.length > 0 && (
                <details className="text-xs text-zinc-600">
                  <summary className="cursor-pointer">linhas com erro</summary>
                  {(i.erros as { linha: number; motivo: string }[]).slice(0, 50).map((e) => <div key={e.linha}>linha {e.linha}: {e.motivo}</div>)}
                </details>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
