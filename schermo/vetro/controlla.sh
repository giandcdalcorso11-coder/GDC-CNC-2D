#!/bin/bash
# Tutto quello che del firmware si puo' controllare senza la scheda.
#   1. i prototipi come li infila l'IDE di Arduino (e' la' che casca)
#   2. sintassi e nomi, con g++ contro le intestazioni finte
#   3. la geometria del vetro, letta dal sorgente: ogni parola dentro al
#      cerchio libero e nessuna addosso a un'altra
set -e
cd "$(dirname "$0")"
mkdir -p fuori
echo "--- prototipi come li genera l'IDE ---"
python3 prototipi.py ../telecomando/telecomando.ino fuori/telecomando_copia.ino
echo "--- sintassi e nomi (g++ -Wall -Wextra) ---"
g++ -std=c++17 -fsyntax-only -Wall -Wextra -I finto -I fuori finto/prova.cpp && echo "pulito"
echo "--- geometria del vetro, letta dal sorgente ---"
python3 geometria.py
