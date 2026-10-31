# -*- coding: utf-8 -*-
"""PPM -> PNG, affiancando piu' immagini. Senza librerie: zlib e basta."""
import sys, zlib, struct

def leggi(p):
    d = open(p, 'rb').read()
    pezzi, i = [], 0
    while len(pezzi) < 4:
        while d[i:i+1].isspace(): i += 1
        if d[i:i+1] == b'#':
            while d[i:i+1] != b'\n': i += 1
            continue
        j = i
        while not d[j:j+1].isspace(): j += 1
        pezzi.append(d[i:j]); i = j
    i += 1
    w, h = int(pezzi[1]), int(pezzi[2])
    return w, h, d[i:i+w*h*3]

def png(path, w, h, righe):
    raw = b''.join(b'\x00' + r for r in righe)
    def pezzo(t, dati):
        c = t + dati
        return struct.pack('>I', len(dati)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    out = b'\x89PNG\r\n\x1a\n'
    out += pezzo(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    out += pezzo(b'IDAT', zlib.compress(raw, 9))
    out += pezzo(b'IEND', b'')
    open(path, 'wb').write(out)

def main():
    fuori = sys.argv[1]
    zoom = 1
    files = []
    for a in sys.argv[2:]:
        if a.startswith('x'): zoom = int(a[1:])
        else: files.append(a)
    cols = min(4, len(files))
    imgs = [leggi(f) for f in files]
    tw, th = imgs[0][0], imgs[0][1]
    righe_n = (len(imgs) + cols - 1) // cols
    GAP = 8
    W = cols * tw * zoom + (cols - 1) * GAP
    H = righe_n * th * zoom + (righe_n - 1) * GAP
    vuoto = b'\x20\x20\x28' * W
    out = []
    for r in range(righe_n):
        for y in range(th * zoom):
            riga = b''
            for c in range(cols):
                k = r * cols + c
                if k >= len(imgs):
                    riga += b'\x20\x20\x28' * (tw * zoom)
                else:
                    w, h, dati = imgs[k]
                    sy = y // zoom
                    linea = dati[sy*w*3:(sy+1)*w*3]
                    if zoom == 1: riga += linea
                    else:
                        riga += b''.join(linea[x*3:x*3+3] * zoom for x in range(w))
                if c < cols - 1: riga += b'\x20\x20\x28' * GAP
            out.append(riga)
        if r < righe_n - 1:
            for _ in range(GAP): out.append(vuoto)
    png(fuori, W, H, out)
    print(fuori, W, 'x', H)

main()
