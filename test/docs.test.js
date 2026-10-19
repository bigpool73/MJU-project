'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Docs = require('../src/docs.js');

const FX = path.join(__dirname, 'doc-fixtures');
const load = (f) => { const b = fs.readFileSync(path.join(FX, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const run = (f, name = f) => Docs.extract(load(f), name);

test('docx: 문단·탭·줄바꿈·표 칸·기호가 그대로 나온다', async () => {
  const r = await run('basic.docx');
  assert.strictEqual(r.ok, true); assert.strictEqual(r.format, 'docx');
  assert.match(r.text, /^도서관 야간 개방 확대 제안\n/);
  assert.ok(r.text.includes('첫째, 집중할 공간이 부족하다.\t둘째, 늦은 시간에 갈 곳이 없다.\n셋째 줄은 줄바꿈 뒤에 이어진다.'));
  for (const cell of ['구분', '운영 시간', '현재', '오후 10시까지']) assert.ok(r.text.includes(cell), cell);
  assert.ok(r.text.includes('&와 <꺾쇠> 같은 기호'));
});

test('docx: 글상자 Fallback 중복과 삭제된 변경 내용은 읽지 않는다', () => {
  const x = '<w:p><w:r><w:t>본문</w:t></w:r></w:p><mc:AlternateContent><mc:Choice><w:p><w:r><w:t>상자 글</w:t></w:r></w:p></mc:Choice><mc:Fallback><w:p><w:r><w:t>상자 글</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent><w:p><w:del><w:r><w:delText>지운 글</w:delText></w:r></w:del><w:r><w:t xml:space="preserve">남은 글 </w:t></w:r></w:p>';
  const t = Docs._internal.docxText(x);
  assert.strictEqual((t.match(/상자 글/g) || []).length, 1);
  assert.ok(!t.includes('지운 글')); assert.ok(t.includes('남은 글'));
});

test('hwpx: 구역을 번호 순서(0, 2, 10)로 읽고 표 칸·탭·기호를 처리한다', async () => {
  const r = await run('basic.hwpx');
  assert.strictEqual(r.ok, true); assert.strictEqual(r.format, 'hwpx');
  const i0 = r.text.indexOf('첫 번째 구역'), i2 = r.text.indexOf('학내 공용 자전거'), i10 = r.text.indexOf('두 번째 구역');
  assert.ok(i0 >= 0 && i0 < i2 && i2 < i10, `순서 ${i0},${i2},${i10}`);
  assert.ok(r.text.includes('탭이 있는 줄\t뒤쪽 글자 & 기호'));
  assert.ok(r.text.includes('칸A') && r.text.includes('칸B') && r.text.includes('표 다음 문단'));
});

test('hwp: 압축본과 비압축본의 결과가 같다', async () => {
  const a = await run('basic.hwp'), b = await run('uncompressed.hwp');
  assert.strictEqual(a.ok, true); assert.strictEqual(a.format, 'hwp');
  assert.strictEqual(a.text, b.text);
});

test('hwp: 확장 제어 문자의 정보는 글자로 새지 않고, 탭·줄바꿈·공백·이모지·한자는 살아 있다', async () => {
  const r = await run('basic.hwp');
  assert.ok(r.text.includes('구역 정의 뒤에 이어지는 본문 문장이다.'));
  assert.ok(!/[捤獥]/.test(r.text), '제어 정보가 글자로 읽힘');
  assert.ok(!/dces| lbt/.test(r.text), '제어 정보가 글자로 읽힘');
  assert.ok(r.text.includes('탭이 있는 줄\t탭 뒤 글자\n줄바꿈 뒤 글자'));
  assert.ok(r.text.includes('고정폭 공백과 붙은 글자'));
  assert.ok(r.text.includes('😀 이모지와 한자 漢字'));
  assert.ok(r.text.includes('표 안의 칸 하나'));
});

test('hwp: 4000바이트가 넘는 긴 문단도 잘리지 않는다', async () => {
  const r = await run('basic.hwp');
  assert.strictEqual((r.text.match(/가나다라마바사/g) || []).length, 400);
});

test('hwp: 암호 / 배포용 문서는 이유를 알려 주고 읽지 않는다', async () => {
  const e = await run('encrypted.hwp'), d = await run('distribution.hwp');
  assert.strictEqual(e.ok, false); assert.match(e.notes[0], /암호/);
  assert.strictEqual(d.ok, false); assert.match(d.notes[0], /배포용/);
});

test('지원하지 않는 형식과 손상 파일은 예외 없이 안내를 돌려준다', async () => {
  for (const f of ['truncated.docx', 'not-a-doc.docx', 'no-body.hwp', 'legacy-doc-like.bin']) {
    const r = await run(f);
    assert.strictEqual(r.ok, false, f); assert.ok(r.notes.length && r.notes[0].length > 10, f);
  }
  assert.strictEqual((await Docs.extract(null, 'x.docx')).ok, false);
  assert.strictEqual((await Docs.extract(new ArrayBuffer(0), 'x.hwp')).ok, false);
  assert.strictEqual((await Docs.extract(new TextEncoder().encode('그냥 글').buffer, 'x.hwp')).ok, false);
});

test('지나치게 큰 파일은 읽기 전에 거절한다', async () => {
  const r = await Docs.extract({ byteLength: Docs.LIMITS.fileBytes + 1 }, 'big.docx');
  assert.strictEqual(r.ok, false); assert.match(r.notes[0], /너무 큽니다/);
});

test('압축 폭탄성 docx는 한도에서 멈춘다 (메모리를 터뜨리지 않음)', async () => {
  const { execFileSync } = require('node:child_process');
  const tmp = path.join(require('node:os').tmpdir(), `bomb-${process.pid}.docx`);
  execFileSync('python3', ['-c', `
import zipfile
with zipfile.ZipFile(${JSON.stringify(tmp)}, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('word/document.xml', b'<w:p><w:t>' + b'a' * (120 * 1024 * 1024) + b'</w:t></w:p>')
`]);
  const b = fs.readFileSync(tmp); fs.unlinkSync(tmp);
  assert.ok(b.length < 1024 * 1024, '압축 후 크기 ' + b.length);
  const r = await Docs.extract(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 'bomb.docx');
  assert.strictEqual(r.ok, false); assert.match(r.notes[0], /너무 커서/);
});

test('tidy: 전각 공백·제로폭 문자·과한 빈 줄을 정리한다', () => {
  assert.strictEqual(Docs._internal.tidy('가　나​다\n\n\n\n라  \n'), '가 나다\n\n라');
});

test('hwp: 압축 본문 뒤에 여분 바이트가 붙어 있어도 읽는다 (실제 한글 파일의 특징)', async () => {
  const a = await run('basic.hwp'), b = await run('trailing-junk.hwp');
  assert.strictEqual(b.ok, true); assert.strictEqual(b.text, a.text);
});
