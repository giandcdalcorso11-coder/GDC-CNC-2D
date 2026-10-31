#!/bin/bash
# IL VETRO DISEGNATO QUI INVECE CHE SULLA SCHEDA.
#
# Compila il firmware VERO contro un finto display che scrive in memoria e
# salva una immagine per schermata, piu' un confronto ingrandito del bordo
# dell'anello. Serve a guardare quello che il telecomando disegnera' PRIMA
# di caricarglielo. Vedi schermo/README.md, «Il vetro disegnato qui dentro».
set -e
cd "$(dirname "$0")"
mkdir -p fuori
python3 prototipi.py ../telecomando/telecomando.ino fuori/telecomando_copia.ino
g++ -std=c++17 -O2 -w -I finto -I fuori -o fuori/vetro vetro.cpp
( cd fuori && ./vetro )
python3 ppm2png.py fuori/schermate.png x2 \
  fuori/stampa.ppm fuori/pausa.ppm fuori/penna1.ppm fuori/penna2.ppm \
  fuori/pronta.ppm fuori/armato.ppm fuori/tieni.ppm fuori/fine.ppm \
  fuori/attesa.ppm fuori/errore.ppm fuori/stampa-94.ppm fuori/armato-meta.ppm \
  fuori/pronta-carica.ppm fuori/attesa-carica.ppm
echo "le schermate: schermo/vetro/fuori/schermate.png"
