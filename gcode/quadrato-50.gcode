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
; GDC CNC 2D SLICER
; 1 tratti, generato dall'interfaccia
; penna alzata Z2.945, abbassata Z0.000
; a fine programma la penna sale a Z21.271 (tappo)
G21
G90
G0 Z2.945
G0 X100.616 Y93.032 F3000
G1 Z0.000 F600
G4 P0.200
G1 X150.616 Y93.032 F1200
G1 X150.616 Y143.032
G1 X100.616 Y143.032
G1 X100.616 Y93.032
G0 Z2.945
G4 P0.200
G0 X0 Y0 F3000
G0 Z21.271
M2
