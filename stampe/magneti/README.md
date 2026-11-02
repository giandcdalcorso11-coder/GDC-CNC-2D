# Magneti della lavagna d'allenamento

Misure: grandi **75 × 75 mm**, piccoli **75 × 25 mm**, angoli arrotondati (r ≈ 4 mm).
Tipi: verde = gioco, azzurro = ripetizione a obiettivo, arancione = costruzione,
bianco = fase (BLOCCATA / REGOLARE / ALTERNATA); i piccoli sono i parametri.

- `<nome>-quadrato.svg` — il magnete appoggiato dritto (SVG 75 × 75 mm, solo i tratti, nero).
- `<nome>-rombo.svg` — magnete ruotato di 45°, grafica dritta, dentro il quadrato inscritto
  (SVG su tavola 106 × 106 mm: il rombo ci sta centrato).
- `piccolo-*.svg` — 75 × 25 mm.
- `mockup-completo.png`, `mockup-grandi.png` — anteprime con il colore del magnete.

## Come sono fatti
`vettorializza.py`: una grafica piena diventa tratti per una penna sola. Le parti spesse
(lettere, anelli) diventano il **contorno**; quelle sottili (giocatori, rete) la **linea di
mezzo** (scheletro). `magneti.py`: i tre colorati. `piccoli_e_bianchi.py`: i quattro piccoli
e i tre bianchi; le icone dei bianchi sono ridisegnate a mano (geometria) sul modello
dell'immagine ricevuta. Il carattere è Montserrat ExtraBold Italic (OFL), non incluso nel repo:
`python3 -B piccoli_e_bianchi.py <Montserrat-ExtraBoldItalic.ttf> . <cartella-immagini>`.
