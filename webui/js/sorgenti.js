/* Dove trovare disegni: un elenco di collegamenti che cresce.
 *
 * E il pulsante «Crea / Edit», che sta qui perché è la stessa domanda — da
 * dove arriva il disegno — vista da due parti: o lo si prende fuori, o lo si
 * fa dentro.
 *
 * PERCHÉ NON NEL PROFILO. Il profilo descrive la macchina: corse, angoli del
 * servo, rapporto. È la cosa che si esporta e si rimette su un altro
 * computer, e un segnalibro non c'entra niente con una taratura. Sta in una
 * chiave sua, come le larghezze delle colonne.
 */
var Sorgenti = (function () {

  var KEY = 'gdc.cnc2d.sorgenti';

  /* Il primo ce lo mettiamo noi: l'operatore l'ha trovato e vale per tutti.
     Gli altri li aggiunge lui. */
  var DI_SERIE = [
    { url: 'https://bookofshapes.com/?sort=popular', nome: 'Book of Shapes' }
  ];

  var elenco = [];

  function carica() {
    try {
      var raw = window.localStorage.getItem(KEY);
      elenco = raw ? JSON.parse(raw) : DI_SERIE.slice();
    } catch (e) {
      elenco = DI_SERIE.slice();
    }
    if (!Array.isArray(elenco)) elenco = DI_SERIE.slice();
  }

  function salva() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(elenco));
    } catch (e) { /* finestra anonima: l'elenco vive finché vive la pagina */ }
  }

  /* Il nome lo fa l'indirizzo: «bookofshapes.com» si legge, l'URL intero no.
     Via il `www.`, che non distingue niente da niente. */
  function nomeDa(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return url;
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  function render() {
    var ul = document.getElementById('sorgenti-lista');
    if (!ul) return;
    if (!elenco.length) {
      ul.innerHTML = '<li class="sorgenti-vuoto">Nessun collegamento. ' +
                     'Incollane uno qui sotto.</li>';
      return;
    }
    var h = '';
    for (var i = 0; i < elenco.length; i++) {
      var s = elenco[i];
      /* `rel="noreferrer"` non è formalità: apre una pagina esterna da
         un'interfaccia che comanda una macchina, e quella pagina non ha
         nessun motivo di sapere da dove arriva né di poter toccare questa. */
      h += '<li class="sorgente">' +
           '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer" ' +
           'title="' + esc(s.url) + '">' + esc(s.nome) + '</a>' +
           '<button class="mini mini-del" data-sorg-del="' + i +
           '" title="Togli questo collegamento" aria-label="Togli">&times;</button>' +
           '</li>';
    }
    ul.innerHTML = h;
  }

  function aggiungi(url) {
    url = String(url).trim();
    if (!url) return false;
    /* Senza schema il browser lo leggerebbe come percorso relativo e
       aprirebbe una pagina del programma invece del sito. */
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try {
      new URL(url);
    } catch (e) {
      Log.add('err', 'Non sembra un indirizzo: ' + url);
      return false;
    }
    for (var i = 0; i < elenco.length; i++) {
      if (elenco[i].url === url) {
        Log.add('msg', 'Quel collegamento c\'è già.');
        return false;
      }
    }
    elenco.push({ url: url, nome: nomeDa(url) });
    salva();
    render();
    return true;
  }

  function togli(i) {
    if (i < 0 || i >= elenco.length) return;
    var s = elenco[i];
    if (!window.confirm('Tolgo il collegamento a ' + s.nome + '?')) return;
    elenco.splice(i, 1);
    salva();
    render();
  }

  /* ------------------------ il pulsante Crea / Edit ----------------------- */

  function aggiornaPulsante() {
    var b = document.getElementById('btn-editor');
    if (!b) return;
    /* «Edit» quando c'è un LIVELLO scelto, non quando c'è un disegno
       qualsiasi: l'editor lavora su uno per volta, ed è quello che si apre. */
    var l = (window.Artwork && Artwork.livelli)
      ? Artwork.livelli().filter(function (x) { return x.scelto; })[0] : null;
    b.textContent = l ? 'Edit' : 'Crea';
    b.title = l
      ? 'Apri «' + l.nome + '» nell\'editor'
      : 'Comincia un disegno nuovo';
  }

  function init() {
    carica();
    render();

    var ul = document.getElementById('sorgenti-lista');
    if (ul) {
      ul.addEventListener('click', function (e) {
        var d = e.target.closest('[data-sorg-del]');
        if (d) { e.preventDefault(); togli(+d.dataset.sorgDel); }
      });
    }

    var form = document.getElementById('sorgenti-add');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var inp = document.getElementById('sorgenti-url');
        if (aggiungi(inp.value)) inp.value = '';
      });
    }

    var b = document.getElementById('btn-editor');
    if (b) {
      b.addEventListener('click', function () {
        var t = document.querySelector('.tab[data-tab="editor"]');
        if (t) t.click();
      });
    }

    State.on('path', aggiornaPulsante);
    aggiornaPulsante();
  }

  return { init: init, aggiungi: aggiungi, elenco: function () { return elenco; } };
})();
