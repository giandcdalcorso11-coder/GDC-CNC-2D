/* Miniature PNG di SVG, per il catalogo. Legge da stdin un JSON
 * [{svg, out, altezza, spessore}] (altezza in px; spessore in mm: se c'e', forza lo spessore
 * dei tratti, utile per gli SVG dello SLICER che disegnano a 0,3 mm). */
const { chromium } = require('playwright');
const fs = require('fs');
let buf = '';
process.stdin.on('data', d => buf += d);
process.stdin.on('end', async () => {
  const lavori = JSON.parse(buf);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  for (const l of lavori) {
    let t = fs.readFileSync(l.svg, 'utf8').replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<metadata[\s\S]*?<\/metadata>/g, '');
    const css = 'body{margin:0;background:#fff}svg{display:block;height:' + l.altezza + 'px;width:auto}' +
      (l.spessore ? 'g{stroke-width:' + l.spessore + ' !important}' : '');
    await p.setContent('<style>' + css + '</style>' + t);
    const el = await p.$('svg');
    await el.screenshot({ path: l.out });
  }
  await b.close();
});
