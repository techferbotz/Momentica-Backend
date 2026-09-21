#!/usr/bin/env node
/**
 * Renders the static stills each template needs, from SVG, with sharp.
 *
 *   node scripts/build-template-assets.mjs
 *
 * Three assets per template, each with a different consumer and therefore a
 * different format and shape:
 *
 *   thumb.webp  the mobile app's feed card. WebP — the app decodes it natively
 *               and it is the smallest of the three.
 *   p1.webp     the app's template detail carousel. Phone-shaped.
 *   og.jpg      the link-preview card. JPEG at 1200x630, deliberately NOT WebP:
 *               WhatsApp's preview crawler has never handled WebP dependably,
 *               and link previews are most of this product's distribution.
 *
 * Deliberately no text in any of them. WhatsApp already renders og:title and
 * og:description as text beside the image, so words in the image would only
 * duplicate them — and SVG text rendering through sharp depends on whichever
 * fonts the machine happens to have, which is not a thing to leave to chance in
 * a committed asset.
 *
 * sharp resolves from the repo root's node_modules (the backend's). This is an
 * authoring step whose output is committed; it is not part of the web build,
 * which is why the renderer's image never needs sharp.
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const OUT_ROOT = fileURLToPath(new URL('../public/templates', import.meta.url));

/** The letter's "thank you" palette, matching the template's own tokens. */
const P = {
  stageTop: '#f9e6e9',
  stageBottom: '#eabfca',
  paper: '#fdf8f1',
  paperLit: '#fffefb',
  paperShade: '#efe3d2',
  // The envelope's inside wall, visible either side of the risen sheet. Kept
  // close to the pocket so it reads as depth rather than as two stuck-on tabs.
  paperBack: '#f7eee1',
  edge: '#d9c9b4',
  accent: '#b0455f',
  accentDeep: '#8a2f47',
  ink: '#4a3a30',
};

/**
 * A sealed envelope: body, flap folded down over it, wax at the flap's point.
 *
 * The flap needs its own edge stroke. Cream on cream is invisible otherwise —
 * the first version of this drew a flap nobody could see.
 */
function sealed({ cx, cy, w }) {
  const h = w * (2 / 3);
  const x = cx - w / 2;
  const y = cy - h / 2;
  const r = w * 0.024;
  // Where the flap's point lands, and therefore where the wax goes.
  const apex = y + h * 0.6;

  return `
  <g filter="url(#soft)">
    <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${r.toFixed(1)}" fill="${P.paper}"/>
    <path d="M ${x.toFixed(1)} ${(y + r).toFixed(1)}
             Q ${x.toFixed(1)} ${y.toFixed(1)} ${(x + r).toFixed(1)} ${y.toFixed(1)}
             L ${(x + w - r).toFixed(1)} ${y.toFixed(1)}
             Q ${(x + w).toFixed(1)} ${y.toFixed(1)} ${(x + w).toFixed(1)} ${(y + r).toFixed(1)}
             L ${cx.toFixed(1)} ${apex.toFixed(1)} Z"
          fill="url(#flap)" stroke="${P.edge}" stroke-width="${(w * 0.0035).toFixed(2)}" stroke-opacity="0.75"/>
    <circle cx="${cx.toFixed(1)}" cy="${apex.toFixed(1)}" r="${(w * 0.075).toFixed(1)}" fill="url(#wax)"/>
    <circle cx="${cx.toFixed(1)}" cy="${apex.toFixed(1)}" r="${(w * 0.046).toFixed(1)}" fill="none" stroke="#ffffff" stroke-opacity="0.2" stroke-width="${(w * 0.006).toFixed(2)}"/>
  </g>`;
}

/**
 * An opened envelope with the letter risen out of it.
 *
 * Layering is the whole trick, and getting it wrong is what made the first
 * attempt unreadable: the envelope's BACK and flap go down first, then the
 * sheet on top of them, then the envelope's FRONT pocket over the sheet's
 * bottom edge so the letter genuinely looks tucked inside rather than pasted on.
 */
function opened({ cx, cy, w, seed = 0 }) {
  const h = w * (2 / 3);
  const x = cx - w / 2;
  const y = cy - h / 2;
  const r = w * 0.024;

  const sheetW = w * 0.78;
  const sheetH = h * 1.55;
  const sheetX = cx - sheetW / 2;
  // Bottom of the sheet sits inside the pocket; the rest rises clear.
  const pocketTop = y + h * 0.42;
  const sheetY = pocketTop + h * 0.2 - sheetH;

  // Abstracted writing: varied line lengths so it reads as prose rather than a
  // placeholder block, with a short final line the way a paragraph really ends.
  const lines = [];
  const lineCount = 9;
  const top = sheetY + sheetH * 0.26;
  const gap = sheetH * 0.058;
  for (let i = 0; i < lineCount; i += 1) {
    const isLast = i === lineCount - 1;
    const frac = isLast ? 0.34 : 0.68 + (((i * 41 + seed * 17) % 30) / 100);
    lines.push(
      `<rect x="${(sheetX + sheetW * 0.13).toFixed(1)}" y="${(top + i * gap).toFixed(1)}" ` +
        `width="${(sheetW * 0.74 * frac).toFixed(1)}" height="${(sheetH * 0.0125).toFixed(1)}" ` +
        `rx="${(sheetH * 0.00625).toFixed(1)}" fill="${P.ink}" opacity="${isLast ? 0.18 : 0.24}"/>`,
    );
  }

  return `
  <g filter="url(#soft)">
    <!-- back panel + flap folded open behind -->
    <path d="M ${x.toFixed(1)} ${(y + h * 0.1).toFixed(1)} L ${cx.toFixed(1)} ${(y - h * 0.34).toFixed(1)} L ${(x + w).toFixed(1)} ${(y + h * 0.1).toFixed(1)} Z"
          fill="${P.paperShade}" stroke="${P.edge}" stroke-width="${(w * 0.003).toFixed(2)}" stroke-opacity="0.6"/>
    <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${r.toFixed(1)}" fill="${P.paperBack}"/>
  </g>

  <!-- the letter itself, in front of the envelope's back -->
  <g filter="url(#sheetShadow)">
    <rect x="${sheetX.toFixed(1)}" y="${sheetY.toFixed(1)}" width="${sheetW.toFixed(1)}" height="${sheetH.toFixed(1)}" rx="${(w * 0.012).toFixed(1)}" fill="${P.paperLit}"/>
    <rect x="${(sheetX + sheetW * 0.13).toFixed(1)}" y="${(sheetY + sheetH * 0.15).toFixed(1)}" width="${(sheetW * 0.26).toFixed(1)}" height="${(sheetH * 0.017).toFixed(1)}" rx="${(sheetH * 0.0085).toFixed(1)}" fill="${P.accent}" opacity="0.6"/>
    ${lines.join('\n    ')}
  </g>

  <!-- front pocket, over the sheet's bottom so the letter sits INSIDE -->
  <path d="M ${x.toFixed(1)} ${pocketTop.toFixed(1)}
           L ${(x + w).toFixed(1)} ${pocketTop.toFixed(1)}
           L ${(x + w).toFixed(1)} ${(y + h - r).toFixed(1)}
           Q ${(x + w).toFixed(1)} ${(y + h).toFixed(1)} ${(x + w - r).toFixed(1)} ${(y + h).toFixed(1)}
           L ${(x + r).toFixed(1)} ${(y + h).toFixed(1)}
           Q ${x.toFixed(1)} ${(y + h).toFixed(1)} ${x.toFixed(1)} ${(y + h - r).toFixed(1)} Z"
        fill="url(#pocket)"/>
  <path d="M ${x.toFixed(1)} ${pocketTop.toFixed(1)} L ${cx.toFixed(1)} ${(pocketTop + h * 0.33).toFixed(1)} L ${(x + w).toFixed(1)} ${pocketTop.toFixed(1)}"
        fill="none" stroke="${P.edge}" stroke-width="${(w * 0.003).toFixed(2)}" stroke-opacity="0.5"/>`;
}

function scene({ width, height, open, envScale, cyFrac = 0.5, seed = 0 }) {
  const w = width * envScale;
  const cx = width / 2;
  const cy = height * cyFrac;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0.1" y1="0" x2="0.4" y2="1">
      <stop offset="0%" stop-color="${P.stageTop}"/>
      <stop offset="100%" stop-color="${P.stageBottom}"/>
    </linearGradient>
    <linearGradient id="flap" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${P.paperLit}"/>
      <stop offset="100%" stop-color="${P.paperShade}"/>
    </linearGradient>
    <linearGradient id="pocket" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${P.paperLit}"/>
      <stop offset="100%" stop-color="${P.paper}"/>
    </linearGradient>
    <radialGradient id="wax" cx="0.34" cy="0.28" r="0.8">
      <stop offset="0%" stop-color="#c85570"/>
      <stop offset="60%" stop-color="${P.accent}"/>
      <stop offset="100%" stop-color="${P.accentDeep}"/>
    </radialGradient>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="${(height * 0.008).toFixed(1)}" stdDeviation="${(height * 0.013).toFixed(1)}" flood-color="#3c282d" flood-opacity="0.18"/>
    </filter>
    <filter id="sheetShadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="${(height * 0.004).toFixed(1)}" stdDeviation="${(height * 0.009).toFixed(1)}" flood-color="#3c282d" flood-opacity="0.14"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  ${open ? opened({ cx, cy, w, seed }) : sealed({ cx, cy, w })}
</svg>`;
}

const TEMPLATES = [
  {
    id: 'greeting_open_letter',
    assets: [
      // Feed card. 4:5 matches the aspect the field contracts use elsewhere.
      { name: 'thumb.webp', width: 800, height: 1000, open: false, envScale: 0.66, cyFrac: 0.5, format: 'webp' },
      // Detail carousel, phone-shaped, showing the letter actually out.
      { name: 'p1.webp', width: 828, height: 1472, open: true, envScale: 0.66, cyFrac: 0.63, format: 'webp' },
      // Link preview card. Landscape, JPEG, well under WhatsApp's size limit.
      { name: 'og.jpg', width: 1200, height: 630, open: false, envScale: 0.31, cyFrac: 0.5, format: 'jpeg' },
    ],
  },
];

let count = 0;
for (const template of TEMPLATES) {
  const dir = `${OUT_ROOT}/${template.id}`;
  mkdirSync(dir, { recursive: true });

  for (const [index, asset] of template.assets.entries()) {
    const svg = scene({
      width: asset.width,
      height: asset.height,
      open: asset.open,
      envScale: asset.envScale,
      cyFrac: asset.cyFrac,
      seed: index,
    });

    const pipeline = sharp(Buffer.from(svg));
    const out =
      asset.format === 'jpeg'
        ? pipeline.jpeg({ quality: 86, progressive: true, mozjpeg: true })
        : pipeline.webp({ quality: 82 });

    const info = await out.toFile(`${dir}/${asset.name}`);
    console.log(
      `  ${template.id}/${asset.name}  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(1)} KB`,
    );
    count += 1;
  }
}

/**
 * A stand-in photo for the `with-photo` fixture, at the 4:5 the field contract
 * declares. Deliberately an out-of-focus abstract rather than anything
 * resembling a real photograph — its job is to prove the layout holds around an
 * image of the right shape, and a fixture that looked like a real family photo
 * would be a small lie in the test suite.
 */
const fixturesDir = fileURLToPath(new URL('../public/fixtures', import.meta.url));
mkdirSync(fixturesDir, { recursive: true });

const blobs = [
  { cx: 0.32, cy: 0.3, r: 0.42, fill: '#e8b9a6', op: 0.9 },
  { cx: 0.74, cy: 0.22, r: 0.34, fill: '#f3d9c4', op: 0.85 },
  { cx: 0.62, cy: 0.68, r: 0.46, fill: '#c98f86', op: 0.75 },
  { cx: 0.22, cy: 0.82, r: 0.38, fill: '#f0c9b4', op: 0.7 },
]
  .map(
    (b) =>
      `<circle cx="${(b.cx * 1080).toFixed(0)}" cy="${(b.cy * 1350).toFixed(0)}" r="${(b.r * 1080).toFixed(0)}" fill="${b.fill}" opacity="${b.op}"/>`,
  )
  .join('\n    ');

const photoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <defs>
    <filter id="blur"><feGaussianBlur stdDeviation="90"/></filter>
  </defs>
  <rect width="1080" height="1350" fill="#d9a892"/>
  <g filter="url(#blur)">
    ${blobs}
  </g>
</svg>`;

const photoInfo = await sharp(Buffer.from(photoSvg)).webp({ quality: 78 }).toFile(`${fixturesDir}/photo-4x5.webp`);
console.log(`  fixtures/photo-4x5.webp  ${photoInfo.width}x${photoInfo.height}  ${(photoInfo.size / 1024).toFixed(1)} KB`);
count += 1;

console.log(`\n✓ ${count} asset(s) written under web/public/\n`);
