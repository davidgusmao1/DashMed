"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Enquanto a varredura anda, relê a página a cada 5 s: o que a tela mostra
 *  é o estado do banco. */
export default function Atualizador({ ativo }: { ativo: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [ativo, router]);
  return null;
}
