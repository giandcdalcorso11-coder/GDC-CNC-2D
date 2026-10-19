/* Generazione del G-code.
 *
 * Le coordinate emesse sono quelle della macchina: origine dove l'hai
 * impostata a mano con G92, asse Y verso l'alto. Il file NON contiene un G92:
 * l'origine la decide l'operatore prima di stampare, e un G92 nel programma
 * la sovrascriverebbe azzerando dove capita.
 */
var Gcode = (function () {

  function n(v) {
    return (Math.round(v * 1000) / 1000).toFixed(3);
  }

  function build(polys, opt) {
    var L = [];
    var zUp = opt.penUp, zDown = opt.penDown;

    /* La pausa dopo ogni su/giù non è un lusso: il servo ci mette un pezzo ad
       arrivare, e senza attesa la macchina riparte mentre la penna sta ancora
       scendendo — a 50 mm/s si sbavano quattro millimetri di tratto. Il numero
       sta nel profilo di stampa. */
    var attesa = opt.pausaMs > 0 ? 'G4 P' + (opt.pausaMs / 1000).toFixed(3) : null;

    L.push('; GDC CNC 2D SLICER');
    L.push('; ' + polys.length + ' tratti, generato dall\'interfaccia');
    L.push('; penna alzata Z' + n(zUp) + ', abbassata Z' + n(zDown) +
           (opt.pennaTarata ? '' : ' - DA TARARE'));
    L.push('G21');            // millimetri
    L.push('G90');            // coordinate assolute
    L.push('G0 Z' + n(zUp));  // si parte a penna alzata, sempre

    for (var i = 0; i < polys.length; i++) {
      var p = polys[i];
      L.push('G0 X' + n(p[0].x) + ' Y' + n(p[0].y) + ' F' + opt.feedTravel);
      L.push('G1 Z' + n(zDown) + ' F' + opt.feedPen);
      if (attesa) L.push(attesa);
      for (var j = 1; j < p.length; j++) {
        L.push('G1 X' + n(p[j].x) + ' Y' + n(p[j].y) +
               (j === 1 ? ' F' + opt.feedDraw : ''));
      }
      L.push('G0 Z' + n(zUp));
      if (attesa) L.push(attesa);
    }

    L.push('G0 X0 Y0 F' + opt.feedTravel);
    L.push('M2');             // fine programma
    return L.join('\n') + '\n';
  }

  function durata(sec) {
    var m = Math.floor(sec / 60), s = Math.round(sec % 60);
    if (m < 60) return m + ' min ' + ('0' + s).slice(-2) + ' s';
    return Math.floor(m / 60) + ' h ' + ('0' + (m % 60)).slice(-2) + ' min';
  }

  return { build: build, durata: durata };
})();
