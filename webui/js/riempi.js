/* I RIEMPIMENTI: riconoscere gli spazi chiusi, e coprirli di tratti.
 *
 * UNA PENNA NON RIEMPIE. Copre, passando tante volte vicino a se stessa, e
 * questo modulo fa due cose distinte:
 *
 *   1. LO STAMPINO. Tutti i tratti visibili di un foglio si disegnano una
 *      volta su una tela fuori schermo a un decimo di millimetro per pixel,
 *      con gli spessori veri delle penne, e tutte le regioni chiuse si
 *      etichettano in un colpo solo. Da quel momento «che regione c'e' sotto
 *      il puntatore» e' una lettura, non un calcolo: il mouse puo' anticipare
 *      il riempimento senza che la pagina faccia fatica a ogni movimento.
 *   2. IL TRATTEGGIO di UNA regione, nei tipi che la penna sa fare.
 *
 * PERCHE' A PIXEL E NON CON LA GEOMETRIA. Un algoritmo esatto su poligoni
 * deve prima decidere che cosa e' chiuso, e nei file veri non lo e' quasi
 * mai: un contorno esportato da un disegno ha capi che si toccano a meno di
 * un centesimo, tratti di livelli diversi che fanno da confine insieme,
 * forme che si auto-intersecano. Lo stampino non deve deciderlo: una regione
 * e' quello che l'inchiostro circonda, comunque sia fatto l'inchiostro, e di
 * quali livelli sia.
 *
 * UN DECIMO DI MILLIMETRO BASTA, e l'errore si nasconde sotto l'inchiostro.
 * Sono tre passi di motore e un quarto della punta di una penna; e i capi
 * del tratteggio devono COMUNQUE infilarsi sotto il contorno di un paio di
 * decimi, se no fra riempimento e bordo resta una riga bianca. Quindi
 * l'imprecisione dello stampino finisce dove non si vede, per costruzione.
 *
 * COME SI ROMPE: LA FESSURA. Un contorno che sembra chiuso e non lo e' fa
 * scappare il riempimento su tutto il foglio. Ci sono due difese, e servono
 * tutt'e due: la TOLLERANZA DI CHIUSURA, che ingrassa i tratti *solo* dentro
 * lo stampino e tappa i buchi fino a quella misura, e il GUARDIANO -- una
 * regione che tocca il bordo del foglio non si riempie, si dice che e'
 * scappata e si dice DOVE. Un guasto che si annuncia invece di un foglio
 * allagato.
 *
 * Questo modulo non sa niente dell'interfaccia e non tocca lo stato: gli si
 * danno dei tratti, restituisce delle regioni e dei segmenti. E' anche il
 * motivo per cui si puo' provare al banco con una forma inventata a mano,
 * senza passare da un file.
 */
var Riempi = (function () {

  /* Un decimo di millimetro per pixel. Un A4 intero sono 2100 × 2970 pixel,
     cioe' sei milioni di celle: un Int32Array da 25 MB, un etichettamento in
     una frazione di secondo, e una volta sola. */
  var MM_PER_PX = 0.1;

  /* Lo spessore di chi non l'ha dichiarato. Un livello senza penna scelta si
     disegna col tratto sottile di sempre, e lo stampino deve usare lo stesso
     numero: se qui fosse piu' grosso, due tratti vicini si toccherebbero
     nello stampino e non sulla carta -- cioe' il programma vedrebbe chiuso
     un contorno che la penna lascia aperto. */
  var TRATTO = 0.4;

  /* Quanto i capi del tratteggio si infilano sotto il contorno. Due decimi:
     piu' dell'errore dello stampino (un decimo) e meno di quanto si veda
     sporgere da una forma. */
  var SOTTO = 0.2;

  /* ------------------------------- lo stampino --------------------------- */

  /* `dati` = { w, h, tratti: [ { punti: [{x,y}...], larghezza: mm } ] },
     in millimetri del FOGLIO: l'angolo in basso a sinistra del foglio e'
     l'origine, e la y cresce verso l'alto come su tutto il piano.
     `opt.tolleranza` ingrassa ogni tratto di quel tanto PER PARTE, solo qui
     dentro: e' la tolleranza di chiusura. */
  function stampino(dati, opt) {
    opt = opt || {};
    var tol = +opt.tolleranza || 0;
    var mmPerPx = +opt.mmPerPx || MM_PER_PX;

    var W = Math.max(1, Math.ceil(dati.w / mmPerPx));
    var H = Math.max(1, Math.ceil(dati.h / mmPerPx));

    var tela = document.createElement('canvas');
    tela.width = W; tela.height = H;
    var g = tela.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#000';
    g.lineCap = 'round';
    g.lineJoin = 'round';

    var off = dati.off || { x: 0, y: 0 };
    for (var i = 0; i < dati.tratti.length; i++) {
      var t = dati.tratti[i];
      if (!t.punti || t.punti.length < 2) continue;
      g.lineWidth = ((+t.larghezza || TRATTO) + 2 * tol) / mmPerPx;
      g.beginPath();
      for (var j = 0; j < t.punti.length; j++) {
        var p = aPixel({ x: t.punti[j].x - off.x, y: t.punti[j].y - off.y },
                       mmPerPx, H);
        if (j === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
      }
      g.stroke();
    }

    var px = g.getImageData(0, 0, W, H).data;

    /* 0 = inchiostro. Da 1 in su, una regione. Si etichetta tutto in una
       passata sola, con una pila esplicita invece della ricorsione: su un A4
       una regione grande e' mezzo milione di celle, e la ricorsione
       finirebbe la pila di chiamate molto prima. */
    var lab = new Int32Array(W * H);
    var inchiostro = new Uint8Array(W * H);
    for (var k = 0; k < W * H; k++) {
      /* Soglia alta: l'antialiasing dei bordi del tratto e' inchiostro
         anche lui. Un mezzo pixel grigio e' meta' punta di penna. */
      inchiostro[k] = px[k * 4] < 200 ? 1 : 0;
    }

    var nreg = 0;
    var tocca = [false];          // per etichetta: tocca il bordo del foglio?
    var pila = new Int32Array(W * H);
    for (var s = 0; s < W * H; s++) {
      if (inchiostro[s] || lab[s]) continue;
      nreg++;
      tocca.push(false);
      var cima = 0;
      pila[cima++] = s;
      lab[s] = nreg;
      while (cima > 0) {
        var c = pila[--cima];
        var cx = c % W, cy = (c - cx) / W;
        if (cx === 0 || cy === 0 || cx === W - 1 || cy === H - 1) tocca[nreg] = true;
        /* I quattro vicini scritti per esteso invece che in una funzione:
           una funzione dichiarata dentro al ciclo chiuderebbe sulla pila di
           questo giro, e sarebbe una trappola per chi la legge dopo. */
        if (cx > 0 && !inchiostro[c - 1] && !lab[c - 1]) {
          lab[c - 1] = nreg; pila[cima++] = c - 1;
        }
        if (cx < W - 1 && !inchiostro[c + 1] && !lab[c + 1]) {
          lab[c + 1] = nreg; pila[cima++] = c + 1;
        }
        if (cy > 0 && !inchiostro[c - W] && !lab[c - W]) {
          lab[c - W] = nreg; pila[cima++] = c - W;
        }
        if (cy < H - 1 && !inchiostro[c + W] && !lab[c + W]) {
          lab[c + W] = nreg; pila[cima++] = c + W;
        }
      }
    }

    return { W: W, H: H, mmPerPx: mmPerPx, lab: lab, regioni: nreg,
             tocca: tocca, w: dati.w, h: dati.h, tolleranza: tol,
             off: dati.off || { x: 0, y: 0 } };
  }

  function aPixel(p, mmPerPx, H) {
    /* La y si ribalta: sul foglio cresce verso l'alto, sulla tela verso il
       basso. Scritto qui una volta sola, perche' sbagliarlo vuol dire
       riempire la regione specchiata e accorgersene solo guardando. */
    return { x: p.x / mmPerPx, y: H - p.y / mmPerPx };
  }

  function indice(st, p) {
    var x = Math.floor((p.x - st.off.x) / st.mmPerPx);
    var y = Math.floor(st.H - (p.y - st.off.y) / st.mmPerPx);
    if (x < 0 || y < 0 || x >= st.W || y >= st.H) return -1;
    return y * st.W + x;
  }

  /* Che regione c'e' sotto questo punto: 0 se c'e' inchiostro, -1 se si e'
     fuori dal foglio. E' una lettura, e per questo l'anteprima sotto il
     mouse non costa niente. */
  function regioneIn(st, p) {
    var i = indice(st, p);
    return i < 0 ? -1 : st.lab[i];
  }

  /* IL GUARDIANO. Una regione che tocca il bordo del foglio non e' uno
     spazio chiuso: o e' il fuori del disegno, o il contorno ha una fessura e
     il riempimento e' gia' scappato. In tutt'e due i casi non si riempie. */
  function scappata(st, reg) { return !(reg > 0) || !!st.tocca[reg]; }

  /* DOVE E' SCAPPATA: il primo punto in cui quella regione tocca il bordo del
     foglio. Dirlo e' meta' del lavoro -- «il contorno ha una fessura» senza
     un posto dove guardare lascia l'utente a cercarla a occhio su un A4. */
  function fuga(st, reg) {
    for (var x = 0; x < st.W; x++) {
      if (st.lab[x] === reg) return aMm(st, x, 0);
      if (st.lab[(st.H - 1) * st.W + x] === reg) return aMm(st, x, st.H - 1);
    }
    for (var y = 0; y < st.H; y++) {
      if (st.lab[y * st.W] === reg) return aMm(st, 0, y);
      if (st.lab[y * st.W + st.W - 1] === reg) return aMm(st, st.W - 1, y);
    }
    return null;
  }

  function aMm(st, x, y) {
    return { x: st.off.x + (x + 0.5) * st.mmPerPx,
             y: st.off.y + (st.H - y - 0.5) * st.mmPerPx };
  }

  /* ------------------------------ il tratteggio -------------------------- */

  /* Righe parallele a `angolo`, distanti `passo`, tagliate sulla regione.
     Il passo NON e' un numero libero: nasce dallo spessore del tratto della
     penna -- passo uguale allo spessore vuol dire copertura piena, passo
     maggiore vuol dire trama che si vede. Chi chiama lo calcola da li', qui
     arriva in millimetri.

     `tipo`: 'tratteggio' (righe staccate) o 'serpentina' (le stesse righe
     unite ai capi dove si puo'). La serpentina non e' un vezzo: ogni alzata
     di penna costa circa mezzo secondo, e in questo progetto il criterio
     dell'ottimizzazione e' il TEMPO, non la distanza. Su una forma grande e'
     la differenza fra un minuto e dieci. */
  function tratteggia(st, reg, par) {
    par = par || {};
    var passo = Math.max(st.mmPerPx, +par.passo || 1);
    var ang = (+par.angolo || 0) * Math.PI / 180;
    var sotto = par.sotto === undefined ? SOTTO : +par.sotto;
    var serpentina = par.tipo === 'serpentina';

    if (scappata(st, reg)) {
      return { polilinee: [], metri: 0, alzate: 0, scappata: true,
               dove: fuga(st, reg) };
    }

    var ux = Math.cos(ang), uy = Math.sin(ang);     // lungo la riga
    var vx = -uy, vy = ux;                          // da una riga all'altra

    /* L'estensione delle righe si prende dai quattro angoli del foglio
       proiettati sui due assi: la regione ci sta dentro per forza, e costa
       meno che cercarne il contorno. */
    var o = st.off;
    var ang4 = [{ x: o.x, y: o.y }, { x: o.x + st.w, y: o.y },
                { x: o.x, y: o.y + st.h }, { x: o.x + st.w, y: o.y + st.h }];
    var tmin = Infinity, tmax = -Infinity, smin = Infinity, smax = -Infinity;
    for (var i = 0; i < 4; i++) {
      var t = ang4[i].x * vx + ang4[i].y * vy;
      var s = ang4[i].x * ux + ang4[i].y * uy;
      if (t < tmin) tmin = t; if (t > tmax) tmax = t;
      if (s < smin) smin = s; if (s > smax) smax = s;
    }

    var campione = st.mmPerPx;          // si assaggia la riga un pixel alla volta
    var righe = [];
    for (var tt = tmin; tt <= tmax; tt += passo) {
      var corse = [], dentro = false, p0 = null, ultimo = null;
      for (var ss = smin; ss <= smax; ss += campione) {
        var p = { x: ux * ss + vx * tt, y: uy * ss + vy * tt };
        var qui = regioneIn(st, p) === reg;
        if (qui && !dentro) { p0 = p; dentro = true; }
        else if (!qui && dentro) { corse.push([p0, ultimo]); dentro = false; }
        if (qui) ultimo = p;
      }
      if (dentro) corse.push([p0, ultimo]);
      if (corse.length) righe.push(corse);
    }

    /* SERPENTINA: si unisce il capo di una riga al capo della riga dopo, ma
       SOLO se il collegamento resta dentro alla regione. Unire alla cieca
       vorrebbe dire attraversare il buco di una ciambella con la penna
       abbassata, che e' esattamente il difetto che il riempimento deve non
       avere. Per questo il controllo c'e' anche quando la forma sembra
       semplice: «sembra» lo decide chi guarda, non il programma. */
    var out = [];
    var corrente = null;
    var verso = 1;
    for (var r = 0; r < righe.length; r++) {
      var corse2 = righe[r].slice();
      if (verso < 0) {
        corse2.reverse();
        for (var q = 0; q < corse2.length; q++) corse2[q] = [corse2[q][1], corse2[q][0]];
      }
      verso = -verso;
      for (var c = 0; c < corse2.length; c++) {
        var a = corse2[c][0], b = corse2[c][1];
        if (serpentina && corrente &&
            dirittoDentro(st, reg, corrente[corrente.length - 1], a)) {
          corrente.push(a, b);
        } else {
          if (corrente) out.push(corrente);
          corrente = [a, b];
        }
      }
    }
    if (corrente) out.push(corrente);

    /* I CAPI SI INFILANO SOTTO IL CONTORNO. Senza, fra l'ultimo tratto del
       riempimento e il bordo resta una riga bianca larga mezzo passo: si
       vede, ed e' la prima cosa che si nota in una forma riempita. */
    for (var o = 0; o < out.length; o++) allunga(out[o], sotto);

    var metri = 0;
    for (var m = 0; m < out.length; m++) metri += lunghezza(out[m]);
    return { polilinee: out, metri: metri / 1000, alzate: out.length,
             scappata: false, dove: null };
  }

  /* Il collegamento fra due capi resta dentro alla regione? Si assaggia, con
     lo stesso passo dello stampino. */
  function dirittoDentro(st, reg, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (!d) return true;
    var n = Math.ceil(d / st.mmPerPx);
    for (var i = 0; i <= n; i++) {
      var p = { x: a.x + dx * i / n, y: a.y + dy * i / n };
      if (regioneIn(st, p) !== reg) return false;
    }
    return true;
  }

  function allunga(poli, quanto) {
    if (!quanto || poli.length < 2) return;
    estendi(poli[0], poli[1], quanto);
    estendi(poli[poli.length - 1], poli[poli.length - 2], quanto);
  }

  function estendi(capo, verso, quanto) {
    var dx = capo.x - verso.x, dy = capo.y - verso.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (!d) return;
    capo.x += dx / d * quanto;
    capo.y += dy / d * quanto;
  }

  function lunghezza(poli) {
    var L = 0;
    for (var i = 1; i < poli.length; i++) {
      var dx = poli[i].x - poli[i - 1].x, dy = poli[i].y - poli[i - 1].y;
      L += Math.sqrt(dx * dx + dy * dy);
    }
    return L;
  }

  /* LO STAMPINO ATTORNO A QUELLO CHE C'E'.
     Nell'editor non si lavora in millimetri del foglio ma nelle unita' del
     file, e il foglio non si sa nemmeno dove sia: l'argine allora e'
     l'ingombro di quello che c'e' disegnato, piu' un margine. Una regione
     che arriva fin li' e' scappata lo stesso -- il guardiano non cambia
     mestiere, cambia solo quale bordo guarda. Il margine serve perche'
     senza, il fuori del disegno tocca i tratti e diventerebbe una regione
     attaccata a loro invece che una cornice tutt'attorno. */
  function perTratti(tratti, opt) {
    opt = opt || {};
    var m = opt.margine === undefined ? 2 : +opt.margine;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < tratti.length; i++) {
      var pt = tratti[i].punti || [];
      for (var j = 0; j < pt.length; j++) {
        if (pt[j].x < x0) x0 = pt[j].x;
        if (pt[j].x > x1) x1 = pt[j].x;
        if (pt[j].y < y0) y0 = pt[j].y;
        if (pt[j].y > y1) y1 = pt[j].y;
      }
    }
    if (!isFinite(x0)) return null;
    return stampino({ w: (x1 - x0) + 2 * m, h: (y1 - y0) + 2 * m,
                      off: { x: x0 - m, y: y0 - m }, tratti: tratti }, opt);
  }

  /* --------------------- i tratti di un foglio, come stanno -------------- */

  /* Raccoglie dal programma quello che lo stampino vuole: i tratti VISIBILI
     di quel foglio, con lo spessore della penna di ciascun livello. Griglia
     e magneti non ci sono -- non sono inchiostro, e se lo fossero si
     riempirebbero i quadretti. */
  function tratteggiDelFoglio(foglioId) {
    var art = (window.State && State.data.art) || [];
    var di = (window.State && State.data.artDi) || [];
    var fo = (window.State && State.data.artFoglio) || [];
    var sp = {};
    if (window.Artwork && Artwork.livelli) {
      Artwork.livelli().forEach(function (l) { sp[l.id] = l.spessore || TRATTO; });
    }
    var out = [];
    for (var i = 0; i < art.length; i++) {
      if (foglioId && fo[i] !== foglioId) continue;
      out.push({ punti: art[i], larghezza: sp[di[i]] || TRATTO });
    }
    return out;
  }

  function dalFoglio(foglioId, opt) {
    var f = window.Fogli && Fogli.trova ? Fogli.trova(foglioId) : null;
    if (!f) return null;
    return stampino({ w: f.w, h: f.h, tratti: tratteggiDelFoglio(foglioId) }, opt);
  }

  return { stampino: stampino, dalFoglio: dalFoglio, perTratti: perTratti,
           regioneIn: regioneIn, scappata: scappata, fuga: fuga,
           tratteggia: tratteggia,
           MM_PER_PX: MM_PER_PX, TRATTO: TRATTO, SOTTO: SOTTO };
})();
