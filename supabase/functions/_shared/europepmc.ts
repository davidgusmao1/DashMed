// Busca de publicações na Europe PMC (www.ebi.ac.uk/europepmc), que indexa
// todo o PubMed e devolve o resumo em JSON, sem chave. Usamos só registros do
// PubMed (SRC:MED), então toda referência tem PMID verificável.
import { Falha } from "./base.ts";
import { limparResumo, pesoEvidencia } from "./texto.ts";

const URL_BUSCA = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

export type Candidato = {
  pmid: string;
  doi: string | null;
  pmcid: string | null;
  titulo: string;
  autores: string;
  revista: string;
  ano: number | null;
  tipos: string[];
  citacoes: number;
  acesso_aberto: boolean;
  resumo: string;
};

type ResultadoEpmc = {
  pmid?: string;
  doi?: string;
  pmcid?: string;
  title?: string;
  authorString?: string;
  pubYear?: string;
  citedByCount?: number;
  isOpenAccess?: string;
  abstractText?: string;
  journalInfo?: { journal?: { title?: string; medlineAbbreviation?: string } };
  pubTypeList?: { pubType?: string | string[] };
};

export async function buscarEuropePmc(query: string, pageSize: number, ordem: string | null = null): Promise<Candidato[]> {
  const url = new URL(URL_BUSCA);
  url.searchParams.set("query", query);
  url.searchParams.set("resultType", "core");
  url.searchParams.set("format", "json");
  url.searchParams.set("pageSize", String(pageSize));
  if (ordem) url.searchParams.set("sort", ordem);
  let resp: Response;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new Falha(`A Europe PMC não respondeu (${e instanceof Error ? e.message : e}).`, 502);
  }
  if (!resp.ok) throw new Falha(`A Europe PMC recusou a busca (HTTP ${resp.status}).`, 502);
  const dados = await resp.json() as { resultList?: { result?: ResultadoEpmc[] } };
  return (dados.resultList?.result ?? []).filter((r) => r.pmid && r.title).map((r) => {
    const tipos = r.pubTypeList?.pubType;
    return {
      pmid: String(r.pmid),
      doi: r.doi ?? null,
      pmcid: r.pmcid ?? null,
      titulo: r.title!.replace(/\s+/g, " ").trim(),
      autores: (r.authorString ?? "").slice(0, 500),
      revista: r.journalInfo?.journal?.title ?? r.journalInfo?.journal?.medlineAbbreviation ?? "",
      ano: r.pubYear ? Number(r.pubYear) : null,
      tipos: Array.isArray(tipos) ? tipos : tipos ? [tipos] : [],
      citacoes: r.citedByCount ?? 0,
      acesso_aberto: r.isOpenAccess === "Y",
      resumo: limparResumo(r.abstractText),
    };
  });
}

/** Junta os resultados de várias buscas, sem repetir PMID, do estudo mais
 *  forte (e mais citado) para o mais fraco. */
export function juntarCandidatos(listas: Candidato[][], maximo: number): Candidato[] {
  const porPmid = new Map<string, Candidato>();
  for (const lista of listas) for (const c of lista) if (c.resumo && !porPmid.has(c.pmid)) porPmid.set(c.pmid, c);
  return [...porPmid.values()]
    .sort((a, b) => pesoEvidencia(b.tipos) - pesoEvidencia(a.tipos) || b.citacoes - a.citacoes)
    .slice(0, maximo);
}
