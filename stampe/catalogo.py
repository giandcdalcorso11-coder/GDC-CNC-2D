#!/usr/bin/env python3
"""Genera stampe/catalogo/index.html: il catalogo degli stili con le anteprime dei file veri.

  python3 -B catalogo.py

Le anteprime sono gli SVG veri (senza metadati dello SLICER), incorporati nella pagina: un clic li
apre in grande, con zoom. I numeri (tratti, lunghezza, sollevamenti) vengono dal controllo.
Un solo file HTML, senza dipendenze e senza browser per costruirlo.
"""
import base64
import html
import json
import os
import re

import controlla

QUI = os.path.dirname(os.path.abspath(__file__))

STILI = [
    {
        'id': 'rilievo', 'nome': 'Rilievo',
        'cosa': 'Un personaggio o un oggetto 3D disegnato con linee organiche che seguono la forma: sagoma nera e curve di livello grigie, come una carta topografica vista di fronte.',
        'ingresso': 'modello 3D (.3mf) con la vista da cui guardarlo, oppure uno screenshot del modello',
        'dettagli': [
            ('essenziale', 'sagoma e poche curve levigate (circa 12); il volto resta vuoto'),
            ('medio', 'più curve (circa 20) dalla stessa mappa di profondità'),
            ('dettagliato', 'ombreggiatura del modello: curve di luminosità più i tratti scuri di occhi, pieghe, bottoni'),
        ],
        'si': 'figure e mascotte viste di fronte; due penne (nero per la sagoma, grigio per il rilievo)',
        'no': 'foto di persone (non c\'è un modello 3D); oggetti piatti visti dall\'alto (per quelli c\'è Layer)',
        'serve': 'file .3mf, angoli di vista (rz = giro, rx = inclinazione dall\'alto), testi sotto il disegno',
        'esempi': [
            ('Starry angel kid — essenziale', 'antei/starry angel kid cnc2d (essenziale).svg', None, None),
            ('Starry angel kid — dettagliato', 'antei/starry angel kid cnc2d (dettagliato).svg', None, None),
            ('Starboy da screenshot — dettagliato', 'antei/starboy cnc2d (dettagliato).svg', None, None),
            ('Starboy da screenshot — essenziale', 'antei/starboy cnc2d (essenziale).svg', None, None),
        ],
    },
    {
        'id': 'layer', 'nome': 'Layer',
        'cosa': 'Un modello 3D tagliato in fette alla stessa quota, come gli strati di una stampa 3D: linee parallele e ordinate, una sopra l\'altra.',
        'ingresso': 'modello 3D (.3mf) visto dall\'alto o inclinato',
        'dettagli': [
            ('essenziale', '12 strati'),
            ('medio', '20 strati'),
            ('dettagliato', '28 strati, risoluzione più alta'),
        ],
        'si': 'oggetti con un rilievo marcato visti dall\'alto (ciotole, portaoggetti, targhe); effetto a curve di livello pulito',
        'no': 'figure viste di fronte e con poca profondità: gli strati diventano strisce (per quelle c\'è Rilievo)',
        'serve': 'file .3mf, vista (rx da 35° in su dà gli strati più leggibili), testi sotto il disegno',
        'esempi': [
            ('Biglietto Feffi (portaoggetti dall\'alto, con testi e logo)', 'portaoggetti-feffi/finale/biglietto-feffi-kira.cnc2d.svg', 0.5, None),
            ('Starry angel kid — layer, medio', 'catalogo/esempi/starry-angel-kid-layer/starry-angel-kid-layer.svg', None, 'catalogo/esempi/starry-angel-kid-layer/scheda.json'),
        ],
    },
    {
        'id': 'onde', 'nome': 'Onde',
        'cosa': 'Una foto diventa righe orizzontali ondulate e continue: dove la foto è scura l\'onda si alza e la riga si ispessisce.',
        'ingresso': 'foto o immagine',
        'dettagli': [
            ('essenziale', 'righe a 2,8 mm, onde larghe (4,2 mm): pochi tratti lunghi'),
            ('medio', 'righe a 2,2 mm, onde 3,4 mm'),
            ('dettagliato', 'righe a 1,7 mm, onde 2,6 mm: più fedele, molta più penna'),
        ],
        'si': 'foto con una figura riconoscibile su sfondo diverso; pochi sollevamenti di penna',
        'no': 'volti piccoli (con le righe larghe il volto si perde); scritte sottili',
        'serve': 'foto, ritaglio (px da togliere: su,giù,sinistra,destra), foglio',
        'esempi': [
            ('Coppia — essenziale (onde larghe)', 'foto-coppia/coppia onde larghe cnc2d.svg', None, None),
            ('Coppia — dettagliato', 'foto-coppia/coppia onde cnc2d.svg', None, None),
        ],
    },
    {
        'id': 'poligoni', 'nome': 'Poligoni',
        'cosa': 'Una foto diventa un mosaico di triangoli: piccoli dove c\'è dettaglio, grandi dove la foto è piatta.',
        'ingresso': 'foto o immagine',
        'dettagli': [
            ('essenziale', 'triangoli da 9 mm, solo i lati'),
            ('medio', 'triangoli da 7 mm, solo i lati'),
            ('dettagliato', 'triangoli da 7 mm con un triangolo interno nelle zone scure per dare il tono'),
        ],
        'si': 'un effetto grafico moderno; il soggetto si legge anche con pochi triangoli',
        'no': 'chi vuole pochi sollevamenti di penna: ogni lato è un segmento (lo SLICER li salda in catene)',
        'serve': 'foto, ritaglio, foglio',
        'esempi': [
            ('Coppia — leggero', 'foto-coppia/coppia poligoni (leggero) cnc2d.svg', None, None),
            ('Coppia — con toni', 'foto-coppia/coppia poligoni (toni) cnc2d.svg', None, None),
        ],
    },
    {
        'id': 'linea', 'nome': 'Linea',
        'cosa': 'Un\'illustrazione o un logo pieni diventano una linea sola per tratto; lo spessore lo dà la penna, scelta per livello nello SLICER.',
        'ingresso': 'illustrazione o logo pieno (inchiostro di un colore su fondo chiaro)',
        'dettagli': [
            ('regola delle scritte', 'con l\'indelebile da 1,5 mm il tratto sta DENTRO la lettera e le lettere restano separate'),
            ('due penne', 'Tratto Pen (0,5 mm) per contorni e dettagli; indelebile (1,5 mm) per scritte e tratti spessi'),
        ],
        'si': 'icone, magneti, targhette, scritte: tutto quello che si disegna con un pennarello grosso',
        'no': 'fotografie; disegni molto sfumati; chi vuole il contorno esatto di ogni forma (per quello c\'è Fedele)',
        'serve': 'immagine, dove finisce la grafica e comincia la scritta (frazione dell\'altezza), quali parti in quale penna',
        'esempi': [
            ('Tutti i magneti (foglio rifinito dall\'utente)', 'magneti/finali-utente/tutti_i_magneti.svg', 1.5, None),
        ],
    },
    {
        'id': 'fedele', 'nome': 'Fedele',
        'cosa': 'Riporta un\'immagine il più fedelmente possibile: di ogni campitura si traccia il contorno, senza reinterpretare niente.',
        'ingresso': 'illustrazione, logo, disegno a campiture piatte (anche a più colori: un livello per colore)',
        'dettagli': [
            ('essenziale', 'grana ripulita, curve semplificate: pochi contorni, i particolari minuscoli spariscono'),
            ('medio', 'il compromesso usato per il logo Antei'),
            ('dettagliato', 'conserva anche i particolari piccoli, più contorni e più penna'),
        ],
        'si': 'loghi e illustrazioni con bordi netti; opzioni: colori=N, riempimento=mm (tratteggio nelle campiture piene)',
        'no': 'foto (riportarle «fedelmente» non ha senso: per quelle ci sono Onde e Poligoni); linee molto sottili: ogni linea diventa due contorni vicini',
        'serve': 'immagine con fondo chiaro e uniforme; quanti colori d\'inchiostro',
        'esempi': [
            ('Logo Antei — essenziale', 'catalogo/esempi/logo-antei-fedele/logo-antei-fedele-essenziale.svg', None, None),
            ('Logo Antei — medio', 'catalogo/esempi/logo-antei-fedele/logo-antei-fedele.svg', None, 'catalogo/esempi/logo-antei-fedele/scheda.json'),
            ('Logo Antei — dettagliato', 'catalogo/esempi/logo-antei-fedele/logo-antei-fedele-dettagliato.svg', None, None),
        ],
    },
    {
        'id': 'tratti', 'nome': 'Tratti',
        'cosa': 'Tratteggio incrociato da foto (incisione).',
        'ingresso': 'foto (tarato sulla foto della coppia: persone scure su sfondo chiaro)',
        'dettagli': [('unico', 'nessun livello di dettaglio: toni a tratteggio fitto e incrociato')],
        'si': 'solo come stile da guardare',
        'no': 'sconsigliato per la macchina: migliaia di trattini corti, tanti sollevamenti, righe fitte quanto la penna. Scartato dall\'utente per questo; su altre foto non è stato messo a punto.',
        'serve': 'foto',
        'esempi': [('Coppia — l\'unico esempio fatto', 'foto-coppia/coppia tratti cnc2d.svg', None, None)],
    },
]

SCHEDA = [
    ('Ingresso', 'modello 3D (.3mf) con vista · foto · screenshot · illustrazione/logo'),
    ('Stile', 'Rilievo · Layer · Onde · Poligoni · Linea · Fedele (· Tratti, sconsigliato)'),
    ('Dettaglio', 'essenziale · medio · dettagliato'),
    ('Foglio', 'larghezza × altezza in mm e margine (default 8 mm)'),
    ('Penne', 'quali usi e che cosa va in ciascuna; default: tutte le scritte in indelebile, il resto lo scelgo io'),
    ('Testi', 'cosa scrivere e dove (sotto il disegno); se non dici altro, niente logo GDC'),
    ('Da non fare', 'per esempio «niente sfondo», «tieni i contorni»'),
]
REGOLE = [
    'Una linea sola per tratto: lo spessore lo sceglie la penna del livello nello SLICER.',
    'Un colore = un livello = una penna. I colori nei file sono solo etichette dei livelli.',
    'Le lettere per l\'indelebile (1,5 mm) stanno dentro la lettera, con aria fra una e l\'altra.',
    'Ogni file passa dal controllo: ingombro nel foglio, sollevamenti di penna, tratti sovrapposti.',
    'Il file ritoccato dall\'utente nello SLICER prevale su quello generato.',
]


def svg_uri(rel, spessore):
    """SVG pulito (senza prologo, commenti e metadati dello SLICER) come data URI.
    Con `spessore` si forza lo spessore dei tratti: gli SVG dello SLICER disegnano a 0,3 mm."""
    t = open(os.path.join(QUI, rel), encoding='utf-8').read()
    t = re.sub(r'<\?xml[^>]*\?>', '', t)
    t = re.sub(r'<!--[\s\S]*?-->', '', t)                  # prima i commenti: citano <metadata>
    t = re.sub(r'<metadata[\s\S]*?</metadata>', '', t).strip()
    if spessore:
        t = re.sub(r'(<svg[^>]*>)', r'\1<style>g{stroke-width:%gpx !important}</style>' % spessore, t, count=1)
    return 'data:image/svg+xml;base64,' + base64.b64encode(t.encode('utf-8')).decode()


def ricetta(rel):
    """Una riga con la ricetta, se accanto al file c'e' la scheda."""
    s = json.load(open(os.path.join(QUI, rel), encoding='utf-8'))
    v = s.get('ingresso', {}).get('vista')
    f = s.get('foglio', {})
    r = ['stile %s' % s.get('stile'), s.get('dettaglio', '')]
    if v:
        r.append('vista rz %g rx %g' % (v.get('rz', 0), v.get('rx', 0)))
    r.append('foglio %g×%g mm' % (f.get('w', 0), f.get('h', 0)))
    return ' · '.join(x for x in r if x)


def numeri(rel):
    rep = controlla.analizza(open(os.path.join(QUI, rel), encoding='utf-8').read())
    lung = sum(l['lunghezza_m'] for l in rep['livelli'])
    return '%d tratti · %.1f m di linea · %d livelli' % (sum(l['tratti'] for l in rep['livelli']), lung, len(rep['livelli']))


CSS = """
:root{--bg:#f6f4ef;--card:#fff;--ink:#1c1b19;--mut:#6b675f;--line:#e2ded4;--acc:#2f6f4f;--acc2:#e9f1ec;--bad:#9a3b2e}
@media (prefers-color-scheme:dark){:root{--bg:#171715;--card:#22211f;--ink:#efece4;--mut:#a39f94;--line:#383630;--acc:#7fc29c;--acc2:#1f2e26;--bad:#e08b7d}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.w{max-width:1100px;margin:0 auto;padding:0 16px 64px}
header{padding:36px 0 8px}h1{font-size:2rem;margin:0 0 4px;letter-spacing:-.01em}header p{color:var(--mut);margin:0;max-width:60ch}
nav{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 4px;position:sticky;top:0;background:var(--bg);padding:10px 0;z-index:2}
nav a{padding:6px 14px;border:1px solid var(--line);border-radius:99px;color:var(--ink);text-decoration:none;font-size:.9rem;background:var(--card)}
nav a:hover{border-color:var(--acc);color:var(--acc)}
section{margin-top:40px;scroll-margin-top:64px}h2{font-size:1.5rem;margin:0 0 4px}h3{font-size:1rem;margin:20px 0 6px;color:var(--mut);font-weight:600;text-transform:uppercase;letter-spacing:.06em;font-size:.78rem}
.lead{margin:0 0 8px}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:12px 0}
.meta div{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.meta b{display:block;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin-bottom:2px}
.meta .no b{color:var(--bad)}
table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
td{padding:9px 14px;border-top:1px solid var(--line);vertical-align:top}tr:first-child td{border-top:0}td:first-child{white-space:nowrap;font-weight:600;color:var(--acc);width:1%}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-top:8px}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
figure button{display:block;width:100%;padding:0;border:0;background:#fff;cursor:zoom-in}
figure button:focus-visible{outline:3px solid var(--acc);outline-offset:-3px}
figure img{display:block;width:100%;height:280px;object-fit:contain;padding:8px}
figure button::after{content:"Apri in grande";position:absolute;right:10px;top:10px;font-size:.75rem;background:#000a;color:#fff;padding:3px 9px;border-radius:99px;opacity:0;transition:opacity .15s}
figure{position:relative}figure:hover button::after,figure button:focus-visible::after{opacity:1}
dialog{border:0;border-radius:14px;padding:0;width:min(96vw,1300px);max-height:96vh;background:var(--card);color:var(--ink)}
dialog::backdrop{background:#000b}
.vista{background:#fff;overflow:auto;max-height:80vh;text-align:center;cursor:zoom-in}
.vista img{max-width:100%;max-height:78vh;display:inline-block}
.vista.z{cursor:zoom-out;text-align:left}.vista.z img{max-width:none;max-height:none;width:260%}
dialog header{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line)}
dialog header p{margin:0;font-size:.95rem}dialog header small{display:block;color:var(--mut)}
dialog header button{border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:99px;padding:6px 16px;cursor:pointer;font:inherit}
dialog .aiuto{margin:0;padding:8px 16px;font-size:.8rem;color:var(--mut)}
figcaption{padding:10px 14px;font-size:.9rem;border-top:1px solid var(--line)}figcaption small{display:block;color:var(--mut);margin-top:2px}
ol,ul{padding-left:1.2em}li{margin:4px 0}.box{background:var(--acc2);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin-top:12px}
code{background:var(--acc2);padding:1px 6px;border-radius:6px;font-size:.88em}
"""


LIGHTBOX = '''<dialog id="lb" aria-label="Anteprima ingrandita"><header><p id="lbt"></p><button id="lbx" type="button">Chiudi</button></header>
<div class="vista" id="lbv"><img id="lbi" alt=""></div><p class="aiuto">Clic sull'immagine per ingrandire o tornare alla vista intera · Esc per chiudere</p></dialog>
<script>
(function(){var d=document.getElementById('lb'),v=document.getElementById('lbv'),i=document.getElementById('lbi'),t=document.getElementById('lbt');
if(!d.showModal)return;
document.querySelectorAll('figure button').forEach(function(b){b.addEventListener('click',function(){
 var f=b.closest('figure');i.src=b.querySelector('img').src;i.alt=b.querySelector('img').alt;
 t.innerHTML=f.querySelector('figcaption').innerHTML;v.classList.remove('z');d.showModal();});});
v.addEventListener('click',function(){v.classList.toggle('z');});
document.getElementById('lbx').addEventListener('click',function(){d.close();});
d.addEventListener('click',function(e){if(e.target===d)d.close();});
})();
</script>'''


def pagina(blocchi_stili, dati_scheda):
    return ('<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Catalogo stili</title><style>%s</style></head><body><div class="w">'
            '<header><h1>Catalogo degli stili</h1><p>Come trasformiamo un modello 3D, una foto o un logo in un disegno per la macchina. '
            'Ogni stile ha un nome fisso: basta dirlo, con il dettaglio, per essere allineati.</p></header>'
            '<nav>%s<a href="#scheda">Scheda lavoro</a></nav>%s%s</div>%s</body></html>' % (CSS, ''.join(
                '<a href="#%s">%s</a>' % (s['id'], s['nome']) for s in STILI), blocchi_stili, dati_scheda, LIGHTBOX))


def main():
    blocchi = ''
    for st in STILI:
        fig = ''
        for titolo, rel, sp, sch in st['esempi']:
            nota = numeri(rel) + (' · ' + ricetta(sch) if sch else '')
            fig += ('<figure><button type="button" aria-label="Apri in grande: %s"><img alt="%s" src="%s"></button>'
                    '<figcaption>%s<small>%s</small></figcaption></figure>'
                    % (html.escape(titolo), html.escape(titolo), svg_uri(rel, sp), html.escape(titolo), html.escape(nota)))
        dett = ''.join('<tr><td>%s</td><td>%s</td></tr>' % (html.escape(a), html.escape(b)) for a, b in st['dettagli'])
        blocchi += (
            '<section id="%s"><h2>%s</h2><p class="lead">%s</p>'
            '<div class="meta"><div><b>Ingresso</b>%s</div><div><b>Adatto a</b>%s</div>'
            '<div class="no"><b>Meno adatto</b>%s</div><div><b>Cosa mi serve</b>%s</div></div>'
            '<h3>Livelli di dettaglio</h3><table>%s</table><h3>Esempi veri</h3><div class="gal">%s</div></section>'
            % (st['id'], st['nome'], html.escape(st['cosa']), html.escape(st['ingresso']), html.escape(st['si']),
               html.escape(st['no']), html.escape(st['serve']), dett, fig))
    if True:
        scheda = ('<section id="scheda"><h2>La scheda lavoro</h2><p class="lead">Ogni nuovo lavoro parte da queste domande: te le faccio io '
                  'all\'inizio, tu rispondi a scelta o a parole.</p><table>%s</table>'
                  '<h3>Regole fisse</h3><div class="box"><ul>%s</ul></div>'
                  '<h3>Come lavoriamo</h3><div class="box"><ol><li>Ti faccio il modulo e compilo la scheda con le tue risposte.</li>'
                  '<li>Genero il file con <code>lavoro.py</code>: sceglie il motore giusto e fa il controllo.</li>'
                  '<li>Ti mando l\'anteprima e i numeri (tratti, sollevamenti, ingombro).</li>'
                  '<li>Correggo sui tuoi segni; il file che rifinisci nello SLICER diventa quello buono.</li>'
                  '<li>La scheda resta nella cartella del lavoro: «rifai come quello» ha una ricetta.</li></ol></div></section>'
                  % (''.join('<tr><td>%s</td><td>%s</td></tr>' % (html.escape(a), html.escape(b)) for a, b in SCHEDA),
                     ''.join('<li>%s</li>' % html.escape(r) for r in REGOLE)))
        out = os.path.join(QUI, 'catalogo', 'index.html')
        open(out, 'w', encoding='utf-8').write(pagina(blocchi, scheda))
        print('scritto', out, '(%.0f KB)' % (os.path.getsize(out) / 1024))


if __name__ == '__main__':
    main()
