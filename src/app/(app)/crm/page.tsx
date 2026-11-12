import Link from "next/link";
import { Search, Upload } from "lucide-react";
import { clientesDe, supabaseServidor, usuarioAtual } from "@/lib/supabase/server";
import { ETAPAS, ehCirurgia, type Etapa } from "@/lib/crm";
import { hojeSP } from "@/lib/datas";
import Quadro, { type Cartao, type Coluna } from "./quadro";

// CRM de resgate em Kanban (David, 11/11/26: "para que minhas secretárias
// entrem em contato com os pacientes que ainda não fizeram cirurgias ...
// resgatar pacientes que tiveram um tratamento indicado e não realizaram").
// Abre filtrado nas cirurgias; os outros procedimentos ficam a um clique.

const POR_COLUNA = 60;

export default async function Crm({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const eu = await usuarioAtual();
  if (!eu) return null;
  const { emFoco } = await clientesDe(eu);
  if (!emFoco) return <p className="text-sm text-zinc-500">Nenhum cliente cadastrado.</p>;

  const sp = await searchParams;
  const proc = typeof sp.proc === "string" && sp.proc ? sp.proc : "cirurgias";
  const busca = typeof sp.q === "string" ? sp.q.replace(/[%_,()]/g, " ").trim().slice(0, 60) : "";
  const meus = sp.resp === "meus";

  const supabase = await supabaseServidor();
  const [{ data: resumo, error: erroResumo }, { data: usuarios }] = await Promise.all([
    supabase.rpc("resumo_crm", { p_cliente: emFoco.id }),
    supabase.from("usuarios").select("id, nome").eq("cliente_id", emFoco.id).eq("ativo", true).is("deleted_at", null).order("nome"),
  ]);
  const linhasResumo = (resumo ?? []) as { procedimento: string; situacao: string; n: number }[];
  const porProc = new Map<string, number>();
  for (const r of linhasResumo) porProc.set(r.procedimento, (porProc.get(r.procedimento) ?? 0) + Number(r.n));
  const procedimentos = [...porProc].sort((a, b) => b[1] - a[1]);
  const cirurgias = procedimentos.filter(([p]) => ehCirurgia(p)).map(([p]) => p);
  const filtro = proc === "todos" ? null : proc === "cirurgias" ? cirurgias : [proc];

  // Uma consulta por coluna. O construtor do supabase-js, sem tipos gerados do
  // banco, estoura a inferência do TypeScript dentro de funções; daí o tipo solto.
  type Consulta = ReturnType<ReturnType<typeof supabase.from>["select"]>;
  const campos = `id, procedimento, ultima_indicacao_em, revisar, revisar_motivo, situacao, retornar_em, contatos_qtd,
    ultimo_contato_em, ultimo_resultado, responsavel_id, vence_em, ultima_realizacao_em, lado_pendente,
    pacientes${busca ? "!inner" : ""}(nome, telefone, apolo_id)`;
  const hoje = hojeSP();
  const coluna = (etapa: Etapa) => {
    let q = (supabase.from("terapias").select(campos, { count: "exact" }) as unknown as Consulta)
      .eq("cliente_id", emFoco.id).is("deleted_at", null);
    // AH já aplicado volta sozinho para "A contatar" quando passa do prazo de
    // renovação (David, 11/11/26: "passou de 6 meses, ele é candidato a ser
    // chamado novamente") — sem cron: a coluna lê o vencimento
    if (etapa === "a_chamar") q = q.or(`situacao.eq.a_chamar,and(situacao.eq.realizado,vence_em.lte.${hoje})`);
    else if (etapa === "realizado") q = q.eq("situacao", "realizado").or(`vence_em.is.null,vence_em.gt.${hoje}`);
    else q = q.eq("situacao", etapa);
    if (filtro) q = q.in("procedimento", filtro.length ? filtro : ["—"]);
    if (busca) q = q.ilike("pacientes.nome", `%${busca}%`);
    if (meus) q = q.eq("responsavel_id", eu.id);
    // quem tem retorno marcado primeiro; depois a indicação mais recente (mais fácil de resgatar)
    return q.order("retornar_em", { ascending: true, nullsFirst: false })
      .order("ultima_indicacao_em", { ascending: false, nullsFirst: false })
      .range(0, POR_COLUNA - 1);
  };
  const respostas = await Promise.all(ETAPAS.map((e) => coluna(e.valor)));
  const erro = erroResumo ?? respostas.find((r) => r.error)?.error;
  const colunas: Coluna[] = ETAPAS.map((e, i) => ({
    etapa: e.valor,
    total: respostas[i].count ?? 0,
    cartoes: (respostas[i].data ?? []) as unknown as Cartao[],
  }));

  const link = (p: { proc?: string; q?: string; resp?: string }) => {
    const u = new URLSearchParams();
    const v = { proc, q: busca, resp: meus ? "meus" : "", ...p };
    if (v.proc && v.proc !== "cirurgias") u.set("proc", v.proc);
    if (v.q) u.set("q", v.q);
    if (v.resp) u.set("resp", v.resp);
    const s = u.toString();
    return s ? `/crm?${s}` : "/crm";
  };
  const chip = (ativo: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium ${ativo ? "border-teal-700 bg-teal-50 text-teal-800" : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50"}`;
  const totalCirurgias = cirurgias.reduce((n, p) => n + (porProc.get(p) ?? 0), 0);
  const totalGeral = procedimentos.reduce((n, [, q]) => n + q, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">CRM de resgate</h1>
          <p className="text-sm text-zinc-500">Pacientes com tratamento indicado e ainda não realizado · {emFoco.nome}</p>
        </div>
        <Link href="/agenda/importar" className="botao-claro"><Upload size={16} /> Importar planilha</Link>
      </div>

      {erro && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900">Não consegui ler o CRM: {erro.message}</p>}

      {totalGeral === 0 ? (
        <div className="cartao space-y-3 p-6 text-sm">
          <p className="font-semibold">Ainda não há pacientes no CRM.</p>
          <p className="text-zinc-600">Importe a planilha de indicações. Cada paciente + procedimento indicado vira um cartão em &quot;A contatar&quot;.</p>
          <Link href="/agenda/importar" className="botao"><Upload size={16} /> Importar planilha</Link>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={link({ proc: "cirurgias" })} className={chip(proc === "cirurgias")}>Cirurgias ({totalCirurgias})</Link>
            <Link href={link({ proc: "todos" })} className={chip(proc === "todos")}>Todos ({totalGeral})</Link>
            {procedimentos.map(([p, n]) => (
              <Link key={p} href={link({ proc: p })} className={chip(proc === p)}>{p} ({n})</Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form action="/crm" className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-sm">
              {proc !== "cirurgias" && <input type="hidden" name="proc" value={proc} />}
              {meus && <input type="hidden" name="resp" value="meus" />}
              <div className="relative min-w-0 flex-1">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input name="q" defaultValue={busca} placeholder="Buscar paciente pelo nome" className="campo pl-8" />
              </div>
              <button className="botao-claro shrink-0">Buscar</button>
            </form>
            <Link href={link({ resp: meus ? "" : "meus" })} className={chip(meus)}>Só os meus</Link>
            {busca && <Link href={link({ q: "" })} className="text-xs text-zinc-500 underline">limpar busca</Link>}
          </div>
          <Quadro colunas={colunas} usuarios={(usuarios ?? []) as { id: string; nome: string }[]} hoje={hoje} />
        </>
      )}
    </div>
  );
}
