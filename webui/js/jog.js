/* Pausa e interruzione di un programma in corso.
 *
 * Il movimento manuale, l'origine e la penna stanno in js/panel.js: sono un
 * componente solo, montato in più posti, perché due copie dello stesso
 * pannello prima o poi divergono. Qui restano i due comandi che riguardano un
 * programma in corso, non il movimento a mano.
 *
 * I due pulsanti NON mandano più comandi crudi alla macchina. Un `!` sparato
 * mentre il Sender continua ad alimentare metterebbe la macchina in feed hold
 * lasciando però la coda che si riempie, e un reset butterebbe via il `G92`
 * insieme al disegno — cioè l'origine presa a mano, che costa una procedura
 * intera rifare. Passano dal Sender, che sa se c'è una stampa e come fermarla
 * senza perdere il riferimento. */
var Jog = (function () {

  function init() {
    document.getElementById('btn-abort').addEventListener('click', function () {
      Sender.interrompi();
    });

    document.getElementById('btn-pause').addEventListener('click', function () {
      var st = Sender.stato();
      /* Riprendere da un CAMBIO PENNA non è riprendere da una pausa: in
         mezzo c'è una penna diversa, che non sporge dai morsetti quanto
         quella di prima, e le quote del G-code che resta sono quelle di
         prima. Si passa dal popup che rimisura. */
      if (st === 'cambio') Popup.cambioPenna();
      else if (st === 'pausa') Sender.riprendi();
      else Sender.pausa();
    });
  }

  return { init: init };
})();
