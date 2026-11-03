/* La tab Log: registro di tutto quello che passa fra interfaccia e macchina.
 *
 * Tiene in memoria un numero limitato di righe. Un plotter che disegna per
 * mezz'ora produce migliaia di messaggi, e una pagina che li conserva tutti
 * rallenta fino a diventare inusabile proprio mentre serve guardarla. */
var Log = (function () {
  var MAX = 800;
  var lines = [];
  var view, autoscroll;

  function ts() {
    var d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' +
           ('0' + d.getMinutes()).slice(-2) + ':' +
           ('0' + d.getSeconds()).slice(-2);
  }

  /* CHI VUOLE SENTIRE LE RIGHE MENTRE NASCONO.
     Serve alle tab delle stampe: ognuna tiene il registro della SUA stampa,
     e per farlo deve sapere che cosa viene detto mentre lei è quella in
     corso. L'alternativa era che qualcuno avvolgesse `add` da fuori, cioè
     che il registro diventasse un posto in cui due moduli si scavalcano a
     vicenda senza dirselo. */
  var orecchie = [];
  function ascolta(fn) { if (typeof fn === 'function') orecchie.push(fn); }

  function add(kind, text) {
    var riga = { kind: kind, text: text, time: ts() };
    for (var o = 0; o < orecchie.length; o++) {
      /* Un ascoltatore che si rompe non deve portarsi dietro il registro:
         qui dentro passa anche il racconto dei guasti. */
      try { orecchie[o](riga); } catch (e) { /* non è affar suo */ }
    }
    lines.push({ kind: kind, text: text, time: ts() });
    if (lines.length > MAX) lines.splice(0, lines.length - MAX);
    render();
  }

  function visible(kind) {
    var el = document.getElementById(
      kind === 'cmd' ? 'log-f-cmd' : kind === 'err' ? 'log-f-err' : 'log-f-msg');
    return !el || el.checked;
  }

  function render() {
    if (!view) return;
    var html = '';
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (!visible(l.kind)) continue;
      html += '<div class="log-line"><span class="log-time">' + l.time +
              '</span><span class="log-' + l.kind + '">' + escape(l.text) + '</span></div>';
    }
    view.innerHTML = html || '<p class="log-empty">Nessun messaggio.</p>';
    if (autoscroll && autoscroll.checked) view.scrollTop = view.scrollHeight;
  }

  function escape(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
    });
  }

  function init() {
    view = document.getElementById('log-view');
    autoscroll = document.getElementById('log-autoscroll');

    ['log-f-cmd', 'log-f-msg', 'log-f-err'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', render);
    });

    document.getElementById('btn-log-clear').addEventListener('click', function () {
      lines = [];
      render();
    });

    document.getElementById('log-send').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = document.getElementById('log-input');
      var v = input.value.trim();
      if (!v) return;
      /* La console della WebUI di FluidNC, incollando con Ctrl+V, in alcuni
         browser aggiunge una "v" in fondo alla riga: un comando così viene
         rifiutato con error:2 e sembra un guasto. Qui la togliamo. */
      v = v.replace(/([\d.])v$/, '$1');
      Api.send(v);
      input.value = '';
    });

    render();
  }

  return { add: add, init: init, render: render, ascolta: ascolta };
})();
