"use server";

// Ações do CRM de resgate. Toda escrita vai pela sessão de quem está logado
// (RLS), e toda recusa volta com motivo para a tela — inclusive a de um update
// que a RLS filtrou e "deu certo" sem mudar nada.
import { revalidatePath } from "next/cache";
import { supabaseServidor, usuarioAtual } from "@/lib/supabase/server";
import { lerData } from "@/lib/planilha";
import { ehEtapa, ehResultado } from "@/lib/crm";

export type Retorno = { ok: boolean; texto: string };

const SESSAO: Retorno = { ok: false, texto: "Sua sessão acabou. Entre de novo." };

function revalidar() {
  revalidatePath("/crm");
  revalidatePath("/agenda", "layout");
}

/** Arrastar o cartão para outra coluna. */
export async function moverEtapa(terapiaId: string, etapa: string): Promise<Retorno> {
  if (!(await usuarioAtual())) return SESSAO;
  if (!ehEtapa(etapa)) return { ok: false, texto: "Etapa inválida." };
  const supabase = await supabaseServidor();
  const { error, count } = await supabase.from("terapias").update({ situacao: etapa }, { count: "exact" }).eq("id", terapiaId);
  if (error) return { ok: false, texto: `Não moveu: ${error.message}` };
  if (!count) return { ok: false, texto: "Não moveu: o cartão não existe mais ou você não tem acesso a ele." };
  revalidar();
  return { ok: true, texto: "Movido." };
}

/** Registrar uma ligação (resultado + nota) e, na mesma transação, a etapa e o retorno. */
export async function registrarContato(fd: FormData): Promise<Retorno> {
  if (!(await usuarioAtual())) return SESSAO;
  const terapia = String(fd.get("terapia_id") ?? "");
  const resultado = String(fd.get("resultado") ?? "");
  const etapa = String(fd.get("etapa") ?? "");
  const retornoBruto = String(fd.get("retornar_em") ?? "").trim();
  const retornar = retornoBruto ? lerData(retornoBruto) : null;
  if (!ehResultado(resultado)) return { ok: false, texto: "Escolha o resultado da ligação." };
  if (etapa && !ehEtapa(etapa)) return { ok: false, texto: "Etapa inválida." };
  if (retornoBruto && !retornar) return { ok: false, texto: "Data de retorno inválida." };
  const supabase = await supabaseServidor();
  const { error } = await supabase.rpc("registrar_contato", {
    p_terapia: terapia,
    p_resultado: resultado,
    p_nota: String(fd.get("nota") ?? "").slice(0, 2000),
    p_etapa: etapa || null,
    p_retornar_em: retornar,
  });
  if (error) return { ok: false, texto: `A ligação não foi registrada: ${error.message}` };
  revalidar();
  return { ok: true, texto: "Ligação registrada." };
}

/** Quem cuida do cartão (vazio = ninguém). */
export async function atribuir(terapiaId: string, responsavelId: string): Promise<Retorno> {
  if (!(await usuarioAtual())) return SESSAO;
  const supabase = await supabaseServidor();
  const { error, count } = await supabase.from("terapias")
    .update({ responsavel_id: responsavelId || null }, { count: "exact" }).eq("id", terapiaId);
  if (error) return { ok: false, texto: `Não salvou: ${error.message}` };
  if (!count) return { ok: false, texto: "Não salvou: o cartão não existe mais ou você não tem acesso a ele." };
  revalidar();
  return { ok: true, texto: responsavelId ? "Responsável salvo." : "Sem responsável." };
}
