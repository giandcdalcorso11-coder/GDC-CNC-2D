#!/usr/bin/env python3
"""Lo STRUMENTO: una pagina dove si trascina il file, si sceglie stile e dettaglio, si scrivono le
richieste e si preme «Genera». Dietro c'e' un piccolo server che lancia lavoro.py (la stessa
generazione della scheda) e restituisce anteprima, report e SVG.

  python3 -B strumento.py                  avvia il server su http://127.0.0.1:8765
  python3 -B strumento.py --porta 9000     altra porta
  python3 -B strumento.py --host 0.0.0.0   raggiungibile da altri dispositivi della rete
  python3 -B strumento.py --build          riscrive index.html (statico, senza server)

Serve solo la libreria standard per il server; il motore chiede numpy e Pillow (e node per i testi).
Senza server la pagina funziona lo stesso, ma invece di generare prepara la scheda da mandare a Claude.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

QUI = os.path.dirname(os.path.abspath(__file__))
STAMPE = os.path.dirname(QUI)
sys.path.insert(0, STAMPE)
import catalogo  # noqa: E402
import lavoro  # noqa: E402

LAVORI = os.path.join(QUI, '_lavori')
MAX_UPLOAD = 300 * 1024 * 1024
ESTENSIONI = {'.3mf': 'modello3d', '.model': 'modello3d', '.png': 'foto', '.jpg': 'foto', '.jpeg': 'foto',
              '.webp': 'foto', '.bmp': 'foto', '.tif': 'foto', '.tiff': 'foto'}
OPZIONI = {'colori': int, 'riempimento': float, 'testo': float, 'blob': float, 'marker': float, 'sottile': str,
           'esterno': bool, 'testo_fine': bool, 'livelli': int, 'sigma': int, 'px': int, 'passo': float,
           'onda': float, 'lato': float, 'senza_toni': bool}
ANGOLI = {'rilievo': ['0:0', '-25:0', '25:0', '0:20', '-25:20', '25:20'],
          'layer': ['0:60', '0:40', '-30:45', '30:45', '0:90', '20:35']}

LAVORO_LOCK = threading.Lock()          # un lavoro alla volta: i motori usano molta memoria
JOB = {}


def config():
    return {
        'compat': lavoro.COMPATIBILE,
        'dettagli': list(lavoro.DETTAGLI),
        'stili': [{'id': s['id'], 'nome': s['nome'], 'cosa': s['cosa'], 'ingresso': s['ingresso'],
                   'sconsigliato': s['id'] == 'tratti'} for s in catalogo.STILI],
        'penne': {k: {'nome': v['nome'], 'colore': v['colore']} for k, v in lavoro.PENNE.items()},
        'angoli': ANGOLI,
    }


def pagina():
    t = open(os.path.join(QUI, 'template.html'), encoding='utf-8').read()
    return t.replace('/*CONFIG*/null', json.dumps(config(), ensure_ascii=False))


def pulito(nome):
    return re.sub(r'[^A-Za-z0-9._-]+', '_', os.path.basename(nome or 'file'))[:80] or 'file'


def num(v, lo, hi, d):
    try:
        return min(max(float(v), lo), hi)
    except (TypeError, ValueError):
        return d


def scheda_sicura(cl, percorso, uscita):
    """La scheda del client, ridotta ai campi noti: i percorsi li decide il server."""
    ing, fg = cl.get('ingresso', {}), cl.get('foglio', {})
    s = {
        'nome': pulito(cl.get('nome') or 'lavoro').rsplit('.', 1)[0],
        'ingresso': {'tipo': ing.get('tipo'), 'file': percorso},
        'stile': cl.get('stile'),
        'dettaglio': cl.get('dettaglio'),
        'foglio': {'w': num(fg.get('w'), 20, 600, 210), 'h': num(fg.get('h'), 20, 600, 148),
                   'margine': num(fg.get('margine'), 0, 40, 8)},
        'testi': [], 'opzioni': {}, 'uscita': uscita,
    }
    if isinstance(ing.get('vista'), dict):
        s['ingresso']['vista'] = {'rz': num(ing['vista'].get('rz'), -360, 360, 20), 'rx': num(ing['vista'].get('rx'), -90, 90, 10)}
    if isinstance(ing.get('ritaglio'), str) and re.fullmatch(r'\d+,\d+,\d+,\d+', ing['ritaglio']):
        s['ingresso']['ritaglio'] = ing['ritaglio']
    for t in cl.get('testi', [])[:6]:
        if str(t.get('s', '')).strip():
            s['testi'].append({'s': str(t['s'])[:60], 'base': num(t.get('base'), 5, 600, 140), 'alt': num(t.get('alt'), 2, 40, 8),
                               'penna': t.get('penna') if t.get('penna') in lavoro.PENNE else 'nero'})
    for k, tipo in OPZIONI.items():
        v = (cl.get('opzioni') or {}).get(k)
        if v is None or v == '':
            continue
        try:
            s['opzioni'][k] = True if tipo is bool and v else (tipo(v) if tipo is not bool else None)
        except (TypeError, ValueError):
            pass
    s['opzioni'] = {k: v for k, v in s['opzioni'].items() if v is not None}
    if cl.get('note'):
        s['note'] = str(cl['note'])[:2000]
    return s


def esegui_job(jid, scheda, dir_job):
    j = JOB[jid]
    j['stato'] = 'in coda'
    with LAVORO_LOCK:
        j['stato'] = 'in corso'
        j['t0'] = time.time()
        p = os.path.join(dir_job, 'scheda.json')
        json.dump(scheda, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        try:
            r = subprocess.run([sys.executable, '-B', os.path.join(STAMPE, 'lavoro.py'), p], cwd=STAMPE,
                               capture_output=True, text=True, timeout=900)
            j['log'] = (r.stdout + r.stderr).strip()
            svg = os.path.join(scheda['uscita'], scheda['nome'] + '.svg')
            if r.returncode == 0 and os.path.exists(svg):
                j['svg'] = svg
                rep = os.path.join(scheda['uscita'], 'report.txt')
                j['report'] = open(rep, encoding='utf-8').read() if os.path.exists(rep) else ''
                j['scheda'] = os.path.join(scheda['uscita'], 'scheda.json')
                j['stato'] = 'finito'
            else:
                j['stato'] = 'errore'
        except Exception as e:           # timeout o altro
            j['log'] = 'ERRORE: %s' % e
            j['stato'] = 'errore'


def esegui_viste(jid, percorso, stile, dir_job):
    j = JOB[jid]
    with LAVORO_LOCK:
        j['stato'] = 'in corso'
        try:
            with tempfile.TemporaryDirectory() as tmp:
                modello, oid, _ = lavoro.scegli_oggetto(percorso, tmp)
                png = os.path.join(dir_job, 'viste.png')
                r = subprocess.run([sys.executable, '-B', os.path.join(STAMPE, 'anteprima_viste.py'), modello, oid, png]
                                   + ANGOLI.get(stile, ANGOLI['rilievo']), cwd=STAMPE, capture_output=True, text=True, timeout=600)
            j['log'] = (r.stdout + r.stderr).strip()
            j['png'] = png if r.returncode == 0 and os.path.exists(png) else None
            j['stato'] = 'finito' if j['png'] else 'errore'
        except Exception as e:
            j['log'] = 'ERRORE: %s' % e
            j['stato'] = 'errore'


class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    def invia(self, codice, corpo, tipo='application/json', extra=None):
        if not isinstance(corpo, bytes):
            corpo = json.dumps(corpo, ensure_ascii=False).encode('utf-8') if tipo == 'application/json' else str(corpo).encode('utf-8')
        self.send_response(codice)
        self.send_header('Content-Type', tipo + ('; charset=utf-8' if tipo.startswith('text') or tipo == 'application/json' else ''))
        self.send_header('Content-Length', str(len(corpo)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(corpo)

    def file(self, percorso, tipo, scarica=None):
        if not percorso or not os.path.exists(percorso):
            return self.invia(404, {'errore': 'non trovato'})
        extra = {'Content-Disposition': 'attachment; filename="%s"' % scarica} if scarica else None
        self.invia(200, open(percorso, 'rb').read(), tipo, extra)

    def do_GET(self):
        p = self.path.split('?')[0]
        if p in ('/', '/index.html'):
            return self.invia(200, pagina().encode('utf-8'), 'text/html')
        if p == '/api/ping':
            return self.invia(200, {'ok': True})
        m = re.fullmatch(r'/api/job/([0-9a-f]{12})(?:/(svg|scheda|png))?', p)
        if m and m.group(1) in JOB:
            j = JOB[m.group(1)]
            if not m.group(2):
                dati = {k: j.get(k) for k in ('stato', 'log', 'report')}
                dati['trascorso'] = round(time.time() - j['t0']) if j.get('t0') and j['stato'] == 'in corso' else None
                dati['ha_svg'], dati['ha_png'] = bool(j.get('svg')), bool(j.get('png'))
                return self.invia(200, dati)
            if m.group(2) == 'svg':
                return self.file(j.get('svg'), 'image/svg+xml', os.path.basename(j.get('svg') or '') if 'scarica' in self.path else None)
            if m.group(2) == 'scheda':
                return self.file(j.get('scheda'), 'application/json', 'scheda.json')
            return self.file(j.get('png'), 'image/png')
        self.invia(404, {'errore': 'non trovato'})

    def corpo_json(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n).decode('utf-8')) if n else {}

    def do_POST(self):
        p = self.path.split('?')[0]
        try:
            if p == '/api/file':
                nome = pulito(self.headers.get('X-Nome'))
                ext = os.path.splitext(nome)[1].lower()
                if ext not in ESTENSIONI:
                    return self.invia(400, {'errore': 'formato non supportato (%s): .3mf, .png, .jpg, .webp' % ext})
                n = int(self.headers.get('Content-Length') or 0)
                if n <= 0 or n > MAX_UPLOAD:
                    return self.invia(400, {'errore': 'file vuoto o troppo grande (max 300 MB)'})
                fid = uuid.uuid4().hex[:12]
                d = os.path.join(LAVORI, fid)
                os.makedirs(d, exist_ok=True)
                with open(os.path.join(d, nome), 'wb') as f:
                    restano = n
                    while restano:
                        b = self.rfile.read(min(1 << 20, restano))
                        if not b:
                            break
                        f.write(b)
                        restano -= len(b)
                return self.invia(200, {'id': fid, 'nome': nome, 'tipo': ESTENSIONI[ext]})
            dati = self.corpo_json()
            fid = str(dati.get('file_id', ''))
            if not re.fullmatch(r'[0-9a-f]{12}', fid) or not os.path.isdir(os.path.join(LAVORI, fid)):
                return self.invia(400, {'errore': 'file non caricato'})
            d = os.path.join(LAVORI, fid)
            percorso = os.path.join(d, [x for x in os.listdir(d) if not x.startswith('job-')][0])
            jid = uuid.uuid4().hex[:12]
            dir_job = os.path.join(d, 'job-' + jid)
            os.makedirs(dir_job, exist_ok=True)
            JOB[jid] = {'stato': 'in coda', 'log': '', 'dir': dir_job}
            if p == '/api/genera':
                s = scheda_sicura(dati.get('scheda', {}), percorso, os.path.join(dir_job, 'out'))
                s, errori = lavoro.normalizza(s)
                if errori:
                    JOB[jid].update(stato='errore', log='La scheda ha problemi:\n- ' + '\n- '.join(errori))
                else:
                    threading.Thread(target=esegui_job, args=(jid, s, dir_job), daemon=True).start()
            elif p == '/api/viste':
                threading.Thread(target=esegui_viste, args=(jid, percorso, dati.get('stile'), dir_job), daemon=True).start()
            else:
                return self.invia(404, {'errore': 'non trovato'})
            return self.invia(200, {'job': jid})
        except Exception as e:
            return self.invia(500, {'errore': str(e)})


def main(argv):
    if '--build' in argv:
        out = os.path.join(QUI, 'index.html')
        open(out, 'w', encoding='utf-8').write(pagina())
        print('scritto', out)
        return 0
    porta = int(argv[argv.index('--porta') + 1]) if '--porta' in argv else 8765
    host = argv[argv.index('--host') + 1] if '--host' in argv else '127.0.0.1'
    os.makedirs(LAVORI, exist_ok=True)
    srv = ThreadingHTTPServer((host, porta), H)
    print('Strumento pronto: http://%s:%d  (Ctrl+C per fermarlo)' % ('127.0.0.1' if host == '0.0.0.0' else host, porta), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nfermato')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
