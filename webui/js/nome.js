/* Dare un nome alle cose: una finestrella sola per livelli e fogli.
 *
 * IL PROBLEMA, detto dall'operatore il 2026-11-08: «la possibilità di
 * rinominare fogli e livelli». I nomi finora li metteva il programma — un
 * livello si chiama come il file e la tinta da cui viene («antei.svg · tratto
 * #1f4fa8»), un foglio come il suo formato («A5», «Personalizzato») — e
 * vanno benissimo finché i livelli sono due. Con nove magneti e diciotto
 * livelli non dicono più niente: «magnete 4.svg · tratto #c8102e» non è
 * «Gioco, scritta rossa», e la differenza la si paga ogni volta che si cerca
 * una riga nell'elenco o si guarda il telecomando che dice «FOGLIO 4/9».
 *
 * PERCHE' UNA FINESTRELLA E NON UNA CASELLA NELLA RIGA. Gli elenchi di questa
 * pagina si ridisegnano interi a ogni modifica — una penna scelta, un occhio
 * spento, un foglio che cambia — e una casella aperta dentro a una riga
 * sparirebbe insieme alla riga, con dentro quello che si stava scrivendo. La
 * finestrella sta fuori dagli elenchi: può ridisegnarsi quanto vuole.
 *
 * IL NOME VUOTO NON E' UN ERRORE: vuol dire «rimettilo com'era», cioè torna
 * al nome che il programma sa dare da sé. Chi rinomina deve poter tornare
 * indietro senza indovinare come si chiamava prima.
 */
var Nome = (function () {

  var MAX = 60;

  /* Chi ha chiesto la finestrella, e che cosa farne della risposta. `null`
     quando è chiusa. */
  var ora = null;

  function el(id) { return document.getElementById(id); }

  /* `d`: { titolo, desc, valore, vuoto, ok }.
     `vuoto` è la scritta del pulsante che rimette il nome automatico — se
     manca, quel pulsante non compare. `ok(nome)` riceve la stringa già
     ripulita, o '' per «rimettilo com'era». */
  function chiedi(d) {
    ora = d;
    el('nome-titolo').textContent = d.titolo || 'Nome';
    el('nome-desc').textContent = d.desc || '';
    el('nome-desc').hidden = !d.desc;
    var c = el('nome-campo');
    c.value = d.valore || '';
    c.maxLength = MAX;
    var v = el('nome-vuoto');
    v.hidden = !d.vuoto;
    v.textContent = d.vuoto || '';
    el('nome-modal').hidden = false;
    c.focus();
    c.select();
  }

  function chiudi() {
    ora = null;
    el('nome-modal').hidden = true;
  }

  /* Gli spazi ai bordi non sono un nome, e due nomi che differiscono solo
     per uno spazio in fondo sono il modo più sicuro di credere che
     l'elenco sia rotto. */
  function pulito(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, MAX);
  }

  function conferma(valore) {
    if (!ora) return;
    var f = ora.ok;
    var n = pulito(valore);
    chiudi();
    if (f) f(n);
  }

  /* IL DOPPIO CLIC CONTATO A MANO, e non è un vezzo: gli elenchi di questa
   * pagina si ridisegnano al PRIMO clic — che sceglie il livello o il foglio
   * — quindi il bottone su cui si è premuto non esiste più quando arriva il
   * secondo, e il browser l'evento `dblclick` non lo manda affatto. Con
   * `addEventListener('dblclick')` la rinomina funzionava solo sulla riga
   * già scelta, cioè proprio nel caso in cui non serve.
   *
   * Due clic sullo stesso bersaglio entro mezzo secondo. Il bersaglio è una
   * stringa qualunque, e chi chiama ci mette un prefisso — 'liv:' o 'fog:' —
   * così un livello e un foglio con lo stesso id non si confondono.
   */
  var ultimo = { chi: null, t: 0 };

  function doppio(chi) {
    var t = Date.now();
    var si = ultimo.chi === chi && (t - ultimo.t) < 450;
    ultimo = si ? { chi: null, t: 0 } : { chi: chi, t: t };
    return si;
  }

  function init() {
    var m = el('nome-modal');
    if (!m) return;
    el('nome-ok').addEventListener('click', function () {
      conferma(el('nome-campo').value);
    });
    el('nome-vuoto').addEventListener('click', function () { conferma(''); });
    el('nome-annulla').addEventListener('click', chiudi);
    m.addEventListener('click', function (e) {
      if (e.target === this) chiudi();          // clic sul fondo scuro
    });
    el('nome-campo').addEventListener('keydown', function (e) {
      /* Invio conferma e Esc lascia stare: in una finestrella con un campo
         solo sono le due risposte, e cercarle col mouse è un gesto in più
         mentre si ha già le mani sulla tastiera. */
      if (e.key === 'Enter') { e.preventDefault(); conferma(this.value); }
      if (e.key === 'Escape') { e.preventDefault(); chiudi(); }
    });
  }

  return { init: init, chiedi: chiedi, chiudi: chiudi, pulito: pulito,
           doppio: doppio, aperta: function () { return !!ora; } };
})();
