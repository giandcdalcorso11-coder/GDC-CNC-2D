/* La rete di casa. Questo file è l'unico da riempire prima di caricare.
 *
 * Sta a parte per un motivo solo: così lo sketch si può mandare in giro,
 * incollare in una chat o mettere in un repository senza portarsi dietro la
 * password del WiFi. Se un giorno il progetto finisse su GitHub, questo è il
 * file da NON metterci.
 *
 * La rete dev'essere la STESSA del portatile che fa girare il SLICER: il
 * SLICER chiama il telecomando per indirizzo IP, e due reti diverse non si
 * vedono. A 5 GHz il MKR WiFi 1010 non si collega: è una scheda 2,4 GHz, e
 * se il router ha un nome solo per le due bande può servire separarle.
 */

#define SEGRETO_SSID     "la-tua-rete"
#define SEGRETO_PASSWORD "la-tua-password"
