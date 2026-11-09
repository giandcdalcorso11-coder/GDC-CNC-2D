#!/usr/bin/env python3
"""Genera stampe/catalogo/index.html: il catalogo degli stili con le anteprime dei file veri.

  python3 -B catalogo.py

Le miniature si ricavano dagli SVG gia' consegnati (elenco ESEMPI qui sotto), con i numeri
veri del controllo (tratti, lunghezza, sollevamenti). Un solo file HTML, senza dipendenze.
"""
import base64
import html
import json
import os
import subprocess
import tempfile

import controlla

QUI = os.path.dirname(os.path.abspath(__file__))

STILI = [
    {
        'id': 'rilievo', 'nome': 'Rilievo',
        'cosa': 'Un oggetto o un personaggio 3D disegnato come una carta topografica: sagoma nera e linee di livello grigie.',
        'ingresso': 'modello 3D (.3mf) con la vista da cui guardarlo, oppure uno screenshot del modello',
        'dettagli': [
            ('essenziale', 'sagoma e poche curve di livello levigate, circa 12; il volto resta vuoto'),
            ('medio', 'più curve di livello (circa 20) dalla stessa mappa di profondità'),
            ('dettagliato', 'ombreggiatura del modello: curve di luminosità più i tratti scuri di occhi, pieghe, bottoni'),
        ],
        'si': 'figure, mascotte, oggetti; due penne (nero per la sagoma, grigio per il rilievo)',
        'no': 'foto di persone (non c\'è un modello 3D); superfici piatte con poca profondità',
        'serve': 'file .3mf, angoli di vista (rz = giro, rx = inclinazione dall\'alto), testi sotto il disegno',
        'esempi': [
            ('Starry angel kid — essenziale', 'antei/starry angel kid cnc2d (essenziale).svg', None),
            ('Starry angel kid — dettagliato', 'antei/starry angel kid cnc2d (dettagliato).svg', None),
            ('Starboy da screenshot — dettagliato', 'antei/starboy cnc2d (dettagliato).svg', None),
            ('Starboy da screenshot — essenziale', 'antei/starboy cnc2d (essenziale).svg', None),
            ('Biglietto Feffi (portaoggetti visto dall\'alto, con testi)', 'portaoggetti-feffi/finale/biglietto-feffi-kira.cnc2d.svg', 0.5),
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
        'si': 'foto di soggetti con una figura riconoscibile su sfondo diverso; pochi sollevamenti di penna',
        'no': 'volti piccoli (con le righe larghe il volto si perde); scritte sottili',
        'serve': 'foto, ritaglio (px da togliere: su,giù,sinistra,destra), foglio',
        'esempi': [
            ('Coppia — essenziale (onde larghe)', 'foto-coppia/coppia onde larghe cnc2d.svg', None),
            ('Coppia — dettagliato', 'foto-coppia/coppia onde cnc2d.svg', None),
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
        'si': 'un effetto grafico moderno; il disegno si legge anche con pochi triangoli',
        'no': 'chi vuole pochi sollevamenti di penna: ogni lato è un segmento (lo SLICER li salda in catene)',
        'serve': 'foto, ritaglio, foglio',
        'esempi': [
            ('Coppia — leggero', 'foto-coppia/coppia poligoni (leggero) cnc2d.svg', None),
            ('Coppia — con toni', 'foto-coppia/coppia poligoni (toni) cnc2d.svg', None),
        ],
    },
    {
        'id': 'linea', 'nome': 'Linea',
        'cosa': 'Un\'icona o un logo pieni diventano una linea sola per tratto; lo spessore lo dà la penna, scelta per livello nello SLICER.',
        'ingresso': 'icona o logo pieno (immagine con inchiostro di un colore su fondo chiaro)',
        'dettagli': [
            ('regola delle scritte', 'con l\'indelebile da 1,5 mm il tratto sta DENTRO la lettera e le lettere restano separate'),
            ('due penne', 'Tratto Pen (0,5 mm) per contorni e dettagli; indelebile (1,5 mm) per scritte e tratti spessi'),
        ],
        'si': 'loghi, icone, magneti, targhette, scritte; è lo stile dei magneti della lavagna',
        'no': 'fotografie; disegni molto sfumati',
        'serve': 'immagine, dove finisce la grafica e comincia la scritta (frazione dell\'altezza), quali parti in quale penna',
        'esempi': [
            ('Tutti i magneti (foglio rifinito dall\'utente)', 'magneti/finali-utente/tutti_i_magneti.svg', 1.5),
        ],
    },
    {
        'id': 'tratti', 'nome': 'Tratti',
        'cosa': 'Tratteggio incrociato da foto (incisione).',
        'ingresso': 'foto',
        'dettagli': [('unico', 'nessun livello di dettaglio: toni a tratteggio fitto e incrociato')],
        'si': 'solo come stile da guardare',
        'no': 'sconsigliato per la macchina: migliaia di trattini corti, tanti sollevamenti, righe fitte quanto la penna. Scartato dall\'utente per questo.',
        'serve': 'foto',
        'esempi': [('Coppia', 'foto-coppia/coppia tratti cnc2d.svg', None)],
    },
]

SCHEDA = [
    ('Ingresso', 'modello 3D (.3mf) con vista · foto · screenshot · icona/logo'),
    ('Stile', 'Rilievo · Onde · Poligoni · Linea (· Tratti, sconsigliato)'),
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


def miniature(esempi, cartella):
    lavori = []
    for i, (titolo, rel, sp) in enumerate(esempi):
        lavori.append({'svg': os.path.join(QUI, rel), 'out': os.path.join(cartella, '%d.png' % i),
                       'altezza': 460, 'spessore': sp})
    r = subprocess.run(['node', 'render_png.js'], cwd=QUI, input=json.dumps(lavori), capture_output=True, text=True)
    if r.returncode:
        raise SystemExit('render_png.js: ' + r.stderr[-300:])
    return [l['out'] for l in lavori]


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
figure img{display:block;width:100%;height:280px;object-fit:contain;background:#fff;padding:8px}
figcaption{padding:10px 14px;font-size:.9rem;border-top:1px solid var(--line)}figcaption small{display:block;color:var(--mut);margin-top:2px}
ol,ul{padding-left:1.2em}li{margin:4px 0}.box{background:var(--acc2);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin-top:12px}
code{background:var(--acc2);padding:1px 6px;border-radius:6px;font-size:.88em}
"""


def pagina(blocchi_stili, dati_scheda):
    return ('<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Catalogo stili</title><style>%s</style></head><body><div class="w">'
            '<header><h1>Catalogo degli stili</h1><p>Come trasformiamo un modello 3D, una foto o un logo in un disegno per la macchina. '
            'Ogni stile ha un nome fisso: basta dirlo, con il dettaglio, per essere allineati.</p></header>'
            '<nav>%s<a href="#scheda">Scheda lavoro</a></nav>%s%s</div></body></html>' % (CSS, ''.join(
                '<a href="#%s">%s</a>' % (s['id'], s['nome']) for s in STILI), blocchi_stili, dati_scheda))


def main():
    with tempfile.TemporaryDirectory() as tmp:
        blocchi = ''
        for s in STILI:
            pngs = miniature(s['esempi'], tmp)
            fig = ''
            for (titolo, rel, _), png in zip(s['esempi'], pngs):
                b64 = base64.b64encode(open(png, 'rb').read()).decode()
                fig += ('<figure><img alt="%s" src="data:image/png;base64,%s"><figcaption>%s<small>%s</small></figcaption></figure>'
                        % (html.escape(titolo), b64, html.escape(titolo), html.escape(numeri(rel))))
            dett = ''.join('<tr><td>%s</td><td>%s</td></tr>' % (html.escape(a), html.escape(b)) for a, b in s['dettagli'])
            blocchi += (
                '<section id="%s"><h2>%s</h2><p class="lead">%s</p>'
                '<div class="meta"><div><b>Ingresso</b>%s</div><div><b>Adatto a</b>%s</div>'
                '<div class="no"><b>Meno adatto</b>%s</div><div><b>Cosa mi serve</b>%s</div></div>'
                '<h3>Livelli di dettaglio</h3><table>%s</table><h3>Esempi veri</h3><div class="gal">%s</div></section>'
                % (s['id'], s['nome'], html.escape(s['cosa']), html.escape(s['ingresso']), html.escape(s['si']),
                   html.escape(s['no']), html.escape(s['serve']), dett, fig))
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
