/* Builds dist/okng-monitor-v3.html — a single self-contained file that can be
   dropped on any static host, and the source for the published Artifact.
   Usage: node build.js            */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('assets/styles.css', 'utf8');
const js = fs.readFileSync('assets/app.js', 'utf8');

// --- theme tokens -----------------------------------------------------------
// The artifact host renders in the viewer's theme with three states: an explicit
// data-theme stamp (either value) or no stamp at all (system). This design is
// dark-first, so bare :root carries dark and the light palette is applied both
// by an explicit [data-theme="light"] stamp and by an unstamped light OS.
const lightBlock = css.match(/:root\[data-theme="light"\]\{([\s\S]*?)\n\}/);
if (!lightBlock) throw new Error('light token block not found in styles.css');
const lightTokens = lightBlock[1];
const cssThemed = css.replace(
  lightBlock[0],
  lightBlock[0] +
  '\n\n@media (prefers-color-scheme: light){\n  :root:not([data-theme="dark"]){' + lightTokens + '\n  }\n}'
);

// --- page body --------------------------------------------------------------
const body = html
  .replace(/[\s\S]*<body>/, '')
  .replace(/<\/body>[\s\S]*/, '')
  .replace(/\s*<script src="assets\/app\.js"><\/script>/, '')
  .trim();

const fontLink = '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">';

// --- two outputs ------------------------------------------------------------
// 1. standalone: a complete document for dropping on any static host. It must
//    carry its own <meta charset> — a host that serves .html without a charset
//    parameter otherwise leaves the browser to guess, and the Thai text in this
//    page comes out as mojibake.
// 2. artifact: the same page as a fragment for the Artifact publisher, which
//    supplies the doctype, charset and viewport itself.
const head = [
  '<title>OKNG Monitor v3</title>',
  fontLink,
  '<style>',
  cssThemed.trim(),
  '</style>'
].join('\n');

const page = [body, '<script>', js.trim(), '<' + '/script>'].join('\n');

const standalone = [
  '<!doctype html>',
  '<html lang="th">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  '<meta name="description" content="แดชบอร์ดมอนิเตอร์ผลการตรวจสอบคุณภาพ OK/NG แบบเรียลไทม์">',
  '<meta name="theme-color" content="#0b0f14">',
  head,
  '</head>',
  '<body>',
  page,
  '</body>',
  '</html>',
  ''
].join('\n');

const artifact = [head, page, ''].join('\n');

fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync(path.join('dist', 'okng-monitor-v3.html'), standalone);
fs.writeFileSync(path.join('dist', 'artifact.html'), artifact);
console.log('dist/okng-monitor-v3.html —', (standalone.length / 1024).toFixed(1), 'KB (standalone)');
console.log('dist/artifact.html        —', (artifact.length / 1024).toFixed(1), 'KB (artifact fragment)');
