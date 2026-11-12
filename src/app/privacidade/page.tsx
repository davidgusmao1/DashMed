import type { Metadata } from "next";

// Política de Privacidade pública (12/11/26). O Google exige a URL dela para
// publicar o app OAuth do YouTube Seller ("Em produção"), e as políticas da
// API do YouTube pedem que ela diga que o app usa os Serviços de API do
// YouTube, o que lê e guarda, e como revogar o acesso. Fica fora do grupo
// (app): é lida sem login (o proxy libera /privacidade).
export const metadata: Metadata = { title: "Política de Privacidade — DashMed" };

export default function Privacidade() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10 text-[15px] leading-relaxed text-zinc-800">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-lg bg-teal-700 text-xs font-bold text-white">DM</span>
        <div>
          <h1 className="text-2xl font-bold">Política de Privacidade da DashMed</h1>
          <p className="text-sm text-zinc-500">Atualizada em 12 de novembro de 2026</p>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">1. Quem somos</h2>
        <p>
          A DashMed é uma plataforma de gestão usada por médicos (cada um, um &quot;cliente&quot; da plataforma) e pelas equipes deles.
          Cada médico é o controlador dos dados do próprio consultório; a DashMed trata esses dados em nome dele, só para as funções descritas aqui,
          seguindo a Lei Geral de Proteção de Dados (Lei 13.709/2018).
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">2. Uso dos Serviços de API do YouTube</h2>
        <p>
          O recurso <b>YouTube Seller</b> da DashMed usa os <b>Serviços de API do YouTube</b>. Ao conectar o seu canal, você concorda com os{" "}
          <a className="text-teal-700 underline" href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">Termos de Serviço do YouTube</a>,
          e o uso dos seus dados pelo Google segue a{" "}
          <a className="text-teal-700 underline" href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Política de Privacidade do Google</a>.
        </p>
        <p>Com a sua autorização (escopo <code>youtube.force-ssl</code>), a DashMed:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>lê o nome, o identificador e a foto do canal conectado;</li>
          <li>lê os comentários públicos feitos nos vídeos do seu canal (texto, autor, foto do autor, data, curtidas e se o canal já respondeu);</li>
          <li>publica, <b>somente quando você clica em &quot;Publicar&quot;</b>, a resposta que você revisou a um comentário do seu canal.</li>
        </ul>
        <p>A DashMed não publica nada sem o seu clique, não envia vídeos, não altera o seu canal e não lê dados de outros canais além dos comentários feitos no seu.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">3. Para que usamos esses dados</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Separar os comentários de quem pergunta sobre consulta ou tratamento e sugerir uma resposta para você revisar.</li>
          <li>Acompanhar, no CRM da DashMed, as pessoas que comentaram e foram respondidas (por exemplo, quando entram em contato pelo telefone informado na resposta).</li>
        </ul>
        <p>Não vendemos dados, não usamos para publicidade e não cruzamos com informações de outras fontes.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">4. Com quem compartilhamos</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li><b>Anthropic</b> (modelo de IA Claude): recebe o texto dos comentários para classificar e sugerir a resposta, usando a chave de API do próprio médico.</li>
          <li><b>Supabase</b> (banco de dados, em São Paulo, Brasil) e <b>Vercel</b> (hospedagem, região de São Paulo): guardam e servem os dados da plataforma.</li>
        </ul>
        <p>Nenhum outro terceiro recebe esses dados.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">5. Como guardamos</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>O acesso ao canal (token do Google) fica cifrado no cofre do banco e só é lido pelos serviços internos da DashMed; nunca aparece na tela.</li>
          <li>Cada médico só enxerga os dados do próprio consultório; o acesso é controlado no banco e as alterações ficam registradas (auditoria).</li>
          <li>Os comentários e o histórico de acompanhamento ficam guardados enquanto o canal estiver conectado ou até o médico pedir a exclusão.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">6. Como revogar o acesso e pedir exclusão</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Na DashMed: Configurações → YouTube Seller → <b>Desconectar</b> (o token é revogado no Google e apagado do nosso cofre).</li>
          <li>No Google, a qualquer momento: <a className="text-teal-700 underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a>.</li>
          <li>Quem comentou num canal atendido pela DashMed pode pedir ao médico responsável pelo canal acesso, correção ou exclusão dos seus dados, como garante a LGPD.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">7. Contato</h2>
        <p>Dúvidas sobre esta política ou pedidos sobre seus dados: pelo e-mail de suporte mostrado na tela de autorização do Google, ou diretamente com o médico responsável pelo canal.</p>
      </section>
    </main>
  );
}
