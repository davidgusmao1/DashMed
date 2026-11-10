"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function DefinirSenha() {
  const [senha, setSenha] = useState("");
  const [repetida, setRepetida] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (senha.length < 8) return setMsg({ ok: false, texto: "A senha precisa ter pelo menos 8 caracteres." });
    if (senha !== repetida) return setMsg({ ok: false, texto: "As duas senhas não são iguais." });
    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setSalvando(false);
    if (error) {
      setMsg({ ok: false, texto: /different from the old|same/i.test(error.message) ? "Essa já é a sua senha." : /weak|pwned|leaked/i.test(error.message) ? "Senha fraca demais — escolha outra." : error.message });
      return;
    }
    setSenha(""); setRepetida("");
    setMsg({ ok: true, texto: "Senha salva. Nas próximas vezes você pode entrar com o e-mail e esta senha." });
  }

  return (
    <form onSubmit={salvar} className="cartao space-y-4 p-6">
      <div className="text-sm font-semibold">Senha de acesso</div>
      <div>
        <label className="rotulo" htmlFor="senha">Nova senha</label>
        <input id="senha" type="password" autoComplete="new-password" required className="campo" value={senha} onChange={(e) => setSenha(e.target.value)} />
      </div>
      <div>
        <label className="rotulo" htmlFor="repetida">Repita a senha</label>
        <input id="repetida" type="password" autoComplete="new-password" required className="campo" value={repetida} onChange={(e) => setRepetida(e.target.value)} />
      </div>
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-teal-50 text-teal-900" : "bg-zinc-100 text-zinc-900"}`}>{msg.texto}</p>}
      <button className="botao" disabled={salvando}>{salvando ? "Salvando…" : "Salvar senha"}</button>
    </form>
  );
}
