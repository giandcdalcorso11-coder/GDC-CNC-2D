; GDC CNC 2D - quadrato da 60 mm, angolo a X25 Y25
; Il punto home e X5 Y5: questo quadrato sta 20 mm a destra
; e 20 mm in alto rispetto a quello, e arriva a X85 Y85.
; Lo zero del G-code resta il punto ai blocchi, non il punto home.
;
; Da controllare col calibro: i QUATTRO lati, uno per uno. Sul quadrato da
; 50 mm i due lati in direzione negativa (il terzo e il quarto) venivano
; corti; se succede di nuovo, il numero di ogni lato dice di quanto.
;
; LE QUOTE Z SONO NEGATIVE. Z0 e la posizione tappo, in cima alla corsa;
; Z-21.271 e la punta sul foglio. Un file con la penna a Z0 non disegna.
; GDC CNC 2D SLICER
; 1 tratti, generato dall'interfaccia
; penna alzata Z-18.326, abbassata Z-21.271
; a fine programma la penna sale a Z0 (tappo)
G21
G90
G0 Z-18.326
X25 Y25 F3000
G1 Z-21.271 F600
G4 P0.200
X85 F1200
Y85
X25
Y25
G0 Z-18.326
G4 P0.200
X0 Y0 F3000
Z0
M2
