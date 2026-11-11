import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // A importação da Agenda manda a planilha para uma server action; o
      // padrão de 1 MB é pouco para uma planilha grande. 4 MB fica abaixo do
      // teto de 4,5 MB do corpo de requisição na Vercel (10/11/26).
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
