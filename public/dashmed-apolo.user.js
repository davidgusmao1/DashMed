// ==UserScript==
// @name         DashMed → abrir ficha no Apolo Ninsaúde
// @namespace    https://dashmed-app.vercel.app
// @version      1.0.0
// @description  O botão "Abrir ficha no Apolo Ninsaúde" da DashMed abre aqui a ficha do paciente.
// @match        https://apolo.ninsaude.com/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://dashmed-app.vercel.app/dashmed-apolo.user.js
// @updateURL    https://dashmed-app.vercel.app/dashmed-apolo.user.js
// ==/UserScript==

// Por que existe (David, 12/11/26): o Apolo não tem link que abra a ficha de
// um paciente de fora — a ficha só abre pela função interna
// openWin({viewName: "cadastro_paciente", urlParam: {id}}). A DashMed abre
// https://apolo.ninsaude.com/inicial/#dashmed-paciente=<código do Apolo> e
// este script chama essa função. Sem código, vem #dashmed-telefone=<número>:
// o script abre a lista de Pacientes já buscando esse telefone.
//
// O script não lê, não grava e não envia nenhum dado: só abre a tela.
(function () {
  "use strict";
  var CHAVE = "dashmed-apolo-pedido";

  function lerPedido() {
    var m = location.hash.match(/dashmed-(paciente|telefone)=(\d{1,15})/);
    if (m) {
      // tira o pedido do endereço (e do histórico): clicar de novo no mesmo
      // paciente volta a funcionar
      history.replaceState(null, "", location.pathname + location.search);
      return { tipo: m[1], valor: m[2] };
    }
    try {
      var guardado = JSON.parse(sessionStorage.getItem(CHAVE) || "null");
      sessionStorage.removeItem(CHAVE);
      return guardado;
    } catch (e) {
      return null;
    }
  }

  function esperar(teste, ms, depois) {
    var fim = Date.now() + ms;
    (function tentar() {
      var r = null;
      try { r = teste(); } catch (e) { r = null; }
      if (r) return depois(r);
      if (Date.now() < fim) setTimeout(tentar, 250);
    })();
  }

  function abrirPorCodigo(abrir, codigo) {
    abrir({ viewName: "cadastro_paciente", urlParam: { id: codigo } });
  }

  function abrirPorTelefone(abrir, telefone) {
    abrir({ viewName: "cadastro_paciente" });
    esperar(function () {
      var f = document.querySelector("iframe[data-view='cadastro_paciente']");
      var w = f && f.contentWindow;
      var d = f && f.contentDocument;
      return w && w.$ && d && d.getElementById("txtListarFiltro") && d.getElementById("formListar") ? { w: w, d: d } : null;
    }, 15000, function (t) {
      t.d.getElementById("txtListarFiltro").value = telefone;
      t.w.$("#formListar").trigger("submit");
      // um paciente só com esse telefone: abre a ficha; mais de um: fica a lista
      esperar(function () {
        var achados = t.d.querySelectorAll("#divListarPaciente a[data-id]");
        return achados.length ? achados : null;
      }, 10000, function (achados) {
        if (achados.length === 1) t.w.$(achados[0]).trigger("click");
      });
    });
  }

  function atender(pedido) {
    if (!pedido) return;
    if (location.pathname.indexOf("/inicial") !== 0) {
      // ainda no login: guarda o pedido para depois de entrar
      try { sessionStorage.setItem(CHAVE, JSON.stringify(pedido)); } catch (e) { /* sem storage */ }
      return;
    }
    esperar(function () { return typeof window.openWin === "function" ? window.openWin : null; }, 20000, function (abrir) {
      if (pedido.tipo === "paciente") abrirPorCodigo(abrir, pedido.valor);
      else abrirPorTelefone(abrir, pedido.valor);
    });
  }

  atender(lerPedido());
  // a DashMed reaproveita a mesma aba do Apolo: só o # muda, sem recarregar
  window.addEventListener("hashchange", function () { atender(lerPedido()); });
})();
