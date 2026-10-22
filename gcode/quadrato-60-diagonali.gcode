; GDC CNC 2D - quadrato da 60 mm con le due diagonali
;
; Angolo in basso a sinistra a X25 Y25, opposto a X85 Y85.
; Il punto home e X5 Y5: il quadrato sta 20 mm a destra e 20 in alto
; rispetto a quello. Lo zero del G-code resta il punto ai blocchi.
;
; COSA MISURA, oltre ai quattro lati:
; - le due DIAGONALI devono essere lunghe uguali, 84.853 mm. Se una
;   e piu lunga dell altra gli assi non sono perpendicolari, e la differenza
;   dice di quanto: su 60 mm di lato, 1 mm di differenza fra le diagonali
;   vale circa 0,7 gradi di fuori squadra.
; - devono incrociarsi nel CENTRO, a X55 Y55. Un incrocio
;   spostato con diagonali uguali e un problema di scala di un asse, non
;   di squadra.
;
; LE QUOTE Z SONO NEGATIVE. Z0 e la posizione tappo, in cima alla corsa;
; Z-21.271 e la punta sul foglio. Un file con la penna a Z0 non disegna.
; GDC CNC 2D SLICER
; 3 tratti, generato dall'interfaccia
; penna alzata Z-18.326, abbassata Z-21.271
; a fine programma la penna sale a Z0 (tappo)
; a fine programma la testina torna al punto home X5 Y5, non sullo zero ai blocchi
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
G1 Z-21.271 F600
G4 P0.200
X85 Y85 F1200
G0 Z-18.326
G4 P0.200
Y25 F3000
G1 Z-21.271 F600
G4 P0.200
X25 Y85 F1200
G0 Z-18.326
G4 P0.200
X5 Y5 F3000
Z0
M2
