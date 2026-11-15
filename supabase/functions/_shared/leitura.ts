// Gravar os comentários lidos do YouTube: usado pela varredura e pela busca
// direto no YouTube (15/11/26). Quem pediu para ser anonimizado (LGPD, 0018)
// não volta a ser gravado, venha de onde vier.
import { admin, Falha } from "./base.ts";
import { type ComentarioLido, gastarCota, titulosDosVideos } from "./youtube.ts";

/** sha256 de "cliente:canal", igual a hash_autor_youtube() da 0018. */
export async function hashAutor(clienteId: string, autor: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${clienteId}:${autor}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Quem pediu para ser anonimizado (LGPD, 0018) não volta a ser lido: tira
 *  da lista os comentários de canais em yt_bloqueados. */
export async function semBloqueados<T extends { autor_canal_id: string | null }>(clienteId: string, itens: T[]): Promise<T[]> {
  if (!itens.length) return itens;
  const { data, error } = await admin.from("yt_bloqueados").select("autor_hash").eq("cliente_id", clienteId).limit(10000);
  if (error) throw new Falha(`Não consegui conferir os pedidos de anonimização (${error.message}).`, 500);
  const bloqueados = new Set((data ?? []).map((b) => b.autor_hash as string));
  if (!bloqueados.size) return itens;
  const ficam: T[] = [];
  for (const i of itens) {
    if (i.autor_canal_id && bloqueados.has(await hashAutor(clienteId, i.autor_canal_id))) continue;
    ficam.push(i);
  }
  return ficam;
}

/** Grava os comentários lidos (o mesmo comentário não entra duas vezes). */
export async function gravarLidos(clienteId: string, canalId: string, token: string, itens: ComentarioLido[]): Promise<number> {
  // comentário do próprio canal não é lead
  const deFora = await semBloqueados(clienteId, itens.filter((c) => c.autor_canal_id !== canalId && c.texto.trim()));
  if (!deFora.length) return 0;
  const videos = [...new Set(deFora.map((c) => c.video_id).filter(Boolean))];
  let titulos = new Map<string, string>();
  if (videos.length) {
    await gastarCota(clienteId, Math.ceil(videos.length / 50));
    titulos = await titulosDosVideos(token, videos);
  }
  const linhas = deFora.map((c) => ({ cliente_id: clienteId, canal_id: canalId, ...c, video_titulo: titulos.get(c.video_id) ?? null }));
  const { data, error } = await admin.from("yt_comentarios")
    .upsert(linhas, { onConflict: "cliente_id,thread_id", ignoreDuplicates: true }).select("id");
  if (error) throw new Falha(`Não consegui gravar os comentários lidos (${error.message}).`, 500);
  return data?.length ?? 0;
}

