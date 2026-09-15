/* Builds the two shipped bundles from index.html + assets/.
     dist/okng-monitor-v3.html  complete document for any static host
     dist/artifact.html         fragment for the Artifact publisher, which
                                supplies doctype, charset and viewport itself
   Usage: node build.js */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('assets/styles.css', 'utf8');
const cfg = fs.readFileSync('assets/config.js', 'utf8');
const js = fs.readFileSync('assets/app.js', 'utf8');

const body = html
  .replace(/[\s\S]*<body>/, '')
  .replace(/<\/body>[\s\S]*/, '')
  .replace(/\s*<script src="assets\/(config|app)\.js"><\/script>/g, '')
  .trim();

const fontLink = '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&family=Prompt:wght@400;600;700;800&family=IBM+Plex+Sans+Thai:wght@400;600;700&display=swap" rel="stylesheet">';

const head = ['<title>OKNG Monitor v3</title>', fontLink, '<style>', css.trim(), '</style>'].join('\n');
const sdk = '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"><' + '/script>';
const page = [
  body.replace(/\s*<script src="https:\/\/cdn\.jsdelivr[^>]*><\/script>/, ''),
  sdk,
  '<script>', cfg.trim(), '<' + '/script>',
  '<script>', js.trim(), '<' + '/script>'
].join('\n');

const standalone = [
  '<!doctype html>',
  '<html lang="th">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  '<meta name="description" content="ระบบเก็บข้อมูลการเทสเครื่องเทียบสี — ติดตาม OK/NG, LOCK, ล็อตงาน และรายงานรายสถานี">',
  '<meta name="theme-color" content="#f4f6fb">',
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
