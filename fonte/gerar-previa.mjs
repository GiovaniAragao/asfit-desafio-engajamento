// Gera a arte da prévia do link (og:image, 1200x630) a partir de fonte/previa-link.html.
// Trocou a arte: trocar também o nome do arquivo aqui e no og:image do public/index.html (o WhatsApp guarda a prévia antiga).
// A página abre por um servidor local, porque a logo é máscara CSS e o Chrome não carrega máscara por file://.
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import http from 'http';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.HOME + '/.local/lib/node_modules/@playwright/cli/node_modules/playwright');
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const saida = path.join(raiz, 'public/img/compartilhar-desafio-v2.jpg');
const TIPOS = { '.html': 'text/html', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const servidor = http.createServer((req, res) => {
  const arquivo = path.join(raiz, decodeURIComponent(req.url.split('?')[0]));
  if (!arquivo.startsWith(raiz) || !fs.existsSync(arquivo)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TIPOS[path.extname(arquivo)] || 'application/octet-stream' });
  fs.createReadStream(arquivo).pipe(res);
});
await new Promise(ok => servidor.listen(0, '127.0.0.1', ok));
const b = await chromium.launch({ executablePath: EXE, args: ['--force-color-profile=srgb'] });
try {
  const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await p.goto(`http://127.0.0.1:${servidor.address().port}/fonte/previa-link.html`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(600);
  await p.screenshot({ path: saida, type: 'jpeg', quality: 88 });
  console.log('salvo', saida);
} finally { await b.close(); servidor.close(); }
