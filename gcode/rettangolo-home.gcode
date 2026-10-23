; GDC CNC 2D - rettangolo 235.5 x 190 mm
;
; Da X5 Y5 a X240.5 Y195, contati dal punto ai blocchi.
; Oltre il tratto restano 0.73 mm in X e 41.06 in Y, piu i 2 mm di margine di
; sicurezza gia tolti dalla corsa percorribile. Area utile 241.232 x 236.064.
;
; IL FOGLIO: servono 235.5 x 190 mm, quindi un A4 ORIZZONTALE basta.
;
; MISURE ATTESE:
;   lati          235.5 e 190 mm
;   diagonali     302.59 mm TUTTE E DUE.
;                 Differenti = assi fuori squadra, e la leva lunga
;                 rende la misura piu severa di qualunque altra.
;
; TRATTO INTERROTTO = il piano o il portale si alzano li. La penna non
; ha molla, quindi il fuori-piano non si assorbe. Vedi
; misure/disegno-di-collaudo.md, prova 11.
;
; LE QUOTE Z SONO NEGATIVE. Z0 e la posizione tappo, in cima alla corsa;
; Z-21.271 e la punta sul foglio.
;
; PRIMA DI LANCIARE serve l origine, che NON sta in questo file:
;   $MD  -> appoggia i carrelli ai blocchi -> G92 X0 Y0 -> G90 G0 X5 Y5 F1000
;
G21
G90

; --- 1. LA PENNA. Si ferma due volte: riparti con ~ (cycle start). ---
G0 Z0
G0 X122.75 Y100 F1000
G0 Z-21.271
; FERMO: infila la penna finche la punta TOCCA il foglio, senza premere,
; e stringi i morsetti. Poi ~
M0
G0 Z-18.326
G0 Z-21.271
G0 Z-18.326
; FERMO: al centro del foglio c e un puntino. Deve segnare appena, non
; schiacciare. Se va bene ~, se no Ctrl-X e si ricomincia.
M0

; --- 2. GIRO A VUOTO DEGLI ANGOLI, penna alta e piano. ---
; Si percorre il rettangolo senza inchiostro, a velocita ridotta, per
; vedere dove arriva e che nessun carrello forzi. Se uno tocca il fondo
; o rumoreggia, Ctrl-X prima di consumare il foglio.
G0 Z0
G0 X5 Y5 F1000
G0 X240.5
G0 Y195
G0 X5
G0 Y5
; FERMO: nessun carrello ha toccato il fondo? Allora ~
M0

; --- 3. IL RETTANGOLO E LE DIAGONALI ---
G21
G90
G0 Z-18.326
X5 Y5 F3000
G1 Z-21.271 F600
G4 P0.200
X240.5 F1200
Y195
X5
Y5
G0 Z-18.326
G4 P0.200
G1 Z-21.271 F600
G4 P0.200
X240.5 Y195 F1200
G0 Z-18.326
G4 P0.200
Y5 F3000
G1 Z-21.271 F600
G4 P0.200
X5 Y195 F1200
G0 Z-18.326
G4 P0.200
Y5 F3000
Z0
M2
