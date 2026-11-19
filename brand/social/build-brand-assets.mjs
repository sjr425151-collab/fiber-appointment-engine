/**
 * Builds Tucker's mascot assets for the website from the approved, lettered scene
 * (brand/campaigns/monroe-001/source/scenes/r1-1-branded.jpg):
 *   public/og-tucker-bear.jpg      1200×630 share image (wordmark + copy + Tucker)
 *   public/media/tucker-face-*.webp/.png   circular portrait for the chat launcher and header
 * Run from the repository root: node brand/social/build-brand-assets.mjs
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.cwd() + '/node_modules/playwright');

const scene = 'file://' + process.cwd() + '/brand/campaigns/monroe-001/source/scenes/r1-1-branded.jpg';
const src = fs.readFileSync('src/components/logo-paths.ts', 'utf8');
const part = (obj, i) => new RegExp(`${obj} = \\{ viewBox: '([^']*)', letters: '([^']*)', nose: '([^']*)' \\}`).exec(src)[i];
const ORANGE = /LOGO_ORANGE = '([^']+)'/.exec(src)[1];
const font = (f) => 'file://' + process.cwd() + `/node_modules/@fontsource-variable/${f}/files/${f}-latin-wght-normal.woff2`;
const CREAM = '#F6F4F1';

// Share image. The scene is 1856×2304; the crop shows Tucker from the cap to the name patch, waving.
const og = `<!doctype html><html><head><style>
@font-face{font-family:Sora;src:url(${font('sora')})}@font-face{font-family:Inter;src:url(${font('inter')})}
*{margin:0;box-sizing:border-box}body{width:1200px;height:630px;background:${CREAM};position:relative;overflow:hidden;font-family:Inter}
.bear{position:absolute;right:0;top:0;width:640px;height:630px;background:url(${scene}) no-repeat;background-size:1060px auto;background-position:-62px -168px;
  -webkit-mask-image:linear-gradient(to right,transparent 0,#000 22%);mask-image:linear-gradient(to right,transparent 0,#000 22%)}
</style></head><body>
<div class="bear"></div>
<div style="position:absolute;left:84px;top:150px;width:640px">
  <svg viewBox="${part('WORDMARK', 1)}" style="height:96px;width:auto;display:block"><g fill="#101828">${part('WORDMARK', 2)}</g><g fill="${ORANGE}">${part('WORDMARK', 3)}</g></svg>
  <div style="margin-top:40px;font:700 34px/1.15 Sora;color:#101828;letter-spacing:-.01em">Your home service savings broker.</div>
  <div style="margin-top:18px;font:400 27px/1.4 Inter;color:#475467;max-width:540px">See what you could save on internet, mobile, TV &amp; electricity.</div>
</div>
<div style="position:absolute;left:0;right:0;bottom:0;height:12px;background:#1D3FD8"></div>
</body></html>`;

const b = await chromium.launch();
const dir = fs.mkdtempSync('/tmp/tucker-assets-');
fs.writeFileSync(dir + '/og.html', og);
let p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto('file://' + dir + '/og.html');
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(150);
await p.screenshot({ path: 'public/og-tucker-bear.jpg', type: 'jpeg', quality: 86 });
await p.close();

// Chat portrait: a tight circle around the face and cap (scene crop 660,430 → 1220,990), with a hairline ring.
for (const size of [96, 192]) {
  p = await b.newPage({ viewport: { width: size, height: size } });
  const scale = size / 560;
  fs.writeFileSync(dir + '/face.html', `<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;background:url(${scene}) no-repeat;background-size:${1856 * scale}px auto;background-position:${-660 * scale}px ${-430 * scale}px"></div></body>`);
  await p.goto('file://' + dir + '/face.html');
  await p.waitForTimeout(100);
  await p.screenshot({ path: `public/media/tucker-face-${size}.png`, omitBackground: true });
  await p.close();
}
await b.close();
fs.rmSync(dir, { recursive: true });
console.log('built og-tucker-bear.jpg and tucker-face-96/192.png');
