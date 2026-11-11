import { clientesDe, supabaseServidor, usuarioAtual } from "@/lib/supabase/server";
import type { Integracao, Perfil } from "@/lib/conteudo";
import Chaves from "./chaves";
import PerfilForm from "./perfil-form";

// Configurações do cliente em foco: perfil para os roteiros e chaves de API
// (David, 10/11/26: "já nas configurações do sistema faça um local onde eu
// posso colocar as APIs/tokens necessárias").
export default async function Configuracoes() {
  const eu = await usuarioAtual();
  if (!eu) return null;
  const { emFoco } = await clientesDe(eu);
  if (!emFoco) return <p className="text-sm text-zinc-500">Nenhum cliente cadastrado.</p>;
  const supabase = await supabaseServidor();
  const [{ data: integracoes }, { data: perfil }] = await Promise.all([
    supabase.from("integracoes").select("provedor, final, parametros, teste_ok, teste_msg, testada_em, atualizado_em").eq("cliente_id", emFoco.id),
    supabase.from("perfis_conteudo").select("nome_exibicao, especialidade, crm, rqe, publico, tom, chamada_final").eq("cliente_id", emFoco.id).maybeSingle(),
  ]);
  const podeEditar = eu.plataforma || (eu.papel === "admin" && eu.cliente_id === emFoco.id);

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-sm text-zinc-500">Cliente: {emFoco.nome}</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Chaves de API</h2>
        <p className="max-w-3xl text-sm text-zinc-600">
          As chaves ficam guardadas cifradas no cofre do banco. Depois de salvas, ninguém as vê de novo, nem esta tela: aparecem só os 4 últimos caracteres.
          Cada chave é testada com o provedor antes de ser guardada.
        </p>
        <Chaves clienteId={emFoco.id} integracoes={(integracoes ?? []) as Integracao[]} podeEditar={podeEditar} />
        <div className="cartao p-5 text-sm">
          <div className="font-semibold">Publicações médicas: Europe PMC (PubMed)</div>
          <p className="text-zinc-600">Não precisa de chave. A busca usa só artigos indexados no PubMed, com PMID, para cada referência poder ser conferida.</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Roteiros</h2>
        <PerfilForm perfil={(perfil ?? null) as Perfil | null} podeEditar={podeEditar} />
      </section>

      <section className="cartao space-y-2 p-5 text-sm text-zinc-700">
        <div className="font-semibold">Para gerar o vídeo com a sua imagem</div>
        <ol className="list-decimal space-y-1 pl-5">
          <li>No app da HeyGen, crie o seu <b>gêmeo digital</b> (Digital Twin): um vídeo seu falando para a câmera e um vídeo curto de consentimento.</li>
          <li>Clone a sua <b>voz</b> na HeyGen, para o avatar falar com a sua voz em português.</li>
          <li>Coloque saldo na <b>carteira de API</b> da HeyGen e cole a chave acima.</li>
          <li>Clique em &quot;Carregar meus avatares e vozes&quot; e escolha os seus.</li>
        </ol>
        <p className="text-xs text-zinc-500">
          Custo aproximado de um vídeo de 15 minutos com avatar próprio pela API da HeyGen (preço público em 10/11/26, pode mudar): Avatar IV ≈ US$ 72; Avatar III ≈ US$ 9.
          O roteiro com a Claude custa centavos a cerca de US$ 1.
        </p>
      </section>
    </div>
  );
}
