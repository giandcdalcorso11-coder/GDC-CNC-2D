#!/usr/bin/env python3
"""
Trascrive e rinomina automaticamente i voice over registrati col telefono.

Uso:
  python 000-rinomina_voiceover.py <cartella>            elabora una volta i file nuovi
  python 000-rinomina_voiceover.py <cartella> --watch    resta in ascolto e elabora ogni nuovo file

Richiede: pip install faster-whisper

I file audio vengono rinominati sul posto (non spostati, non duplicati), con
un numero progressivo a 3 cifre davanti (es. 006-oggi-monto-il-carrello.mp4)
per mantenere l'ordine cronologico anche se i nomi, in ordine alfabetico,
si mischierebbero. Il numero successivo si ricava dal più alto già scritto
in 000-elaborati.json (lo storico delle rinomine già fatte dallo script) o,
se più alto, da quello già presente nella cartella — così continua a
salire anche se sposti o archivi altrove i file già rinominati (es. in una
sottocartella per episodio finito), senza bisogno di un file contatore a
parte.

Un file che ha gia' il prefisso numerico NNN- non viene MAI piu' ritoccato,
indipendentemente da cosa dice 000-elaborati.json: e' quel prefisso stesso
a fare da prova "gia' fatto", non solo lo storico. Questo evita che un file
gia' a posto (magari gia' in una timeline di Resolve) venga rinominato di
nuovo se lo storico si disallinea per qualche motivo (es. un conflitto di
sincronizzazione OneDrive sulla cartella). Se vuoi far ritrascrivere un file
gia' numerato, togli tu a mano il prefisso NNN- dal nome prima di rilanciare.

Per ognuno viene creato un file .txt con la trascrizione integrale.
Lo storico delle rinomine (nome originale -> nuovo nome, data/ora) resta in
000-elaborati.json; 000-log-trascrizioni.csv tiene lo stesso storico in
formato apribile con Excel, con anche il testo trascritto.
"""
import argparse
import json
import re
import time
from datetime import datetime
from pathlib import Path

AUDIO_EXT = {".m4a", ".mp3", ".wav", ".aac", ".ogg", ".opus", ".flac", ".caf", ".mp4"}
LOG_NAME = "000-log-trascrizioni.csv"
PROCESSED_NAME = "000-elaborati.json"
MAX_WORDS = 10
MAX_LEN = 60
NUM_DIGITS = 3
NUM_PATTERN = re.compile(r"^(\d{%d})-" % NUM_DIGITS)


def slugify(text, max_words=MAX_WORDS, max_len=MAX_LEN):
    words = re.findall(r"[A-Za-zÀ-ÿ0-9]+", text.lower())[:max_words]
    slug = "-".join(words)
    return slug[:max_len].rstrip("-") or "senza-testo"


def highest_number_in_folder(src_dir):
    max_n = 0
    for f in src_dir.iterdir():
        if f.is_file():
            m = NUM_PATTERN.match(f.name)
            if m:
                max_n = max(max_n, int(m.group(1)))
    return max_n


def highest_number_in_history(processed):
    max_n = 0
    for entry in processed.values():
        m = NUM_PATTERN.match(entry.get("rinominato_in", ""))
        if m:
            max_n = max(max_n, int(m.group(1)))
    return max_n


def next_number(src_dir, processed):
    return max(highest_number_in_folder(src_dir), highest_number_in_history(processed)) + 1


def load_model():
    from faster_whisper import WhisperModel
    return WhisperModel("small", device="cpu", compute_type="int8")


def transcribe(model, path):
    segments, _ = model.transcribe(str(path), language="it")
    return " ".join(seg.text.strip() for seg in segments).strip()


def process_file(model, src, number, log_path):
    text = transcribe(model, src)
    slug = slugify(text)
    base = f"{number:0{NUM_DIGITS}d}-{slug}"
    dest = src.with_name(f"{base}{src.suffix.lower()}")
    i = 2
    while dest.exists():
        dest = src.with_name(f"{base}-{i}{src.suffix.lower()}")
        i += 1
    original_name = src.name
    src.rename(dest)
    dest.with_suffix(".txt").write_text(text, encoding="utf-8")
    with open(log_path, "a", encoding="utf-8", newline="") as f:
        safe_text = text.replace('"', "'")
        f.write(f'"{original_name}";"{dest.name}";"{safe_text}"\n')
    print(f"{original_name}  ->  {dest.name}")
    return original_name, dest.name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cartella")
    ap.add_argument("--watch", action="store_true", help="resta in ascolto su nuovi file")
    args = ap.parse_args()

    src_dir = Path(args.cartella)
    processed_path = src_dir / PROCESSED_NAME
    log_path = src_dir / LOG_NAME
    if not log_path.exists():
        log_path.write_text('"file originale";"file rinominato";"trascrizione"\n', encoding="utf-8")

    raw = json.loads(processed_path.read_text()) if processed_path.exists() else {}
    processed = raw if isinstance(raw, dict) else {}

    print("Carico il modello di trascrizione (la prima volta scarica il modello, poi resta in cache)...")
    model = load_model()

    def scan_once():
        changed = False
        counter = next_number(src_dir, processed)
        for f in sorted(src_dir.iterdir()):
            if (
                f.is_file()
                and f.suffix.lower() in AUDIO_EXT
                and not NUM_PATTERN.match(f.name)
                and f.name not in processed
            ):
                try:
                    original_name, new_name = process_file(model, f, counter, log_path)
                    processed[original_name] = {
                        "rinominato_in": new_name,
                        "quando": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    }
                    counter += 1
                    changed = True
                except Exception as e:
                    print(f"Errore su {f.name}: {e}")
        if changed:
            processed_path.write_text(
                json.dumps(processed, ensure_ascii=False, indent=2), encoding="utf-8"
            )

    scan_once()

    if args.watch:
        print(f"In ascolto su {src_dir} — lascia questa finestra aperta, Ctrl+C per fermare.")
        try:
            while True:
                time.sleep(5)
                scan_once()
        except KeyboardInterrupt:
            print("Fermato.")


if __name__ == "__main__":
    main()
