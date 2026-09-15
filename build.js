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

const out = [
  '<title>OKNG Monitor v3</title>',
  fontLink,
  '<style>',
  cssThemed.trim(),
  '</style>',
  body,
  '<script>',
  js.trim(),
  '</script>',
  ''
].join('\n');

fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync(path.join('dist', 'okng-monitor-v3.html'), out);
console.log('dist/okng-monitor-v3.html —', (out.length / 1024).toFixed(1), 'KB');
