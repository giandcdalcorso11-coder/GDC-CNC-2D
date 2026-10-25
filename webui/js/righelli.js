/* I righelli attorno al piano, e dov'è il mouse.
 *
 * Lo zero dei righelli è lo zero della macchina — l'angolo dei blocchi — non
 * l'angolo del foglio e non l'angolo della vista. È l'unico zero che non si
 * sposta: il foglio si trascina, la vista si ingrandisce, i blocchi stanno
 * dove sono. Un righello che misurasse dal foglio direbbe numeri che non si
 * possono ripetere sulla macchina.
 *
 * Sono disegnati in un SVG a parte, sovrapposto al piano e in PIXEL, non in
 * millimetri. Dentro al piano le unità sono millimetri, e lì un righello
 * avrebbe tacche e scritte che si ingrandiscono con la rotella: illeggibili
 * da vicino, invisibili da lontano. Qui invece lo spessore della banda e il
 * corpo dei numeri sono sempre quelli, e a cambiare è solo quanti millimetri
 * passano fra una tacca e l'altra.
 */
var Righelli = (function () {
  var wrap, over, flip, fissi, cursore, lettura;
  var vivo = false;
  var ultimo = null;        // ultimo punto letto, in millimetri macchina

  var BANDA_X = 17;         // altezza della banda in basso, in pixel
  var BANDA_Y = 30;         // larghezza della banda a sinistra, in pixel

  /* I passi fra cui scegliere. Solo numeri con cui si conta davvero: una
     tacca ogni 3 o ogni 7 millimetri sarebbe esatta e inutilizzabile. */
  var PASSI = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  var MIN_PX = 48;          // spazio minimo fra due tacche numerate

  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
    });
  }

  /* La matrice del gruppo ribaltato porta dai millimetri macchina ai pixel
     dello schermo. Il ribaltamento dell'asse Y è dentro la matrice (d < 0):
     non va rifatto a mano, e così il righello resta giusto comunque sia
     messa la vista. */
  function matrice() {
    var m = flip.getScreenCTM();
    if (!m) return null;
    var r = wrap.getBoundingClientRect();
    return { a: m.a, d: m.d, e: m.e - r.left, f: m.f - r.top,
             w: r.width, h: r.height };
  }

  function pxDiX(m, mm) { return m.a * mm + m.e; }
  function pxDiY(m, mm) { return m.d * mm + m.f; }
  function mmDiX(m, px) { return (px - m.e) / m.a; }
  function mmDiY(m, px) { return (px - m.f) / m.d; }

  /* Il passo più fitto che lascia ancora respirare i numeri. Se nemmeno il
     più largo basta — si è usciti talmente tanto che il piano è un francobollo
     — si tiene quello e si stringe: meglio tacche fitte che nessun righello. */
  function passo(pxPerMm) {
    for (var i = 0; i < PASSI.length; i++) {
      if (PASSI[i] * pxPerMm >= MIN_PX) return PASSI[i];
    }
    return PASSI[PASSI.length - 1];
  }

  function numero(v) {
    return String(Math.round(v));
  }

  function disegna() {
    if (!vivo) return;
    var m = matrice();
    if (!m || !m.w || !m.h || !isFinite(m.a) || !m.a) { fissi.innerHTML = ''; return; }

    over.setAttribute('width', m.w);
    over.setAttribute('height', m.h);
    over.setAttribute('viewBox', '0 0 ' + m.w + ' ' + m.h);

    var pxMm = Math.abs(m.a);
    var p = passo(pxMm);
    var minore = p / (p % 5 === 0 ? 5 : 2);
    var fitte = minore * pxMm >= 5;

    var yBanda = m.h - BANDA_X;        // bordo superiore della banda in basso
    /* Le due bande, e il filo che le separa dal piano: senza quel filo le
       tacche sembrano galleggiare sul fondo invece di stare su un righello. */
    var out = '<rect class="rig-banda" x="0" y="' + yBanda + '" width="' + m.w +
              '" height="' + BANDA_X + '"></rect>' +
              '<rect class="rig-banda" x="0" y="0" width="' + BANDA_Y +
              '" height="' + m.h + '"></rect>' +
              '<line class="rig-bordo" x1="0" y1="' + yBanda + '" x2="' + m.w +
              '" y2="' + yBanda + '"></line>' +
              '<line class="rig-bordo" x1="' + BANDA_Y + '" y1="0" x2="' + BANDA_Y +
              '" y2="' + m.h + '"></line>';

    /* --- il righello orizzontale, in basso --- */
    var x0 = mmDiX(m, BANDA_Y), x1 = mmDiX(m, m.w);
    var da = Math.ceil(Math.min(x0, x1) / minore) * minore;
    var a = Math.max(x0, x1);
    for (var v = da; v <= a + 1e-6; v += minore) {
      var vx = Math.round(v * 1e6) / 1e6;
      var px = pxDiX(m, vx);
      if (px < BANDA_Y - 0.5) continue;
      var grande = Math.abs(vx / p - Math.round(vx / p)) < 1e-6;
      if (!grande && !fitte) continue;
      var alt = grande ? 7 : 3;
      out += '<line class="' + (vx === 0 ? 'rig-zero-x' : 'rig-tacca') +
             '" x1="' + px + '" y1="' + yBanda + '" x2="' + px +
             '" y2="' + (yBanda + alt) + '"></line>';
      if (grande) {
        out += '<text class="rig-num" x="' + px + '" y="' + (m.h - 4) +
               '" text-anchor="middle">' + esc(numero(vx)) + '</text>';
      }
    }

    /* --- il righello verticale, a sinistra --- */
    var y0 = mmDiY(m, yBanda), y1 = mmDiY(m, 0);
    var db = Math.ceil(Math.min(y0, y1) / minore) * minore;
    var b = Math.max(y0, y1);
    for (var w = db; w <= b + 1e-6; w += minore) {
      var vy = Math.round(w * 1e6) / 1e6;
      var py = pxDiY(m, vy);
      if (py > yBanda + 0.5) continue;
      var big = Math.abs(vy / p - Math.round(vy / p)) < 1e-6;
      if (!big && !fitte) continue;
      var lar = big ? 7 : 3;
      out += '<line class="' + (vy === 0 ? 'rig-zero-y' : 'rig-tacca') +
             '" x1="' + (BANDA_Y - lar) + '" y1="' + py + '" x2="' + BANDA_Y +
             '" y2="' + py + '"></line>';
      if (big) {
        out += '<text class="rig-num" x="' + (BANDA_Y - 9) + '" y="' + (py + 3) +
               '" text-anchor="end">' + esc(numero(vy)) + '</text>';
      }
    }

    fissi.innerHTML = out;
    marca();
  }

  /* I due trattini che seguono il puntatore sui righelli. Stanno in un gruppo
     a parte perché si muovono con il mouse, e ridisegnare tutte le tacche a
     ogni movimento sarebbe lavoro buttato. */
  function marca() {
    if (!vivo) return;
    if (!ultimo) { cursore.innerHTML = ''; return; }
    var m = matrice();
    if (!m) return;
    var px = pxDiX(m, ultimo.x), py = pxDiY(m, ultimo.y);
    var yBanda = m.h - BANDA_X;
    cursore.innerHTML =
      '<line class="rig-cur" x1="' + px + '" y1="' + yBanda + '" x2="' + px +
      '" y2="' + m.h + '"></line>' +
      '<line class="rig-cur" x1="0" y1="' + py + '" x2="' + BANDA_Y +
      '" y2="' + py + '"></line>';
  }

  function virgola(v) {
    return (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
  }

  /* La lettura resta scritta anche quando il mouse esce dal piano, solo
     smorzata: cancellarla vorrebbe dire che per rileggere un numero appena
     visto bisogna rifare il movimento. */
  function mostra() {
    if (!lettura) return;
    if (!ultimo) { lettura.textContent = 'X —  Y —'; lettura.classList.add('fuori'); return; }
    lettura.textContent = 'X ' + virgola(ultimo.x) + '  Y ' + virgola(ultimo.y);
  }

  function segui(e) {
    var m = matrice();
    if (!m) return;
    var r = wrap.getBoundingClientRect();
    ultimo = { x: mmDiX(m, e.clientX - r.left), y: mmDiY(m, e.clientY - r.top) };
    lettura.classList.remove('fuori');
    mostra();
    marca();
  }

  function init() {
    wrap = document.getElementById('bed-plane');
    over = document.getElementById('righelli');
    flip = document.getElementById('flip');
    lettura = document.getElementById('cursor-mm');
    if (!wrap || !over || !flip) return;

    fissi = document.getElementById('rig-fissi');
    cursore = document.getElementById('rig-cursore');
    vivo = true;

    wrap.addEventListener('pointermove', segui);
    wrap.addEventListener('pointerleave', function () {
      if (lettura) lettura.classList.add('fuori');
    });

    /* La vista cambia con la rotella, col trascinamento e col formato del
       foglio: il righello la ascolta invece di farsi chiamare da ognuno. */
    State.on('vista', disegna);

    /* Il piano cambia dimensione anche senza che cambi la vista: basta
       allargare una colonna laterale. Senza questo, i righelli resterebbero
       disegnati sulla larghezza di prima. */
    if (window.ResizeObserver) {
      new ResizeObserver(disegna).observe(wrap);
    } else {
      window.addEventListener('resize', disegna);
    }

    mostra();
    disegna();
  }

  return { init: init, disegna: disegna };
})();
