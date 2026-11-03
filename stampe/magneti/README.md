# Magneti della lavagna d'allenamento

Misure: grandi **75 × 75 mm**, piccoli **75 × 25 mm**, angoli arrotondati (r ≈ 4 mm).
Tipi: verde = gioco, azzurro = ripetizione a obiettivo, arancione = costruzione,
bianco = fase (BLOCCATA / REGOLARE / ALTERNATA); i piccoli sono i parametri.

- `<nome>-quadrato.svg` — il magnete appoggiato dritto (SVG 75 × 75 mm, solo i tratti, nero).
- `<nome>-rombo.svg` — magnete ruotato di 45°, grafica dritta, dentro il quadrato inscritto
  (SVG su tavola 106 × 106 mm: il rombo ci sta centrato).
- `piccolo-*.svg` — 75 × 25 mm.
- `mockup-completo.png`, `mockup-grandi.png` — anteprime con il colore del magnete.

## Penne e livelli (dal 2026-11-03)
Ogni tratto è **una linea sola**: lo spessore lo sceglie la penna del livello nello SLICER.
- **nero `#111111`** → Tratto Pen, ~0,5 mm: contorni e dettagli sottili
- **grigio `#6b6b6b`** → indelebile, ~2 mm: scritte, anelli, tratti spessi

Nel rombo le scritte passano in Tratto Pen (a 2 mm si impastano). Nei mockup i due livelli sono
disegnati entrambi neri, con lo spessore vero di ciascuna penna.

## Come sono fatti
`vettorializza.py` (`costruisci_doppio`): una grafica piena diventa linee di mezzo (scheletro)
in due penne; solo le forme piene grandi (mattoncino, impennaggio della freccia) restano
**contorno**, in Tratto Pen. `magneti.py`: i tre colorati. `piccoli_e_bianchi.py`: i quattro piccoli
e i tre bianchi; le icone dei bianchi sono ridisegnate a mano (geometria) sul modello
dell'immagine ricevuta. Il carattere è Montserrat ExtraBold Italic (OFL), non incluso nel repo:
`python3 -B piccoli_e_bianchi.py <Montserrat-ExtraBoldItalic.ttf> . <cartella-immagini>`.
