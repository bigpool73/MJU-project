'use strict';
/**
 * 단일 HTML 만들기: node scripts/bundle.js <출력경로>
 * css/js/로고/파비콘은 data URI·인라인으로, pdf 워커는 base64 → Blob URL 로 넣는다(채팅 화면 미리보기용).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const out = process.argv[2];
if (!out) { console.error('사용법: node scripts/bundle.js <출력경로>'); process.exit(2); }

const read = (p) => fs.readFileSync(path.join(ROOT, p));
const dataUri = (p, type) => `data:${type};base64,${read(p).toString('base64')}`;
// 인라인 스크립트가 </script 로 끝나 보이지 않도록
const safeJs = (s) => s.replace(/<\/(script)/gi, '<\\/$1');

let html = read('index.html').toString('utf8');

const icons = {
  'assets/favicon.ico': 'image/x-icon', 'assets/favicon-32.png': 'image/png', 'assets/apple-touch-icon.png': 'image/png',
};
for (const [p, type] of Object.entries(icons)) html = html.split(`href="${p}"`).join(`href="${dataUri(p, type)}"`);

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, p) => `<style>\n${read(p).toString('utf8')}\n</style>`);

const worker64 = read('assets/vendor/pdfjs/pdf.worker.min.js').toString('base64');
html = html.replace(/<script>Pdf\.configure\([^<]*<\/script>/, () => `<script>
(function () {
  var b = atob(${JSON.stringify(worker64)}), u = new Uint8Array(b.length);
  for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  Pdf.configure({ workerSrc: URL.createObjectURL(new Blob([u], { type: 'text/javascript' })) });
})();
</script>`);

html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, p) => `<script>\n${safeJs(read(p).toString('utf8'))}\n</script>`);

// 화면 JS 안의 로고 경로(내역서 <img>)와 정적 <img>
const logo = dataUri('assets/mju-logo.png', 'image/png');
html = html.split('assets/mju-logo.png').join(logo);
for (const g of ['assets/guide-claude-1.png', 'assets/guide-claude-2.png']) html = html.split(g).join(dataUri(g, 'image/png'));

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out}  ${(Buffer.byteLength(html) / 1048576).toFixed(2)}MB`);
