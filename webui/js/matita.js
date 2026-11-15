/* IL TRATTO FATTO A MANO: da quello che la mano ha fatto a una forma.
 *
 * PERCHE' ESISTE QUESTO FILE. Tutti gli strumenti dell'editor mettono i nodi
 * uno per uno: si clicca, si posa un punto, si clicca di nuovo. Con una
 * Apple Pencil in mano quel modo di lavorare non e' sbagliato, e' assurdo --
 * la penna sa fare la cosa che il mouse non sa fare, cioe' seguire una mano.
 * Qui dentro c'e' il pezzo che trasforma le centinaia di punti che arrivano
 * dal vetro in una forma dell'editor: pochi nodi, con le maniglie, da
 * correggere dopo come qualunque altra.
 *
 * STA FUORI DALL'EDITOR perche' e' aritmetica, e l'aritmetica si prova da
 * sola: una lista di punti entra, una lista di nodi esce. Il collaudo le
 * passa punti inventati -- una riga dritta tremolante, un cerchio fatto a
 * mano -- e guarda cosa ne esce, senza aprire nessuna tela e senza nessun
 * dito.
 *
 * LE SOGLIE SONO IN PIXEL DELLO SCHERMO, non in millimetri del foglio, e la
 * ragione e' che il tremolio e' un fatto dello schermo: quello che la mano
 * non riesce a fare e' muoversi di meno di un pixel sul vetro. Guardando il
 * disegno da vicino un tremolio di un pixel vale un centesimo di millimetro
 * sulla carta e va TENUTO; guardandolo da lontano lo stesso tremolio vale
 * mezzo millimetro e va tolto. Chi chiama passa quanto vale un pixel
 * (`unitaPerPx`) e tutto segue da la'. L'alternativa -- soglie in millimetri
 * -- vorrebbe dire un tratto che si addolcisce diversamente a seconda di
 * quanto si era ingranditi, cioe' un comportamento che nessuno puo'
 * prevedere.
 *
 * LE QUATTRO COSE CHE SI FANNO AI PUNTI, in ordine, e perche':
 *
 *   1. SI BUTTANO I DOPPIONI. Il vetro manda un punto ogni pochi
 *      millisecondi anche quando la penna e' ferma: una pausa a meta' del
 *      tratto sono cinquanta punti nello stesso posto, e nessuno dei quattro
 *      passi dopo li gradisce. Si tiene un punto solo se si e' spostato di
 *      almeno mezzo pixel.
 *   2. SI ADDOLCISCE, AVANTI E POI INDIETRO. Una media mobile che corre in
 *      un verso solo ritarda: il tratto esce spostato indietro rispetto alla
 *      mano, e una curva si stringe verso il suo centro. Rifacendola in
 *      senso contrario sullo stesso tratto il ritardo si annulla -- il
 *      secondo passaggio lo sposta esattamente dell'altra parte. E' il
 *      motivo per cui si addolcisce AL RILASCIO e non mentre si disegna:
 *      indietro, mentre la mano va avanti, non si puo' andare.
 *   3. SI TOLGONO I NODI DI TROPPO (Douglas-Peucker, in `tracciato.js`).
 *      Trecento punti di mano diventano venti nodi: non per far piccolo il
 *      file, ma perche' un tratto con trecento nodi non si CORREGGE -- per
 *      spostare una curva si dovrebbero prendere quaranta nodi uno per uno.
 *   4. SI METTONO LE MANIGLIE (Catmull-Rom). Venti nodi uniti da righe
 *      dritte sono un poligono, e si vede. Le maniglie a un sesto della
 *      corda fra il nodo prima e quello dopo fanno passare una curva liscia
 *      per tutti i nodi, e su un tratto di mano dritto restano allineate --
 *      cioe' una riga dritta resta dritta.
 *
 * QUELLO CHE NON SI FA: la pressione e l'inclinazione della Pencil si
 * leggono, e si buttano. Una penna a sfera ha UNA larghezza: premere di piu'
 * non fa un segno piu' grosso, fa un segno piu' scuro e un pennino
 * consumato. Metterle fra i parametri vorrebbe dire promettere sulla carta
 * una cosa che la macchina non puo' fare. Lo spessore del tratto resta
 * quello del livello, cioe' della penna che ci sta dentro.
 */
var Matita = (function () {

  /* Due punti piu' vicini di cosi' (in pixel dello schermo) sono lo stesso
     punto: la penna era ferma, o il vetro ha sbavato. */
  var MINIMO_PX = 0.5;

  /* Se il capo del tratto torna entro tre millimetri dal suo inizio, la mano
     stava chiudendo una forma. In MILLIMETRI e non in pixel, questa: chiudere
     o no e' una domanda sul disegno -- «e' un anello o una riga?» -- e non
     sulla precisione della mano. */
  var CHIUDE_MM = 3;

  /* LA MANO FERMA, da 0 a 10, e cosa vuol dire nei numeri.
     `alfa` e' il peso del punto nuovo nella media mobile: 1 vuol dire
     «niente media», cioe' il tratto come l'ha fatto la mano. `tol` e' di
     quanto la linea puo' spostarsi quando si toglie un nodo, in pixel. */
  function alfa(f) { return 1 / (1 + 0.45 * Math.max(0, f)); }
  function tolPx(f) { return 0.25 + 0.35 * Math.max(0, f); }

  function dist(a, b) {
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
  }

  /* 1. I doppioni. Il primo e l'ULTIMO punto si tengono sempre: l'ultimo e'
     dove la mano ha staccato, ed e' il punto che decide se il tratto si
     chiude. Buttarlo perche' era vicino al precedente vorrebbe dire
     accorciare il tratto di un pelo proprio dove si guarda. */
  function pulisci(punti, minimo) {
    if (!punti || punti.length < 2) return (punti || []).slice();
    var out = [punti[0]];
    for (var i = 1; i < punti.length; i++) {
      if (dist(punti[i], out[out.length - 1]) >= minimo) out.push(punti[i]);
    }
    var ultimo = punti[punti.length - 1];
    if (out[out.length - 1] !== ultimo) out.push(ultimo);
    return out;
  }

  /* 2. La media mobile in un verso. Il primo punto non si tocca: e' l'unico
     di cui si sa per certo dove la mano l'ha messo. */
  function media(punti, a) {
    if (a >= 1 || punti.length < 3) return punti.slice();
    var out = [punti[0]];
    var x = punti[0].x, y = punti[0].y;
    for (var i = 1; i < punti.length; i++) {
      x = punti[i].x * a + x * (1 - a);
      y = punti[i].y * a + y * (1 - a);
      out.push({ x: x, y: y });
    }
    return out;
  }

  function rovescia(punti) { return punti.slice().reverse(); }

  /* AVANTI E INDIETRO: `media` ritarda di qualche punto, e rifatta al
     contrario ritarda dell'altra parte. Le due cose si annullano, e il tratto
     resta dove la mano l'ha fatto -- addolcito, non spostato. Chi vuole
     vedere la differenza disegni un cerchio con la mano ferma a 10: con un
     passaggio solo esce una spirale che non si chiude. */
  function addolcisci(punti, a) {
    if (a >= 1) return punti.slice();
    var out = rovescia(media(rovescia(media(punti, a)), a));
    /* I DUE CAPI TORNANO DOVE LA MANO LI AVEVA MESSI. `media` non tocca il
       primo punto della lista che le arriva, quindi il passaggio in avanti
       tiene l'inizio e quello all'indietro tiene la fine -- ma ognuno dei due
       sposta il capo che l'altro aveva tenuto, e su un tratto corto lo sposta
       di tanto. I capi sono gli unici due punti che la mano ha messo di
       PROPOSITO: uno e' dove ha appoggiato, l'altro dove ha staccato. Sono
       quelli su cui si decide se il tratto si chiude, e quelli che i magneti
       devono poter attaccare al disegno che c'e' gia'. Si rimettono esatti. */
    if (out.length > 1) {
      out[0] = { x: punti[0].x, y: punti[0].y };
      out[out.length - 1] = { x: punti[punti.length - 1].x,
                              y: punti[punti.length - 1].y };
    }
    return out;
  }

  /* LA MEDIA MOBILE MENTRE SI DISEGNA, un punto per volta. Serve
     all'anteprima: quello che si vede sotto la punta e' gia' addolcito, se no
     il tratto cambierebbe forma al rilascio e la mano non avrebbe modo di
     correggersi. Qui si va solo AVANTI -- indietro, mentre la mano va avanti,
     non si puo' andare -- quindi l'anteprima ritarda di un pelo rispetto al
     tratto definitivo. E' la differenza fra vedere e avere, ed e' piu'
     piccola di un pixel dopo i primi punti. */
  function passo(stato, p, fermezza) {
    var a = alfa(fermezza);
    if (!stato) return { x: p.x, y: p.y };
    return { x: p.x * a + stato.x * (1 - a), y: p.y * a + stato.y * (1 - a) };
  }

  /* 4. Le maniglie. Per ogni nodo, la corda fra il nodo PRIMA e quello DOPO
   * da' la direzione in cui la curva passa per quel punto. Quanto devono
   * essere lunghe e' la parte delicata: un sesto della corda fra i due vicini
   * vale se i nodi sono EQUIDISTANTI, e dopo Douglas-Peucker non lo sono --
   * resta un nodo ogni tanto dove la linea e' dritta e uno ogni punto dove
   * gira. Quindi ogni maniglia e' lunga in proporzione al SUO lato, un terzo
   * del lato a cui guarda; con i nodi equidistanti la proporzione vale un
   * mezzo e si torna al sesto della corda, cioe' la formula semplice e' il
   * caso particolare di questa.
   *
   * QUANTO VALE, misurato: su un quarto di cerchio da 200 unita' tenuto a
   * undici nodi, la curva con le maniglie si scosta dal cerchio della mano di
   * 0,36 unita' contro 1,02 dei segmenti dritti -- tre volte meglio. Fra la
   * formula proporzionale e quella a sesto fisso la differenza, su quella
   * scena, e' piccola (0,36 contro 0,39): la proporzione e' qui perche' e' la
   * formula giusta per nodi non equidistanti, non perche' si sia visto un
   * disegno sbagliato senza di lei.
   *
   * QUELLO CHE QUESTO NON FA: un angolo vivo. Una curva che passa liscia per
   * tutti i nodi non ha spigoli, quindi un angolo retto fatto a mano esce
   * arrotondato. Per una matita e' giusto -- a mano libera un angolo e' tondo
   * comunque -- e chi lo vuole vivo prende il nodo e lo rende d'angolo con il
   * pulsante che c'e' gia'. */
  function maniglie(nodi, chiuso) {
    var n = nodi.length;
    if (n < 3) return nodi;
    for (var i = 0; i < n; i++) {
      var p = nodi[i], pre, post;
      if (chiuso) {
        pre = nodi[(i - 1 + n) % n];
        post = nodi[(i + 1) % n];
      } else {
        pre = nodi[i - 1];
        post = nodi[i + 1];
      }
      if (pre && post) {
        var dx = post.x - pre.x, dy = post.y - pre.y;
        var la = dist(p, pre), lb = dist(p, post);
        var tot = la + lb;
        if (tot < 1e-12) continue;
        /* La direzione e' la stessa per le due maniglie -- la curva ci passa
           dritta --, la lunghezza no: ognuna segue il suo lato. */
        p.hi = { x: p.x - dx * (la / tot) / 3, y: p.y - dy * (la / tot) / 3 };
        p.ho = { x: p.x + dx * (lb / tot) / 3, y: p.y + dy * (lb / tot) / 3 };
      } else if (post) {
        p.ho = { x: p.x + (post.x - p.x) / 3, y: p.y + (post.y - p.y) / 3 };
      } else if (pre) {
        p.hi = { x: p.x + (pre.x - p.x) / 3, y: p.y + (pre.y - p.y) / 3 };
      }
    }
    return nodi;
  }

  /* QUANTA PENNA E' LUNGO IL TRATTO, e si misura sulla CURVA appiattita e
     non sui nodi. Un cerchio tenuto a otto nodi, misurato da nodo a nodo, e'
     l'ottagono inscritto: il dieci per cento in meno del cerchio che la penna
     percorrera' davvero. E su un tratto chiuso manca anche l'ultimo pezzo,
     quello che torna al primo nodo. */
  function lunghezza(forma) {
    var L = 0;
    Tracciato.appiattisci(forma, 0.02).forEach(function (poli) {
      for (var i = 1; i < poli.length; i++) L += dist(poli[i - 1], poli[i]);
    });
    return L;
  }

  /* IL TRATTO INTERO, dai punti della mano ai nodi della forma.
   *
   *   punti        quello che e' arrivato dal vetro, in unita' del file
   *   opt.unitaPerPx   quanto vale un pixel dello schermo in quelle unita'
   *   opt.mmPerUnita   quanti millimetri vale un'unita' (per la chiusura)
   *   opt.fermezza     la «mano ferma», 0..10
   *   opt.chiudi       se un tratto che torna all'inizio va chiuso
   *
   * Torna `null` se non c'e' un tratto: un tocco solo non e' un tratto, e
   * due punti nello stesso posto sono un movimento di lunghezza zero che il
   * G-code emetterebbe e la macchina non eseguirebbe.
   */
  function tratto(punti, opt) {
    opt = opt || {};
    var u = opt.unitaPerPx > 0 ? opt.unitaPerPx : 1;
    var mm = opt.mmPerUnita > 0 ? opt.mmPerUnita : 1;
    var f = opt.fermezza || 0;

    var p = pulisci(punti, MINIMO_PX * u);
    if (p.length < 2) return null;

    p = addolcisci(p, alfa(f));
    p = Tracciato.dritti(p, tolPx(f) * u);

    /* LA CHIUSURA SI DECIDE SUI PUNTI DI PARTENZA, cioe' prima che
       l'addolcimento li sposti: la domanda e' «la mano e' tornata
       all'inizio?», e la risposta non deve dipendere da come si e' scelto di
       lisciare. */
    var chiuso = false;
    if (opt.chiudi && punti.length > 2 &&
        dist(punti[0], punti[punti.length - 1]) * mm <= CHIUDE_MM) {
      chiuso = true;
      /* Chiuso vuol dire che il sub torna da se' al primo nodo: l'ultimo
         nodo, che stava quasi sopra al primo, non serve piu' e lascerebbe un
         tratto di mezzo decimo. */
      if (p.length > 2) p.pop();
    }

    if (p.length < 2) return null;
    if (p.length === 2 && dist(p[0], p[1]) < MINIMO_PX * u) return null;

    var nodi = p.map(function (q) { return Tracciato.nodo(q.x, q.y); });
    maniglie(nodi, chiuso);
    var forma = Tracciato.tracciato([{ nodi: nodi, chiuso: chiuso }]);
    return {
      forma: forma,
      nodi: nodi.length,
      chiuso: chiuso,
      lunghezza: lunghezza(forma) * mm
    };
  }

  return { tratto: tratto, passo: passo, addolcisci: addolcisci,
           pulisci: pulisci, alfa: alfa, tolPx: tolPx,
           MINIMO_PX: MINIMO_PX, CHIUDE_MM: CHIUDE_MM };
})();

if (typeof module !== 'undefined') module.exports = Matita;
