"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Enquanto algo está andando (busca, roteiro, vídeo), relê a página a cada
 *  5 s para a tela mostrar o estado verdadeiro do banco. */
export default function Atualizador({ ativo }: { ativo: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [ativo, router]);
  return null;
}
