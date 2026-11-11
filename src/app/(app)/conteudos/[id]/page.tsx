import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { supabaseServidor, usuarioAtual } from "@/lib/supabase/server";
import type { Bloco, Conteudo, Integracao, Perfil, Referencia, Roteiro, Video } from "@/lib/conteudo";
import Atualizador from "./atualizador";
import Cabecalho from "./cabecalho";
import PassoReferencias from "./referencias";
import PassoRoteiro from "./roteiro";
import PassoVideo from "./video";

// Um conteúdo, nos três passos do fluxo do David (10/11/26): referências →
// roteiro → vídeo. Tudo lido pela RLS de quem está logado.
export default async function PaginaConteudo({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const eu = await usuarioAtual();
  if (!eu) return null;
  const { id } = await params;
  const { v } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await supabaseServidor();

  const { data: c } = await supabase.from("conteudos")
    .select("id, cliente_id, assunto, orientacoes, pesquisa_estado, pesquisa_msg, pesquisa_iniciada_em, pesquisa_terminada_em, consultas, sintese, criado_em, atualizado_em")
    .eq("id", id).is("deleted_at", null).maybeSingle();
  if (!c) notFound();
  const conteudo = c as Conteudo;

  const [{ data: refs }, { data: roteiros }, { data: integ }, { data: perfil }] = await Promise.all([
    supabase.from("referencias")
      .select("id, pmid, doi, pmcid, titulo, autores, revista, ano, tipos, citacoes, acesso_aberto, resumo, relevancia, nota, sugerida, selecionada")
      .eq("conteudo_id", id).is("deleted_at", null)
      .order("relevancia", { ascending: false, nullsFirst: false }).order("citacoes", { ascending: false }).limit(200),
    supabase.from("roteiros").select("id, versao, estado, msg, titulo, estrutura, pmids, criado_em, atualizado_em")
      .eq("conteudo_id", id).is("deleted_at", null).order("versao", { ascending: false }).limit(30),
    supabase.from("integracoes").select("provedor, final, parametros, teste_ok, teste_msg, testada_em, atualizado_em").eq("cliente_id", conteudo.cliente_id),
    supabase.from("perfis_conteudo").select("nome_exibicao, especialidade, crm, rqe, publico, tom, chamada_final").eq("cliente_id", conteudo.cliente_id).maybeSingle(),
  ]);
  const listaRoteiros = (roteiros ?? []) as Roteiro[];
  const roteiro = listaRoteiros.find((r) => r.id === v) ?? listaRoteiros[0] ?? null;
  const [{ data: blocos }, { data: videos }] = roteiro
    ? await Promise.all([
      supabase.from("roteiro_blocos").select("id, roteiro_id, ordem, titulo, fala, na_tela, editado, atualizado_em").eq("roteiro_id", roteiro.id).order("ordem"),
      supabase.from("videos").select("id, roteiro_id, estado, msg, formato, motor, avatar_nome, voz_nome, minutos_estimados, duracao_seg, criado_em, atualizado_em")
        .eq("roteiro_id", roteiro.id).is("deleted_at", null).order("criado_em", { ascending: false }).limit(20),
    ])
    : [{ data: [] }, { data: [] }];

  const integracoes = (integ ?? []) as Integracao[];
  const referencias = (refs ?? []) as Referencia[];
  const listaVideos = (videos ?? []) as Video[];
  const trabalhando = conteudo.pesquisa_estado === "buscando"
    || listaRoteiros.some((r) => r.estado === "estrutura" || r.estado === "escrevendo")
    || listaVideos.some((x) => x.estado === "enviando" || x.estado === "processando");

  return (
    <div className="max-w-5xl space-y-8">
      <Atualizador ativo={trabalhando} />
      <Link href="/conteudos" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900"><ArrowLeft size={14} /> Conteúdos</Link>
      <Cabecalho id={conteudo.id} assunto={conteudo.assunto} orientacoes={conteudo.orientacoes} criadoEm={conteudo.criado_em} />
      <PassoReferencias
        conteudo={conteudo}
        referencias={referencias}
        temChave={integracoes.some((i) => i.provedor === "anthropic")}
      />
      <PassoRoteiro
        conteudoId={conteudo.id}
        assunto={conteudo.assunto}
        roteiros={listaRoteiros.map((r) => ({ id: r.id, versao: r.versao, estado: r.estado, criado_em: r.criado_em }))}
        roteiro={roteiro}
        blocos={(blocos ?? []) as Bloco[]}
        referencias={referencias}
        perfil={(perfil ?? null) as Perfil | null}
        temChave={integracoes.some((i) => i.provedor === "anthropic")}
        duracaoReal={listaVideos.find((x) => x.estado === "pronto" && x.formato === "16:9" && x.duracao_seg)?.duracao_seg ?? null}
      />
      <PassoVideo
        roteiro={roteiro ? { id: roteiro.id, estado: roteiro.estado, versao: roteiro.versao } : null}
        blocos={(blocos ?? []) as Bloco[]}
        heygen={integracoes.find((i) => i.provedor === "heygen") ?? null}
        videos={listaVideos}
      />
    </div>
  );
}
