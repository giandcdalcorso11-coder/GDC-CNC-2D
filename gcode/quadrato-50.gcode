; GDC CNC 2D - quadrato di verso e scala, 50 x 50 mm
; PRIMA STAMPA dopo FluidNC: non il collaudo. Serve a tre cose.
;
; 1. IL VERSO. Il primo tratto va verso +X e deve muovere IL CARRELLO LUNGO
;    LA TRAVE, da sinistra a destra. Il secondo va verso +Y e deve muovere
;    TUTTO IL PORTALE, verso il fondo. Se uno dei due va al contrario, il
;    colpevole e direction_pin di quell asse nel config.yaml.
; 2. LA PENNA. Deve segnare per tutto il perimetro, senza buchi e senza
;    sbavare agli angoli.
; 3. LA CHIUSURA. L ultimo tratto deve tornare esattamente dove e partito.
;
; Angolo di partenza a X100.616 Y93.032, centrato nell area percorribile.
; Misurato col calibro, il lato dice anche quanto sbaglia il rapporto:
; lato_vero / 50 e il fattore da applicare ai mm per giro ingranaggio.
;
; LE QUOTE Z SONO NEGATIVE. Senza homing FluidNC mette lo zero macchina in
; cima alla corsa del servo: Z0 e la posizione tappo, Z-21.271 il foglio.
; Un file con la penna a Z0 non disegna: resta in alto per tutto il giro.
; GDC CNC 2D SLICER
; 1 tratti, generato dall'interfaccia
; penna alzata Z-18.326, abbassata Z-21.271
; a fine programma la penna sale a Z0 (tappo)
; a fine programma la testina torna al punto home X5 Y5, non sullo zero ai blocchi
G21
G90
G0 Z-18.326
X100.616 Y93.032 F3000
G1 Z-21.271 F600
G4 P0.200
X150.616 F1200
Y143.032
X100.616
Y93.032
G0 Z-18.326
G4 P0.200
X5 Y5 F3000
Z0
M2
