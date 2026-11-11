import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Phone } from "lucide-react";
import { supabaseServidor, usuarioAtual } from "@/lib/supabase/server";
import { dataBR, diasEntre, hojeSP, instanteBR, prazoTexto } from "@/lib/datas";
import { telefoneBR } from "@/lib/telefone";
import { FormConfirmar, FormSituacao, FormTelefone, FormVencimento } from "./editar";

// Ficha da terapia: o que quem vai chamar precisa saber (telefone, vencimento,
// por que foi indicada) e o que pode mudar. Tudo lido pela RLS de quem está
// logado; o histórico vem da auditoria (só plataforma e admin do cliente veem).

const SITUACAO: Record<string, string> = { a_chamar: "A chamar", agendado: "Agendado", nao_renovar: "Não vai renovar" };
const CAMPOS: Record<string, string> = {
  telefone: "telefone", vence_em: "vencimento", vence_em_manual: "vencimento digitado", situacao: "situação",
  situacao_por: "quem mudou a situação", revisar: "revisão", revisar_motivo: "motivo da revisão",
  ultima_indicacao_em: "última indicação", nome: "nome", observacoes: "observações", nota: "nota", deleted_at: "remoção",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Terapia = {
  id: string; procedimento: string; ultima_indicacao_em: string | null; vence_em: string | null; vence_em_manual: boolean;
  revisar: boolean; revisar_motivo: string | null; situacao: string; situacao_em: string; situacao_por: string | null;
  pacientes: { id: string; nome: string; telefone: string | null } | null;
};

export default async function FichaDaTerapia({ params }: { params: Promise<{ id: string }> }) {
  const eu = await usuarioAtual();
  if (!eu) return null;
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await supabaseServidor();
  const { data, error } = await supabase.from("terapias")
    .select("id, procedimento, ultima_indicacao_em, vence_em, vence_em_manual, revisar, revisar_motivo, situacao, situacao_em, situacao_por, pacientes(id, nome, telefone)")
    .eq("id", id).maybeSingle();
  if (error) return <p className="text-sm">Não consegui abrir a terapia: {error.message}</p>;
  if (!data) notFound();
  const t = data as unknown as Terapia;
  const pac = t.pacientes;

  const [indicacoes, outras, historico] = await Promise.all([
    supabase.from("indicacoes").select("id, indicada_em, horario, tipo_atendimento, procedimento_original, nota")
      .eq("terapia_id", id).is("deleted_at", null).order("indicada_em", { ascending: false }),
    pac ? supabase.from("terapias").select("id, procedimento, vence_em, situacao")
      .eq("paciente_id", pac.id).neq("id", id).is("deleted_at", null) : Promise.resolve({ data: [] }),
    supabase.from("auditoria").select("id, em, acao, tabela, campos, usuario_id")
      .in("registro_id", pac ? [id, pac.id] : [id]).order("em", { ascending: false }).limit(15),
  ]);
  const ids = [...new Set([t.situacao_por, ...(historico.data ?? []).map((h) => h.usuario_id)].filter(Boolean))] as string[];
  const { data: pessoas } = ids.length ? await supabase.from("usuarios").select("id, nome").in("id", ids) : { data: [] };
  const nomeDe = (uid: string | null) => (uid && pessoas?.find((p) => p.id === uid)?.nome) || "sistema";

  const hoje = hojeSP();
  const vencida = t.vence_em ? diasEntre(hoje, t.vence_em) < 0 : false;

  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/agenda" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900"><ArrowLeft size={14} /> Agenda</Link>
      <div>
        <h1 className="text-2xl font-bold">{pac?.nome ?? "Paciente"}</h1>
        <p className="text-sm text-zinc-500">
          {t.procedimento} · {SITUACAO[t.situacao] ?? t.situacao} desde {instanteBR(t.situacao_em)} ({nomeDe(t.situacao_por)})
        </p>
      </div>

      {t.revisar && (
        <div className="cartao space-y-3 border-zinc-300 p-5">
          <p className="text-sm"><b>Indicação para revisar</b> — na planilha estava como &quot;{t.revisar_motivo}&quot;. Enquanto não for confirmada, não entra na lista de chamada.</p>
          <FormConfirmar terapiaId={t.id} />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="cartao space-y-3 p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Contato</div>
          {pac?.telefone && (
            <a href={`tel:+55${pac.telefone.replace(/^55(?=\d{10,11}$)/, "")}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-800">
              <Phone size={14} /> {telefoneBR(pac.telefone)}
            </a>
          )}
          {pac && <FormTelefone pacienteId={pac.id} telefone={pac.telefone} />}
        </div>
        <div className="cartao space-y-3 p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Vencimento</div>
          <p className="text-sm">
            {dataBR(t.vence_em)} · <span className={vencida ? "font-semibold text-red-700" : "text-zinc-600"}>{prazoTexto(t.vence_em, hoje)}</span>
            <span className="block text-xs text-zinc-500">
              {t.vence_em_manual ? "data digitada (a importação não recalcula)" : `calculado pelo prazo a partir de ${dataBR(t.ultima_indicacao_em)}`}
            </span>
          </p>
          <FormVencimento terapiaId={t.id} venceEm={t.vence_em} />
        </div>
      </div>

      <div className="cartao p-5">
        <FormSituacao terapiaId={t.id} situacao={t.situacao} />
      </div>

      <div className="cartao p-5">
        <div className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Indicações ({indicacoes.data?.length ?? 0})</div>
        {indicacoes.error && <p className="text-sm">Não consegui ler as indicações: {indicacoes.error.message}</p>}
        <ul className="space-y-3">
          {(indicacoes.data ?? []).map((i) => (
            <li key={i.id} className="text-sm">
              <div className="font-medium">
                {dataBR(i.indicada_em)}{i.horario ? ` às ${i.horario}` : ""}
                <span className="font-normal text-zinc-500">{[i.tipo_atendimento, i.procedimento_original].filter(Boolean).map((x) => ` · ${x}`).join("")}</span>
              </div>
              {i.nota && <p className="mt-0.5 whitespace-pre-line text-zinc-600">{i.nota}</p>}
            </li>
          ))}
        </ul>
      </div>

      {(outras.data?.length ?? 0) > 0 && (
        <div className="cartao p-5">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Outras terapias do paciente</div>
          <ul className="space-y-1 text-sm">
            {(outras.data ?? []).map((o) => (
              <li key={o.id}>
                <Link href={`/agenda/${o.id}`} className="text-teal-800 hover:underline">{o.procedimento}</Link>
                <span className="text-zinc-500"> · vence {dataBR(o.vence_em)} · {SITUACAO[o.situacao] ?? o.situacao}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(historico.data?.length ?? 0) > 0 && (
        <div className="cartao p-5">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Histórico (auditoria)</div>
          <ul className="space-y-1 text-xs text-zinc-600">
            {(historico.data ?? []).map((h) => (
              <li key={h.id}>
                {instanteBR(h.em)} · {nomeDe(h.usuario_id)} ·{" "}
                {h.acao === "insert" ? `criou ${h.tabela === "pacientes" ? "o paciente" : "a terapia"}`
                  : `mudou ${(h.campos ?? []).map((c: string) => CAMPOS[c] ?? c).join(", ")}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
