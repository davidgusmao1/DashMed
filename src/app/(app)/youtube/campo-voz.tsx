"use client";

// Campo de texto com ditado por voz (David, 12/11/26: "abrir uma janela e eu
// poder gravar com voz, e aí aparece a escrita"). Usa o reconhecimento de fala
// do próprio navegador (Web Speech API, em português), sem chave nem custo; o
// texto aparece enquanto ele fala e pode ser corrigido antes de salvar. No
// Chrome o áudio é transcrito pelo serviço de voz do Google.
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

type Resultado = { isFinal: boolean; 0: { transcript: string } };
type EventoFala = { resultIndex: number; results: ArrayLike<Resultado> };
type Reconhecedor = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: EventoFala) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function criarReconhecedor(): Reconhecedor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Reconhecedor; webkitSpeechRecognition?: new () => Reconhecedor };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

const ERROS: Record<string, string> = {
  "not-allowed": "O navegador não deixou usar o microfone. Permita o microfone para este site (ícone ao lado do endereço) e tente de novo.",
  "service-not-allowed": "O navegador não deixou usar o reconhecimento de voz.",
  "no-speech": "Não ouvi nada. Clique no microfone e fale de novo.",
  "audio-capture": "Nenhum microfone encontrado.",
  network: "Sem conexão com o serviço de voz. Tente de novo ou escreva.",
};

export default function CampoVoz({ valor, aoMudar, aoUsarVoz, placeholder, linhas = 5, id }: {
  valor: string;
  aoMudar: (v: string) => void;
  aoUsarVoz?: () => void;
  placeholder?: string;
  linhas?: number;
  id?: string;
}) {
  const [gravando, setGravando] = useState(false);
  const [parcial, setParcial] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [suportado, setSuportado] = useState(true);
  const rec = useRef<Reconhecedor | null>(null);
  const base = useRef(valor);

  useEffect(() => {
    setSuportado(!!criarReconhecedor());
    return () => rec.current?.stop();
  }, []);

  function comecar() {
    const r = criarReconhecedor();
    if (!r) return setSuportado(false);
    setErro(null);
    base.current = valor.trim() ? valor.trim() + " " : "";
    r.lang = "pt-BR";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let final = "";
      let meio = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else meio += t;
      }
      if (final) {
        base.current = (base.current + final.trim() + " ").replace(/\s+/g, " ");
        aoMudar(base.current.trimEnd());
      }
      setParcial(meio);
    };
    r.onerror = (e) => setErro(ERROS[e.error] ?? `O reconhecimento de voz parou (${e.error}).`);
    r.onend = () => { setGravando(false); setParcial(""); };
    rec.current = r;
    r.start();
    setGravando(true);
    aoUsarVoz?.();
  }

  function parar() {
    rec.current?.stop();
    setGravando(false);
  }

  return (
    <div className="space-y-2">
      <textarea id={id} className="campo leading-relaxed" rows={linhas} placeholder={placeholder}
        value={gravando && parcial ? `${valor}${valor ? " " : ""}${parcial}` : valor}
        onChange={(e) => { if (!gravando) aoMudar(e.target.value); }} readOnly={gravando} />
      <div className="flex flex-wrap items-center gap-2">
        {suportado ? (
          gravando ? (
            <button type="button" className="botao" onClick={parar}><Square size={14} /> Parar de gravar</button>
          ) : (
            <button type="button" className="botao-claro" onClick={comecar}><Mic size={14} /> Falar em vez de escrever</button>
          )
        ) : (
          <span className="text-xs text-zinc-500">Este navegador não tem ditado por voz; use o Chrome ou escreva.</span>
        )}
        {gravando && <span className="flex items-center gap-1.5 text-xs text-zinc-600"><span className="size-2 animate-pulse rounded-full bg-zinc-900" /> ouvindo… fale normalmente; o texto aparece aqui</span>}
      </div>
      {erro && <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm">{erro}</p>}
    </div>
  );
}
