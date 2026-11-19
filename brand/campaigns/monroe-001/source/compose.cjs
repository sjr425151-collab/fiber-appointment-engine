/**
 * Tucker · Meta campaign 001 (Monroe, MI) — deterministic ad compositor.
 *
 * The mascot scene comes from a generated image (scenes/); every word, the
 * logo and the layout are drawn here, so type and logo geometry are exact.
 * Usage (from the repository root):
 *   node brand/campaigns/monroe-001/source/compose.cjs [outDir] [only]
 * Renders each layout in LAYOUTS to PNG at its exact pixel size with Chromium.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../..');
const HERE = __dirname;
const OUT = path.resolve(process.argv[2] ?? path.join(HERE, '..', 'exports'));
const ONLY = process.argv[3] ?? '';
const fileUrl = (p) => 'file://' + p;
const SORA = fileUrl(path.join(ROOT, 'node_modules/@fontsource-variable/sora/files/sora-latin-wght-normal.woff2'));
const INTER = fileUrl(path.join(ROOT, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'));
const svg = (f) => fs.readFileSync(path.join(ROOT, 'brand/assets', f), 'utf8');
const scene = (f) => fileUrl(path.join(HERE, 'scenes', f));

const C = { ink: '#101828', muted: '#3b4456', blue: '#1d3fd8', orange: '#EE6A24', white: '#ffffff' };
// The bear-nose period (same outline as the logo), for headlines that end in a full stop.
const NOSE = (size) => `<svg viewBox="0 0 100 78" style="width:${size}em;height:${size * 0.78}em;display:inline-block;margin-left:.05em;vertical-align:baseline"><path fill="${C.orange}" d="M50 0C79 0 100 7 100 25C100 46 72 72 50 78C28 72 0 46 0 25C0 7 21 0 50 0Z"/></svg>`;

const base = (w, h, bgTop, bgBottom, body) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Sora;src:url(${SORA}) format('woff2');font-weight:100 800}
@font-face{font-family:Inter;src:url(${INTER}) format('woff2');font-weight:100 900}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w}px;height:${h}px;overflow:hidden}
body{position:relative;background:linear-gradient(${bgTop},${bgBottom});font-family:Inter,sans-serif;color:${C.ink};-webkit-font-smoothing:antialiased}
.scene{position:absolute;background-size:cover;background-repeat:no-repeat;
  -webkit-mask-image:linear-gradient(to right,transparent 0,#000 var(--fx,10%)),linear-gradient(to bottom,transparent 0,#000 var(--fy,10%));
  -webkit-mask-composite:source-in;mask-composite:intersect}
.eyebrow{font:600 var(--eb,22px)/1 Inter;letter-spacing:.16em;color:${C.blue};text-transform:uppercase}
.h{font-family:Sora;font-weight:800;letter-spacing:-.025em;line-height:.98;text-transform:uppercase}
.sub{font-family:Sora;font-weight:600;letter-spacing:-.01em;line-height:1.18}
.cats{font:500 var(--cs,24px)/1.3 Inter;color:${C.muted};letter-spacing:.01em}
.band{position:absolute;left:0;right:0;bottom:0;background:${C.blue};display:flex;align-items:center;justify-content:space-between;color:#fff}
.cta{font:700 var(--ct,26px)/1 Inter;letter-spacing:.08em;text-transform:uppercase;display:flex;align-items:center;gap:.55em}
.cta svg{width:1.05em;height:1.05em}
.url{font:500 var(--ur,18px)/1 Inter;opacity:.85;letter-spacing:.02em;margin-top:.5em;text-transform:none}
</style></head><body>${body}</body></html>`;

const arrow = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const band = (h, pad, logoH, ctaSize, topPad = 0) => `<div class="band" style="height:${h}px;padding:${topPad}px ${pad}px 0;${topPad ? 'align-items:flex-start' : ''}">
  <div style="height:${logoH}px">${svg('tucker-wordmark-white.svg').replace('<svg', `<svg style="height:${logoH}px;width:auto"`)}</div>
  <div style="text-align:right"><div class="cta" style="--ct:${ctaSize}px;justify-content:flex-end">See your savings preview ${arrow}</div><div class="url" style="--ur:${Math.round(ctaSize * 0.7)}px">trytucker.com</div></div>
</div>`;

// Simple line icons for the four services (concept C).
const ICON = {
  internet: '<path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1.2" fill="currentColor"/>',
  mobile: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  tv: '<rect x="2.5" y="5" width="19" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  electricity: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>',
};
const tile = (k, label, size) => `<div style="display:flex;align-items:center;gap:${size * 0.55}px;background:rgba(255,255,255,.78);border:1px solid rgba(16,24,40,.08);border-radius:${size * 0.5}px;padding:${size * 0.42}px ${size * 0.6}px;box-shadow:0 10px 30px -18px rgba(16,24,40,.45)">
  <span style="display:grid;place-items:center;width:${size * 1.35}px;height:${size * 1.35}px;border-radius:${size * 0.4}px;background:${C.blue};color:#fff"><svg viewBox="0 0 24 24" style="width:${size * 0.8}px;height:${size * 0.8}px" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg></span>
  <span style="font:600 ${size * 0.72}px/1 Inter;color:${C.ink}">${label}</span></div>`;


/** Concept A in any size. Tucker stands on the blue band; the headline sits in the empty top area. */
function introA(o) {
  const { w, h, bandH, H, L, top, headline, copyTop, copyLeft } = o;
  const W = Math.round(H * 1856 / 2304), T = h - bandH - Math.round(0.92 * H);
  // Stories/Reels: the band is tall and its content sits at the top, above the area covered by the app's buttons.
  const bandHtml = o.bandPad === 'top'
    ? band(bandH, 72, 50, 26, 64)
    : band(bandH, 72, w < 1080 ? 44 : 50, 26);
  return { w, h, html: base(w, h, '#dbccc7', '#e6dcda', `
      <div class="scene" style="left:${L}px;top:${T}px;width:${W}px;height:${H}px;background-image:url(${scene('r1-1-branded.jpg')});-webkit-mask-image:linear-gradient(to left,transparent 0,#000 16%),linear-gradient(to bottom,transparent 0,#000 12%);-webkit-mask-composite:source-in;mask-composite:intersect"></div>
      <div style="position:absolute;left:72px;top:${top}px;right:72px">
        <div class="eyebrow">Now introducing &nbsp;•&nbsp; Monroe, MI</div>
        <div class="h" style="font-size:${headline}px;margin-top:${o.eyebrowGap ?? 26}px">Monroe,<br>meet Tucker${NOSE(0.24)}</div>
      </div>
      <div style="position:absolute;left:${copyLeft}px;top:${copyTop}px;width:${w - copyLeft - 60}px">
        <div class="sub" style="font-size:${o.sub ?? 38}px">Your bills might be higher than they need to be.</div>
        <div style="margin-top:28px;font:600 26px/1.55 Inter;color:${C.ink}">Internet<br>Mobile<br>TV &amp; streaming<br>Electricity</div>
      </div>
      ${bandHtml}`) };
}

/** Concept B in any size: the kitchen scene, with the headline on the plain wall above Tucker. */
function compareB(o) {
  const { w, h, bandH, imgW, imgTop, top, headline, sub } = o;
  const imgH = Math.round(imgW * 2304 / 1856), left = o.imgLeft ?? 0;
  const fadeLeft = left > 0 ? 'linear-gradient(to right,transparent 0,#000 9%),' : '';
  // The approved 4:5 framing (founder's pick, 2026-11-19): the scene starts 60px down and its top edge fades into the wall.
  const sceneHtml = o.approved45
    ? `<div class="scene" style="left:0;top:60px;width:${w}px;height:${h - bandH - 60}px;background-image:url(${scene('r2-7-branded.jpg')});background-position:50% 74%;-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 8%);mask-image:linear-gradient(to bottom,transparent 0,#000 8%)"></div>`
    : `<div class="scene" style="left:${left}px;top:${imgTop}px;width:${imgW}px;height:${imgH}px;background-image:url(${scene('r2-7-branded.jpg')});-webkit-mask-image:${fadeLeft}linear-gradient(to bottom,transparent 0,#000 ${imgTop > 0 ? 9 : 0}%);${fadeLeft ? '-webkit-mask-composite:source-in;mask-composite:intersect;' : ''}"></div>`;
  return { w, h, html: base(w, h, '#efe9e3', '#efe9e3', `
      ${sceneHtml}
      <div style="position:absolute;left:72px;top:${top}px;right:72px">
        <div class="eyebrow">Monroe, MI</div>
        <div class="h" style="font-size:${headline}px;margin-top:${o.eyebrowGap ?? 22}px">When did you last<br>compare your bills?</div>
        <div class="sub" style="font-size:${sub}px;margin-top:20px;max-width:900px;color:${C.muted}">Internet, mobile, TV and electricity.<br>Explore your options with Tucker.</div>
      </div>
      ${band(bandH, 72, 50, 26, o.bandTop ?? 0)}`) };
}

/** Every layout: name → { w, h, html }. Positions are in pixels of the final export. */
const LAYOUTS = {
  // ---------------------------------------------------------------- A · Brand introduction
  'A-intro-4x5': () => introA({ w: 1080, h: 1350, bandH: 150, H: 1166, L: -70, top: 78, headline: 104, copyTop: 590, copyLeft: 700 }),
  'A-intro-9x16': () => introA({ w: 1080, h: 1920, bandH: 480, bandPad: 'top', H: 1100, L: -70, top: 270, headline: 112, copyTop: 820, copyLeft: 700 }),
  'A-intro-1x1': () => introA({ w: 1080, h: 1080, bandH: 128, H: 900, L: -20, top: 64, headline: 86, copyTop: 390, copyLeft: 670, eyebrowGap: 20, sub: 34 }),
  // ---------------------------------------------------------------- B · Bill awareness
  'B-compare-4x5': () => compareB({ w: 1080, h: 1350, bandH: 150, imgW: 1080, imgTop: -88, top: 78, headline: 78, sub: 28, approved45: true }),
  'B-compare-9x16': () => compareB({ w: 1080, h: 1920, bandH: 480, bandTop: 64, imgW: 1080, imgTop: 196, top: 270, headline: 76, sub: 30 }),
  'B-compare-1x1': () => compareB({ w: 1080, h: 1080, bandH: 128, imgW: 860, imgLeft: 220, imgTop: -33, top: 56, headline: 64, sub: 26, eyebrowGap: 16 }),
  // ---------------------------------------------------------------- C · Convenience
  'C-fourbills-4x5': () => {
    const [w, h, bandH] = [1080, 1350, 150];
    const H = 950, W = Math.round(H * 1856 / 2304), T = h - bandH - Math.round(0.955 * H), L = -40;
    return { w, h, html: base(w, h, '#d8cdcb', '#e4dad8', `
      <div class="scene" style="left:${L}px;top:${T}px;width:${W}px;height:${H}px;background-image:url(${scene('r1-5.jpg')});-webkit-mask-image:linear-gradient(to left,transparent 0,#000 20%),linear-gradient(to bottom,transparent 0,#000 14%);-webkit-mask-composite:source-in;mask-composite:intersect"></div>
      <div style="position:absolute;left:72px;top:78px;right:72px">
        <div class="eyebrow">Monroe, MI</div>
        <div class="h" style="font-size:74px;margin-top:22px">Four bills.<br>One place to compare${NOSE(0.24)}</div>
      </div>
      <div style="position:absolute;left:612px;top:540px;width:400px;display:flex;flex-direction:column;gap:18px">
        ${tile('internet', 'Internet', 40)}${tile('mobile', 'Mobile', 40)}${tile('tv', 'TV & streaming', 40)}${tile('electricity', 'Electricity', 40)}
        <div class="cats" style="margin-top:10px;font-size:22px;color:${C.muted}">See a preliminary savings preview with Tucker.</div>
      </div>
      ${band(bandH, 72, 50, 26)}`) };
  },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  for (const [name, make] of Object.entries(LAYOUTS)) {
    if (ONLY && !name.startsWith(ONLY)) continue;
    const { w, h, html } = make();
    const file = path.join(OUT, `${name}.html`);
    fs.writeFileSync(file, html);
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await p.goto(fileUrl(file));
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(OUT, `tucker-monroe-001_${name}_${w}x${h}.png`) });
    await p.close();
    fs.unlinkSync(file);
    console.log('rendered', name, `${w}x${h}`);
  }
  await b.close();
})();
