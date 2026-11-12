import { ExternalLink } from "lucide-react";

// Como instalar a extensão que faz o botão "Abrir ficha no Apolo Ninsaúde"
// funcionar (David, 12/11/26). Uma vez por computador/navegador.
export default function ExtensaoApolo() {
  const passo = "flex gap-3";
  const num = "grid size-7 shrink-0 place-items-center rounded-full bg-teal-700 text-xs font-bold text-white";
  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Extensão do Apolo Ninsaúde</h1>
        <p className="text-sm text-zinc-500">
          O Apolo não tem link que abra a ficha de um paciente direto. Esta extensão, instalada uma vez em cada computador, faz o botão
          &quot;Abrir ficha no Apolo Ninsaúde&quot; do CRM abrir a ficha certa lá dentro.
        </p>
      </div>

      <ol className="cartao space-y-5 p-6 text-sm">
        <li className={passo}>
          <span className={num}>1</span>
          <div className="space-y-2">
            <p><b>Instale o Tampermonkey</b> no Google Chrome (gratuito, da loja do Chrome).</p>
            <a className="botao-claro" target="_blank" rel="noreferrer"
              href="https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo">
              <ExternalLink size={16} /> Abrir o Tampermonkey na Chrome Web Store
            </a>
          </div>
        </li>
        <li className={passo}>
          <span className={num}>2</span>
          <div className="space-y-1">
            <p><b>Libere scripts de usuário</b> (exigência das versões novas do Chrome):</p>
            <p className="text-zinc-600">
              Digite <code className="rounded bg-zinc-100 px-1">chrome://extensions</code> na barra de endereço → em Tampermonkey, clique em
              <b> Detalhes</b> → ligue <b>Permitir scripts de usuário</b> (se a opção não aparecer, ligue o <b>Modo do desenvolvedor</b> no canto
              superior direito).
            </p>
          </div>
        </li>
        <li className={passo}>
          <span className={num}>3</span>
          <div className="space-y-2">
            <p><b>Instale o script da DashMed</b>: o Tampermonkey abre uma página com o botão <b>Instalar</b>.</p>
            <a className="botao" href="/dashmed-apolo.user.js">Instalar o script da DashMed</a>
          </div>
        </li>
        <li className={passo}>
          <span className={num}>4</span>
          <p>
            <b>Pronto.</b> Esteja logado no Apolo neste navegador. No CRM, abra um paciente e clique em <b>Abrir ficha no Apolo Ninsaúde</b>:
            a ficha abre numa aba do Apolo (sempre a mesma). Se o Apolo pedir login, entre e a ficha abre em seguida.
          </p>
        </li>
      </ol>

      <div className="cartao space-y-2 p-5 text-xs text-zinc-600">
        <p className="font-semibold text-zinc-800">O que o script faz (e o que não faz)</p>
        <p>Ele só roda no site do Apolo e só age quando o endereço vem da DashMed com o código do paciente: aí chama a mesma função que o Apolo usa para abrir uma ficha. Não lê, não grava e não envia nenhum dado.</p>
        <p>Pacientes sem código do Apolo (cadastro duplicado lá) abrem a lista de Pacientes já buscando pelo telefone; aí é escolher o cadastro certo.</p>
      </div>
    </div>
  );
}
