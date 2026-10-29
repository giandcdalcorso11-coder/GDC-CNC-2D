#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rilegge gli schemi Altium del MKR IoT Carrier Rev2.

Da qui vengono i numeri della tabella dei cinque tasti nel README, e vale la
pena poterli rifare invece di fidarsi: una tabella copiata a mano, fra un
mese, non si distingue da una tabella indovinata.

I file li pubblica Arduino nella pagina della scheda (`MKR.SchDoc`,
`DISPLAY.SchDoc`, `CAPACITIVE_SENSOR.SchDoc`, `BUZZER.SchDoc` e
`IoT_StarterKit_Carrier.PcbDoc`). Si passa la cartella che li contiene:

    python3 leggi-schemi.py ~/Downloads/carrier-rev2

Sono documenti OLE con dentro record a `|CHIAVE=valore`. Lo schematico li
tiene in chiaro; il PcbDoc tiene i primitivi in binario, e di quelli qui
serve solo la piazzola: nel suo blocco principale il numero di rete sta a
due byte dall'inizio +3, il componente +7, e le coordinate a +13 e +17, in
decimillesimi di mil. Non si cammina il file in sequenza (i record non hanno
tutti la stessa forma e si perde il passo): si prova ogni posizione e si
tiene quello che sta in scheda, con rete e componente che esistono.
"""
import sys, os, re, struct, math

try:
    import olefile
except ImportError:
    sys.exit('serve olefile:  pip install olefile')

MIL = 0.0254          # un mil in millimetri


def blocchi(stream):
    """I record di uno stream Altium: 4 byte di lunghezza, poi il record."""
    d, i, out = stream.read(), 0, []
    while i + 4 <= len(d):
        n = struct.unpack('<I', d[i:i + 4])[0]
        i += 4
        out.append(d[i:i + n])
        i += n
    return out


def campo(testo, chiave):
    m = re.search(r'\|' + chiave + r'=([^|]*)', testo)
    return m.group(1) if m else ''


def schematico(path):
    """Componenti e etichette di rete di uno .SchDoc."""
    d = open(path, 'rb').read().decode('latin-1')
    righe = [r for r in re.split(r'[\x00-\x08\x0b-\x1f]+', d) if r.startswith('|RECORD=')]
    comp, etich = [], []
    for r in righe:
        t = campo(r, 'RECORD')
        if t == '1':
            comp.append((campo(r, 'LibReference'), campo(r, 'ComponentDescription'),
                         float(campo(r, 'Location.X') or 0)))
        elif t == '25':
            etich.append((campo(r, 'Text'), float(campo(r, 'Location.X') or 0)))
    return comp, etich


def pcb(path):
    f = olefile.OleFileIO(path)
    reti = [campo(r.decode('latin-1'), 'NAME') for r in blocchi(f.openstream('Nets6/Data'))]
    comp, pos = [], {}
    for r in blocchi(f.openstream('Components6/Data')):
        r = r.decode('latin-1')
        des = campo(r, 'SOURCEDESIGNATOR')
        comp.append(des)
        if des:
            pos[des] = (float(campo(r, 'X').replace('mil', '')) * MIL,
                        float(campo(r, 'Y').replace('mil', '')) * MIL,
                        campo(r, 'LAYER'))
    piazzole = set()
    d = f.openstream('Pads6/Data').read()
    for j in range(len(d) - 24):
        if not 1 <= d[j] <= 82:
            continue
        rete = struct.unpack_from('<H', d, j + 3)[0]
        c = struct.unpack_from('<H', d, j + 7)[0]
        if rete >= len(reti) or c >= len(comp):
            continue
        x = struct.unpack_from('<i', d, j + 13)[0] * MIL / 10000
        y = struct.unpack_from('<i', d, j + 17)[0] * MIL / 10000
        if not (250 < x < 334 and 308 < y < 394):
            continue
        piazzole.add((comp[c], reti[rete], round(x, 2), round(y, 2)))
    poligoni = []
    for r in blocchi(f.openstream('Polygons6/Data')):
        r = r.decode('latin-1')
        v = [(float(a) * MIL, float(b) * MIL) for a, b in
             re.findall(r'\|VX\d+=(-?[\d.]+)mil\|VY\d+=(-?[\d.]+)mil', r)]
        if not v:
            continue
        n = int(re.sub(r'\D', '', campo(r, 'NET')) or -1)
        poligoni.append((reti[n] if 0 <= n < len(reti) else '',
                         sum(p[0] for p in v) / len(v), sum(p[1] for p in v) / len(v)))
    return reti, pos, piazzole, poligoni


def main(cartella):
    def trova(fine):
        for n in sorted(os.listdir(cartella)):
            if n.endswith(fine):
                return os.path.join(cartella, n)
        sys.exit('manca un file che finisce per ' + fine)

    reti, pos, piazzole, poligoni = pcb(trova('.PcbDoc'))

    # Il centro del cerchio su cui stanno i cinque LED. NON la loro media: i
    # cinque non circondano il centro (in basso non c'e' niente), quindi la
    # media sta alta di quattro millimetri e tutti gli angoli vengono storti.
    # Si cerca il cerchio che passa per i cinque, ai minimi quadrati:
    # x^2 + y^2 = a x + b y + c ha il centro in (a/2, b/2) e si risolve con
    # le equazioni normali di un sistema 3x3.
    led = {k: pos[k] for k in ('DL4', 'DL5', 'DL6', 'DL7', 'DL8')}
    P = [(v[0], v[1]) for v in led.values()]
    A = [[x, y, 1.0] for x, y in P]
    z = [x * x + y * y for x, y in P]
    N = [[sum(A[i][r] * A[i][c] for i in range(len(P))) for c in range(3)] + 
         [sum(A[i][r] * z[i] for i in range(len(P)))] for r in range(3)]
    for i in range(3):                       # eliminazione di Gauss
        q = max(range(i, 3), key=lambda k: abs(N[k][i]))
        N[i], N[q] = N[q], N[i]
        for k in range(3):
            if k != i:
                f = N[k][i] / N[i][i]
                N[k] = [a - f * b for a, b in zip(N[k], N[i])]
    sol = [N[i][3] / N[i][i] for i in range(3)]
    cx, cy = sol[0] / 2, sol[1] / 2
    raggi = [math.hypot(x - cx, y - cy) for x, y in P]
    print('centro dei cinque LED: (%.2f, %.2f) mm, raggio %.2f mm '
          '(scarto max %.2f)' % (cx, cy, sum(raggi) / 5,
                                 max(abs(r - sum(raggi) / 5) for r in raggi)))

    print('\npad capacitivi (poligoni di rame) e LED, in gradi:')
    ang = lambda x, y: (math.degrees(math.atan2(y - cy, x - cx)) + 360) % 360
    pad = {}
    for rete, x, y in poligoni:
        m = re.match(r'TOUCH_Y(\d)', rete)
        if m:
            pad[int(m.group(1))] = ang(x, y)
    for k in sorted(pad):
        dl = 'DL%d' % (4 + k)
        print('  TOUCH%d  pad a %6.1f gradi   %s a %6.1f gradi'
              % (k, pad[k], dl, ang(led[dl][0], led[dl][1])))
    g = sorted(pad.values())
    salti = [round(g[i] - g[i - 1] if i else g[0] + 360 - g[-1], 1) for i in range(5)]
    print('  salti fra un pad e il successivo: %s gradi' % ' '.join('%.0f' % s for s in salti))
    print('  (gradi in coordinate scheda: 90 = in alto. Le posizioni sono')
    print('   simmetriche, quindi guardare la scheda dalla faccia dei pad')
    print('   scambia destra e sinistra ma lascia il 2 in alto.)')

    # Dal pad al piedino: la resistenza di serie ha una piazzola sulla rete
    # del pad e una sulla rete che va allo zoccolo del MKR.
    print('\ndal pad al piedino del MKR:')
    mkr = {}
    for d_, rete, x, y in piazzole:
        if d_ == 'MKR1':
            mkr[rete] = (x, y)
    nome = {'PA03_VREFA': 'AREF', 'GROVE_AN0_1': 'A0 (libero, sul Grove)',
            'PB02_AIN10': 'A1', 'PB03_AIN11': 'A2', 'PA04_AIN4': 'A3',
            'PA05_AIN5': 'A4', 'PA06_AIN6': 'A5', 'GROVE_AN6_1': 'A6 (libero, sul Grove)'}
    for r in ('R33', 'R34', 'R35', 'R36', 'R37'):
        su = {rete for d_, rete, x, y in piazzole if d_ == r}
        p = [s for s in su if s.startswith('TOUCH_Y')]
        a = [s for s in su if s in mkr]
        if p and a:
            print('  %s: %-12s -> %-12s = %s' % (r, p[0], a[0], nome.get(a[0], a[0])))

    # La catena degli APA102: chi ha il dato in ingresso e' il primo.
    print('\ncatena dei LED (il dato entra dove arriva LEDSDI):')
    for r in ('LEDSDI_1', 'SDO0_4', 'SDO1_4', 'SDO2_4', 'SDO3_4'):
        chi = sorted({d_ for d_, rete, x, y in piazzole if rete == r and d_.startswith('DL')})
        print('  %-10s %s' % (r, ' -> '.join(chi)))

    print('\nla batteria non arriva allo zoccolo:')
    print('  VBAT tocca:', ', '.join(sorted({d_ for d_, rete, x, y in piazzole
                                             if rete.startswith('VBAT') and d_})))

    comp, etich = schematico(trova('BUZZER.SchDoc'))
    print('\nil cicalino:')
    for lib, desc, x in comp:
        print('  %-12s %s' % (lib, desc))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
