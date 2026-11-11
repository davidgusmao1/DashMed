import Link from "next/link";
import { ChevronRight, PhoneOff, Upload } from "lucide-react";
import { clientesDe, supabaseServidor, usuarioAtual } from "@/lib/supabase/server";
import { dataBR, diasEntre, hojeSP, prazoTexto, somarDias } from "@/lib/datas";
import { telefoneBR } from "@/lib/telefone";

// Agenda: as terapias que precisam ser renovadas e quem precisa ser chamado
// (David, 10/11/26). A chamada em si vai sair pelo sistema do Prospekt quando
// a API vier; até lá a lista mostra quem chamar e guarda a situação.

const ABAS = [
  { chave: "chamar", rotulo: "A chamar" },
  { chave: "revisar", rotulo: "Para revisar" },
  { chave: "agendados", rotulo: "Agendados" },
  { chave: "encerradas", rotulo: "Não vão renovar" },
] as const;
type Aba = (typeof ABAS)[number]["chave"];

const JANELAS = [
  { chave: "0", rotulo: "Vencidas" },
  { chave: "30", rotulo: "Até 30 dias" },
  { chave: "60", rotulo: "Até 60 dias" },
  { chave: "90", rotulo: "Até 90 dias" },
  { chave: "todas", rotulo: "Todas" },
] as const;

const LIMITE = 500;

type Linha = {
  id: string;
  procedimento: string;
  ultima_indicacao_em: string | null;
  vence_em: string | null;
  revisar: boolean;
  revisar_motivo: string | null;
  situacao: string;
  pacientes: { id: string; nome: string; telefone: string | null } | null;
};

export default async function Agenda({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const eu = await usuarioAtual();
  if (!eu) return null;
  const { emFoco } = await clientesDe(eu);
  if (!emFoco) return <p className="text-sm text-zinc-500">Nenhum cliente cadastrado.</p>;

  const sp = await searchParams;
  const aba: Aba = ABAS.some((a) => a.chave === sp.ver) ? (sp.ver as Aba) : "chamar";
  const janela = JANELAS.some((j) => j.chave === sp.janela) ? String(sp.janela) : "30";
  const hoje = hojeSP();
  const limite = janela === "todas" ? null : janela === "0" ? somarDias(hoje, -1) : somarDias(hoje, Number(janela));

  const supabase = await supabaseServidor();
  // Cada aba é um filtro sobre as terapias do cliente em foco. O construtor de
  // consultas do supabase-js, sem tipos gerados do banco, estoura a inferência
  // do TypeScript quando passa por uma função; daí o tipo solto aqui.
  type Consulta = ReturnType<ReturnType<typeof supabase.from>["select"]>;
  const filtrar = (q: Consulta, qual: Aba): Consulta => {
    q = q.eq("cliente_id", emFoco.id).is("deleted_at", null);
    if (qual === "chamar") {
      q = q.eq("situacao", "a_chamar").eq("revisar", false);
      if (limite) q = q.or(`vence_em.is.null,vence_em.lte.${limite}`);
      return q;
    }
    if (qual === "revisar") return q.eq("revisar", true).neq("situacao", "nao_renovar");
    if (qual === "agendados") return q.eq("situacao", "agendado");
    return q.eq("situacao", "nao_renovar");
  };
  const contar = (qual: Aba) => filtrar(supabase.from("terapias").select("id", { count: "exact", head: true }), qual);

  const [lista, ...contagens] = await Promise.all([
    filtrar(
      supabase.from("terapias").select(
        "id, procedimento, ultima_indicacao_em, vence_em, revisar, revisar_motivo, situacao, pacientes(id, nome, telefone)",
        { count: "exact" },
      ),
      aba,
    ).order("vence_em", { ascending: true, nullsFirst: true }).range(0, LIMITE - 1),
    ...ABAS.map((a) => contar(a.chave)),
  ]);
  const erro = lista.error ?? contagens.find((c) => c.error)?.error;
  const linhas = (lista.data ?? []) as unknown as Linha[];
  const total = lista.count ?? linhas.length;
  const { count: algumaTerapia } = await supabase.from("terapias").select("id", { count: "exact", head: true })
    .eq("cliente_id", emFoco.id).is("deleted_at", null);

  const link = (p: { ver?: Aba; janela?: string }) => {
    const ver = p.ver ?? aba;
    const q = new URLSearchParams({ ver });
    if (ver === "chamar") q.set("janela", p.janela ?? janela);
    return `/agenda?${q}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Agenda</h1>
          <p className="text-sm text-zinc-500">Terapias para renovar: quem precisa ser chamado · {emFoco.nome}</p>
        </div>
        <Link href="/agenda/importar" className="botao-claro"><Upload size={16} /> Importar planilha</Link>
      </div>

      {erro && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900">Não consegui ler a agenda: {erro.message}</p>}

      {algumaTerapia === 0 ? (
        <div className="cartao space-y-3 p-6 text-sm">
          <p className="font-semibold">Ainda não há terapias na agenda.</p>
          <p className="text-zinc-600">Importe a planilha de indicações (Paciente, Data, Procedimento…). Cada paciente + procedimento vira uma terapia com vencimento.</p>
          <Link href="/agenda/importar" className="botao"><Upload size={16} /> Importar planilha</Link>
        </div>
      ) : (
        <>
          <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200">
            {ABAS.map((a, i) => (
              <Link key={a.chave} href={link({ ver: a.chave })}
                className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${aba === a.chave ? "border-teal-700 text-teal-800" : "border-transparent text-zinc-500 hover:text-zinc-900"}`}>
                {a.rotulo}
                <span className={`rounded-full px-1.5 text-xs ${aba === a.chave ? "bg-teal-700 text-white" : "bg-zinc-100 text-zinc-600"}`}>{contagens[i].count ?? "–"}</span>
              </Link>
            ))}
          </nav>

          {aba === "chamar" && (
            <div className="flex flex-wrap gap-2">
              {JANELAS.map((j) => (
                <Link key={j.chave} href={link({ janela: j.chave })}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${janela === j.chave ? "border-teal-700 bg-teal-50 text-teal-800" : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50"}`}>
                  {j.rotulo}
                </Link>
              ))}
            </div>
          )}

          {linhas.length === 0 ? (
            <p className="cartao p-6 text-sm text-zinc-500">Nada aqui{aba === "chamar" && janela !== "todas" ? " nesse prazo" : ""}.</p>
          ) : (
            <div className="cartao divide-y divide-zinc-100">
              {linhas.map((t) => {
                const vencida = t.vence_em ? diasEntre(hoje, t.vence_em) < 0 : false;
                return (
                  <Link key={t.id} href={`/agenda/${t.id}`} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-zinc-50 md:grid-cols-[2fr_1.2fr_1.4fr_auto]">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{t.pacientes?.nome ?? "—"}</div>
                      <div className="flex items-center gap-1 text-xs text-zinc-500">
                        {t.pacientes?.telefone ? telefoneBR(t.pacientes.telefone) : <><PhoneOff size={12} /> sem telefone</>}
                      </div>
                    </div>
                    <ChevronRight size={16} className="row-span-3 text-zinc-300 md:order-last md:row-span-1" />
                    <div className="text-sm">
                      {t.procedimento}
                      {t.revisar && <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-700">revisar · {t.revisar_motivo}</span>}
                      <div className="text-xs text-zinc-500">indicada em {dataBR(t.ultima_indicacao_em)}</div>
                    </div>
                    <div className="text-sm">
                      {dataBR(t.vence_em)}
                      <div className={`text-xs ${vencida ? "font-semibold text-red-700" : "text-zinc-500"}`}>{prazoTexto(t.vence_em, hoje)}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
          {total > linhas.length && (
            <p className="text-xs text-zinc-500">Mostrando as {linhas.length} primeiras de {total} terapias, pelo vencimento mais próximo.</p>
          )}
        </>
      )}
    </div>
  );
}
