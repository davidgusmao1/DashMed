import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ABA_APOLO, linkApolo } from "@/lib/apolo";

// Botão "Abrir ficha no Apolo Ninsaúde" (David, 12/11/26), no cartão do CRM e
// na ficha da terapia. Abre noutra aba (sempre a mesma), e a extensão do
// Apolo abre a ficha lá dentro.
export default function BotaoApolo({ paciente }: { paciente: { apolo_id?: number | null; telefone?: string | null } | null }) {
  const href = linkApolo(paciente);
  return (
    <div className="space-y-1">
      {href ? (
        <a href={href} target={ABA_APOLO} referrerPolicy="no-referrer" className="botao-claro w-full">
          <ExternalLink size={16} /> Abrir ficha no Apolo Ninsaúde
        </a>
      ) : (
        <button type="button" disabled className="botao-claro w-full">Sem código nem telefone para achar no Apolo</button>
      )}
      <p className="text-center text-[11px] text-zinc-500">
        {paciente?.apolo_id ? `Código no Apolo: ${paciente.apolo_id}` : "Sem código do Apolo: abre a busca pelo telefone."}{" "}
        Primeira vez neste computador? <Link href="/apolo" className="underline">Instale a extensão</Link>.
      </p>
    </div>
  );
}
