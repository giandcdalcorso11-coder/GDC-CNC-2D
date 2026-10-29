# Stampe

Progetti da stampare per l'utente (biglietti, magneti...). Ogni progetto ha la sua
cartella: gli script che generano il disegno, le bozze e il file finale.

## Stile «Rilievo»

Il modo di disegnare un oggetto 3D con una penna sola o due: **linee di livello a
quota costante**, come una carta topografica. È lo stile di `gcode/figli.svg` e del
biglietto per Feffi.

**Ricetta:**
- **Oggetto:** un `.3mf`/modello 3D, proiettato da una vista scelta (angoli `rz`, `rx` in
  `viste.py`, funzione `vista_quota`).
- **Penna nera (`#111`, 0,35 mm):** la sagoma.
- **Penna grigia (`#8a8a8a`, 0,3 mm):** le linee di livello, una ogni **3 mm** di altezza
  del modello, levigate così il pelo e il rumore non diventano grovigli.
- **Testi:** font a tratto singolo della macchina (`webui/js/font-tratto.js`): nome in nero,
  dedica in grigio più piccola.
- **Niente logo GDC:** lo aggiunge l'utente dallo SLICER.
- Un solo SVG, i due colori diventano due livelli nello SLICER.

Esempio: `portaoggetti-feffi/` (`viste.py` → `viste.json` → `componi.js`; il file
definitivo ritoccato dall'utente è in `finale/`).

Per rifarlo su un altro oggetto: dare il file 3D, il formato del foglio, i testi e la vista.
