/**
 * Adds Tucker's lettering to a generated scene: "tucker." on the name patch and the
 * "t." mark on the cap's front panel. Uses the vector logo files (never generated text),
 * blended into the fabric so it reads as stitched.
 * Usage: node brand-scene.cjs <scene.jpg> <out.jpg> '<json placements>'
 *   placements: { cap: {x, y, h, rot}, patch: {x, y, w, rot} }  (scene pixels; x,y = centre)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [, , input, output, json] = process.argv;
const P = JSON.parse(json);
const ROOT = path.resolve(__dirname, '../../../..');
const svg = (f, letters, nose) =>
  fs.readFileSync(path.join(ROOT, 'brand/assets', f), 'utf8').replace('fill="#101828"', `fill="${letters}"`).replace(/fill="#EE6A24"/g, `fill="${nose}"`);

(async () => {
  const b = await chromium.launch();
  const img = 'data:image/jpeg;base64,' + fs.readFileSync(input).toString('base64');
  const p = await b.newPage({ viewport: { width: 1856, height: 2304 }, deviceScaleFactor: 1 });
  const stitch = 'mix-blend-mode:multiply;filter:blur(.45px) drop-shadow(0 1px 0 rgba(255,255,255,.35));opacity:.92';
  await p.setContent(`<body style="margin:0;width:1856px;height:2304px;position:relative;background:url(${img}) 0 0/1856px 2304px no-repeat">
    ${P.cap ? `<div style="position:absolute;left:${P.cap.x}px;top:${P.cap.y}px;transform:translate(-50%,-50%) rotate(${P.cap.rot}deg) skewY(${P.cap.skew ?? 0}deg);height:${P.cap.h}px;${stitch}">${svg('tucker-t-mark.svg', P.cap.color ?? '#3E5B8A', '#E5662A').replace('<svg', `<svg style="height:${P.cap.h}px;width:auto;display:block"`)}</div>` : ''}
    ${P.patch ? `<div style="position:absolute;left:${P.patch.x}px;top:${P.patch.y}px;transform:translate(-50%,-50%) rotate(${P.patch.rot}deg);width:${P.patch.w}px;${stitch}">${svg('tucker-wordmark.svg', P.patch.color ?? '#8A3F22', '#D9602A').replace('<svg', `<svg style="width:${P.patch.w}px;height:auto;display:block"`)}</div>` : ''}
  </body>`);
  await p.waitForTimeout(200);
  const buf = await p.screenshot({ type: 'jpeg', quality: 95 });
  fs.writeFileSync(output, buf);
  await b.close();
})();
