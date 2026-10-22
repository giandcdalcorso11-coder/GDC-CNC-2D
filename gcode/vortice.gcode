; GDC CNC 2D - vortice di quadrati
;
; 18 quadrati, ognuno con i vertici al 16% dei lati del precedente.
; Il lato si accorcia di 0.8551 e la figura ruota di 10.78 gradi a ogni passo,
; da 150.00 mm fino a 10.48 mm.
;
; AL CENTRO UN CERCHIO, non i quadrati piu piccoli. Fra due quadrati
; consecutivi i lati distano lato x (1 - rapporto) / 2: all ultimo passo
; sono 0.76 mm, cioe ancora leggibili con una penna da 0,35.
; Un quadrato in piu li porterebbe a 0.65 e i tratti si impasterebbero.
; Quindi li si smette e si disegna la circonferenza INSCRITTA nell ultimo
; quadrato, raggio 5.24 mm, che lo tocca nei punti medi dei lati.
; Ci si entra dal punto medio del lato appena disegnato, quindi il cerchio
; parte TANGENTE e sempre a penna giu: spezzata di 30 lati.
;
; IL VORTICE E UNA LINEA SOLA: la penna non si stacca mai. Il passaggio da
; un quadrato al successivo cade su un lato appena disegnato, quindi si fa
; ripassandoci sopra. Per questo la CHIUSURA misura l errore accumulato su
; tutto il percorso: nessuna alzata lo nasconde.
;
; COSA GUARDARE:
; - la SIMMETRIA. Il vortice e il suo stesso riferimento: un errore che
;   dipende dalla direzione lo fa andare storto, e si vede a occhio senza
;   misurare niente.
; - il CENTRO. Fra l ultimo quadrato e il cerchio inscritto restano 0.76 mm
;   di bianco, cioe due larghezze di tratto: e la il margine piu stretto
;   del disegno, e si legge con la lente. Se li i tratti si toccano, il
;   tratto e piu grosso di quanto il profilo assume.
; - il lato esterno, col calibro: 150.00 mm, e le due diagonali
;   del quadrato esterno uguali fra loro (212.13 mm).
;
; Composizione da X25.00 Y25.00 a X175.00 Y192.00, punto home X5 Y5.
; Disegno 4187 mm a 1200 mm/min.
;
; LE QUOTE Z SONO NEGATIVE. Z0 e la posizione tappo, in cima alla corsa;
; Z-21.271 e la punta sul foglio.
; GDC CNC 2D SLICER
; 9 tratti, generato dall'interfaccia
; penna alzata Z-18.326, abbassata Z-21.271
; a fine programma la penna sale a Z0 (tappo)
; a fine programma la testina torna al punto home X5 Y5, non sullo zero ai blocchi
G21
G90
G0 Z-18.326
X25 Y42 F3000
G1 Z-21.271 F600
G4 P0.200
X175 F1200
Y192
X25
Y42
X49
X175 Y66
X151 Y192
X25 Y168
X49 Y42
X69.16 Y45.84
X171.16 Y86.16
X130.84 Y188.16
X28.84 Y147.84
X69.16 Y45.84
X85.48 Y52.291
X164.709 Y102.48
X114.52 Y181.709
X35.291 Y131.52
X85.48 Y52.291
X98.157 Y60.321
X156.679 Y115.157
X101.843 Y173.679
X43.321 Y118.843
X98.157 Y60.321
X107.52 Y69.095
X147.905 Y124.52
X92.48 Y164.905
X52.095 Y109.48
X107.52 Y69.095
X113.982 Y77.963
X139.037 Y130.982
X86.018 Y156.037
X60.963 Y103.018
X113.982 Y77.963
X117.991 Y86.446
X130.554 Y134.991
X82.009 Y147.554
X69.446 Y99.009
X117.991 Y86.446
X120.001 Y94.213
X122.787 Y137.001
X79.999 Y139.787
X77.213 Y96.999
X120.001 Y94.213
X120.446 Y101.059
X115.941 Y137.446
X79.554 Y132.941
X84.059 Y96.554
X120.446 Y101.059
X119.726 Y106.881
X110.119 Y136.726
X80.274 Y127.119
X89.881 Y97.274
X119.726 Y106.881
X118.188 Y111.656
X105.344 Y135.188
X81.812 Y122.344
X94.656 Y98.812
X118.188 Y111.656
X116.133 Y115.421
X101.579 Y133.133
X83.867 Y118.579
X98.421 Y100.867
X116.133 Y115.421
X113.805 Y118.255
X98.745 Y130.805
X86.195 Y115.745
X101.255 Y103.195
X113.805 Y118.255
X111.395 Y120.263
X96.737 Y128.395
X88.605 Y113.737
X103.263 Y105.605
X111.395 Y120.263
X109.05 Y121.564
X95.436 Y126.05
X90.95 Y112.436
X104.564 Y107.95
X109.05 Y121.564
X106.871 Y122.282
X94.718 Y123.871
X93.129 Y111.718
X105.282 Y110.129
X106.871 Y122.282
X104.927 Y122.536
X94.464 Y121.927
X95.073 Y111.464
X105.536 Y112.073
X104.927 Y122.536
X99.695 Y122.232
X98.614 Y122.054
X97.594 Y121.655
X96.678 Y121.053
X95.908 Y120.274
X95.317 Y119.352
X94.93 Y118.327
X94.765 Y117.244
X94.829 Y116.15
X95.119 Y115.094
X95.622 Y114.12
X96.316 Y113.273
X97.171 Y112.588
X98.15 Y112.097
X99.21 Y111.819
X100.305 Y111.768
X101.386 Y111.946
X102.406 Y112.345
X103.322 Y112.947
X104.092 Y113.726
X104.683 Y114.648
X105.07 Y115.673
X105.235 Y116.756
X105.171 Y117.85
X104.881 Y118.906
X104.378 Y119.88
X103.684 Y120.727
X102.829 Y121.412
X101.85 Y121.903
X100.79 Y122.181
X99.695 Y122.232
G0 Z-18.326
G4 P0.200
X81.7 Y29.2 F3000
G1 Z-21.271 F600
G4 P0.200
X80.7 Y30 F1200
X79.7
X78.7 Y29
Y26
X79.7 Y25
X80.7
X81.7 Y26
Y27.2
X80.5
G0 Z-18.326
G4 P0.200
X83.1 Y25 F3000
G1 Z-21.271 F600
G4 P0.200
Y30 F1200
X85.1
X86.1 Y29
Y26
X85.1 Y25
X83.1
G0 Z-18.326
G4 P0.200
X90.5 Y29.2 F3000
G1 Z-21.271 F600
G4 P0.200
X89.5 Y30 F1200
X88.5
X87.5 Y29
Y26
X88.5 Y25
X89.5
X90.5 Y25.8
G0 Z-18.326
G4 P0.200
X99.3 Y29.2 F3000
G1 Z-21.271 F600
G4 P0.200
X98.3 Y30 F1200
X97.3
X96.3 Y29
Y26
X97.3 Y25
X98.3
X99.3 Y25.8
G0 Z-18.326
G4 P0.200
X100.7 Y25 F3000
G1 Z-21.271 F600
G4 P0.200
Y30 F1200
X103.7 Y25
Y30
G0 Z-18.326
G4 P0.200
X108.1 Y29.2 F3000
G1 Z-21.271 F600
G4 P0.200
X107.1 Y30 F1200
X106.1
X105.1 Y29
Y26
X106.1 Y25
X107.1
X108.1 Y25.8
G0 Z-18.326
G4 P0.200
X113.9 Y29 F3000
G1 Z-21.271 F600
G4 P0.200
X114.9 Y30 F1200
X115.9
X116.9 Y29
Y28
X113.9 Y25
X116.9
G0 Z-18.326
G4 P0.200
X118.3 F3000
G1 Z-21.271 F600
G4 P0.200
Y30 F1200
X120.3
X121.3 Y29
Y26
X120.3 Y25
X118.3
G0 Z-18.326
G4 P0.200
X5 Y5 F3000
Z0
M2
