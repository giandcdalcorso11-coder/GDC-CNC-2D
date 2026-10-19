/* Pausa e interruzione dell'esecuzione.
 *
 * Il movimento manuale, l'origine e la penna stanno in js/panel.js: sono un
 * componente solo, montato in più posti, perché due copie dello stesso
 * pannello prima o poi divergono. Qui restano i due comandi che riguardano un
 * programma in corso, non il movimento a mano. */
var Jog = (function () {

  function init() {
    document.getElementById('btn-abort').addEventListener('click', function () {
      Api.reset();
    });
    document.getElementById('btn-pause').addEventListener('click', function () {
      Api.feedHold();
    });
  }

  return { init: init };
})();
