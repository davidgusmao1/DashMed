// Tipos e rótulos do YouTube Seller usados pelas telas (as regras do servidor
// estão em supabase/functions/_shared/seller.ts e texto.ts).

export const ETAPAS = [
  { id: "novo", rotulo: "Novo" },
  { id: "respondido", rotulo: "Respondido" },
  { id: "conversando", rotulo: "Conversando" },
  { id: "agendado", rotulo: "Consulta agendada" },
  { id: "tratamento", rotulo: "Em tratamento" },
  { id: "perdido", rotulo: "Perdido" },
] as const;
export type Etapa = (typeof ETAPAS)[number]["id"];
export const ROTULO_ETAPA = Object.fromEntries(ETAPAS.map((e) => [e.id, e.rotulo])) as Record<Etapa, string>;

export const LOCAIS = [
  { id: "telemedicina", rotulo: "Telemedicina" },
  { id: "porto_alegre", rotulo: "Porto Alegre" },
  { id: "sao_paulo", rotulo: "São Paulo" },
] as const;

export const ROTULO_CATEGORIA: Record<string, string> = {
  agendamento: "Quer marcar",
  preco: "Pergunta preço",
  tratamento: "Tratamento",
  sintoma: "Sintoma",
  pos_operatorio: "Pós-operatório",
  duvida_geral: "Dúvida geral",
  elogio: "Elogio",
  critica: "Crítica",
  spam: "Spam",
  outro: "Outro",
};

export const TIPOS_EVENTO: Record<string, string> = {
  comentario: "Comentou no YouTube",
  resposta: "Resposta publicada",
  etapa: "Mudou de etapa",
  nota: "Anotação",
  whatsapp: "WhatsApp",
  ligacao: "Ligação",
  consulta: "Consulta",
};

export type Comentario = {
  id: string;
  comentario_id: string;
  /** na continuação de conversa, o id da própria mensagem no YouTube */
  thread_id: string;
  conversa_de: string | null;
  video_id: string;
  video_titulo: string | null;
  autor_nome: string;
  autor_foto_url: string | null;
  texto: string;
  publicado_em: string;
  curtidas: number;
  ja_respondido: boolean;
  triagem: "pendente" | "feita" | "erro";
  probabilidade: number | null;
  categoria: string | null;
  procedimentos: string[];
  urgente: boolean;
  resumo: string | null;
  resposta: "nenhuma" | "redigir" | "rascunho" | "publicando" | "publicada" | "falhou" | "ignorada";
  rascunho: string | null;
  rascunho_editado: boolean;
  sugestao_ia: string | null;
  /** vídeo do canal que a IA indicou na resposta (0017) */
  video_sugerido?: string | null;
  /** as três porcentagens da 0019 (null até a varredura calcular; socio null = texto sem base) */
  consulta_pct?: number | null;
  cirurgia_pct?: number | null;
  socio_pct?: number | null;
  socio_motivo?: string | null;
  resposta_msg: string | null;
  publicada_em: string | null;
  lead_id: string | null;
};

export type Lead = {
  id: string;
  nome: string;
  foto_url: string | null;
  codigo: string;
  etapa: Etapa;
  etapa_em: string;
  probabilidade: number;
  procedimentos: string[];
  local_interesse: string | null;
  telefone: string | null;
  notas: string;
  proximo_passo_em: string | null;
  responsavel_id: string | null;
  paciente_id: string | null;
  autor_canal_id: string | null;
  criado_em: string;
  atualizado_em: string;
  /** LGPD: dados pessoais apagados a pedido (0018) */
  anonimizado_em?: string | null;
};

export type Varredura = {
  estado: "parada" | "rodando" | "erro";
  passo: string | null;
  msg: string | null;
  iniciada_em: string | null;
  terminada_em: string | null;
  atualizado_em: string;
  historico_ate: string | null;
  historico_completo: boolean;
  lidos_total: number;
};

export type Resumo = {
  comentarios: number;
  triagem_pendente: number;
  para_revisar: number;
  redigir: number;
  publicadas: number;
  publicadas_hoje: number;
  leads: number;
  cota_hoje: number;
  edicoes_novas: number;
};

export type SellerConfig = {
  automatico: boolean;
  procedimentos: string[];
  telemedicina: string;
  porto_alegre: string;
  sao_paulo: string;
  telefone_estimativa: string;
  instrucoes: string;
  prob_minima: number;
  limite_diario: number;
};

export const LINK_VIDEO = (videoId: string, comentarioId?: string) =>
  `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}${comentarioId ? `&lc=${encodeURIComponent(comentarioId)}` : ""}`;

export const REDIRECT_OAUTH = "https://yjwhhkzqmsouvnryiwde.supabase.co/functions/v1/youtube-oauth";

/** O médico mudou a resposta de verdade (não só espaço ou maiúscula)? A mesma
 *  regra de editou_de_verdade() no banco (0012). */
export function editouDeVerdade(sugestao: string | null | undefined, publicado: string | null | undefined): boolean {
  if (sugestao == null || publicado == null) return false;
  const norma = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return norma(sugestao) !== norma(publicado);
}

// Revisão mais rápida (David, 14/11/26): publicar sem a pergunta de
// confirmação é escolha de quem revisa, guardada só neste navegador. Vale na
// fila e na busca.
export const CHAVE_SEM_CONFIRMAR = "dashmed:youtube:publicar-sem-confirmar";

/** Comentário de quem pediu para apagar os dados (LGPD): a 0018 troca o texto
 *  por esta marca e tira o canal do autor. Não recebe resposta. */
export const foiAnonimizado = (texto: string) => texto.startsWith("[comentário anonimizado");

/** Ordem da fila de respostas (David, 15/11/26: "ordenar por porcentagem de
 *  consulta, porcentagem de cirurgia e parte socioeconômica ... mais recente
 *  ou menos recente"). A primeira é a de sempre. */
export const ORDENS_FILA = [
  { id: "", rotulo: "Urgentes e maior chance primeiro" },
  { id: "recentes", rotulo: "Mais recentes primeiro" },
  { id: "antigos", rotulo: "Mais antigos primeiro" },
  { id: "consulta", rotulo: "Maior % de consulta" },
  { id: "cirurgia", rotulo: "Maior % de cirurgia" },
  { id: "socio", rotulo: "Maior socioeconômica" },
] as const;
export type OrdemFila = (typeof ORDENS_FILA)[number]["id"];
