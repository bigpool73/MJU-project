# -*- coding: utf-8 -*-
"""테스트용 문서 파일을 만든다 (내용은 모두 지어낸 것).
  python3 test/doc-fixtures/build.py
 - .docx : python-docx (표, 탭, 줄바꿈 포함)
 - .hwpx : zipfile로 직접 구성 (section XML)
 - .hwp  : 한글 5.x 구조(OLE 컨테이너 + 압축된 레코드)를 직접 구성. 실제 한글이 만든 파일이 아니므로
           확장형 제어 문자·탭·줄바꿈 처리는 명세 기준의 가정이다. 실제 한글 양식 1건은 별도로 확인했다.
"""
import os, struct, zlib, zipfile
from docx import Document

HERE = os.path.dirname(os.path.abspath(__file__))
P = lambda n: os.path.join(HERE, n)

# ── docx
d = Document()
d.add_heading('도서관 야간 개방 확대 제안', level=1)
d.add_paragraph('시험 기간에 도서관을 밤늦게까지 여는 것이 학생의 학습에 도움이 된다고 생각한다.')
p = d.add_paragraph('첫째, 집중할 공간이 부족하다.'); p.add_run('\t'); p.add_run('둘째, 늦은 시간에 갈 곳이 없다.'); p.add_run().add_break()
p.add_run('셋째 줄은 줄바꿈 뒤에 이어진다.')
t = d.add_table(rows=2, cols=2)
t.cell(0, 0).text = '구분'; t.cell(0, 1).text = '운영 시간'; t.cell(1, 0).text = '현재'; t.cell(1, 1).text = '오후 10시까지'
d.add_paragraph('표 아래 마지막 문단입니다. &와 <꺾쇠> 같은 기호도 그대로 나와야 한다.')
d.save(P('basic.docx'))
# 손상본
raw = open(P('basic.docx'), 'rb').read(); open(P('truncated.docx'), 'wb').write(raw[: len(raw) // 2])
open(P('not-a-doc.docx'), 'wb').write('이건 문서가 아니라 그냥 글자입니다.'.encode('utf-8'))

# ── hwpx
sec = ('<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="s" xmlns:hp="p">'
       '<hp:p><hp:run><hp:t>학내 공용 자전거 도입 제안</hp:t></hp:run></hp:p>'
       '<hp:p><hp:run><hp:t>캠퍼스 사이 이동 시간이 길어 수업에 늦는 학생이 많다.</hp:t></hp:run></hp:p>'
       '<hp:p><hp:run><hp:t>탭이 있는 줄<hp:tab width="100"/>뒤쪽 글자 &amp; 기호</hp:t></hp:run></hp:p>'
       '<hp:p><hp:run><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>칸A</hp:t></hp:run></hp:p></hp:subList></hp:tc>'
       '<hp:tc><hp:subList><hp:p><hp:run><hp:t>칸B</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>'
       '<hp:p><hp:run><hp:t>표 다음 문단</hp:t></hp:run></hp:p></hs:sec>')
sec1 = '<?xml version="1.0"?><hs:sec xmlns:hs="s" xmlns:hp="p"><hp:p><hp:run><hp:t>두 번째 구역의 문단</hp:t></hp:run></hp:p></hs:sec>'
with zipfile.ZipFile(P('basic.hwpx'), 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('mimetype', 'application/hwp+zip', compress_type=zipfile.ZIP_STORED)
    z.writestr('Contents/section10.xml', sec1)   # 번호 정렬(2 < 10) 확인용으로 일부러 뒤 번호
    z.writestr('Contents/section2.xml', sec.replace('학내 공용 자전거 도입 제안', '학내 공용 자전거 도입 제안'))
    z.writestr('Contents/section0.xml', '<?xml version="1.0"?><hs:sec xmlns:hs="s" xmlns:hp="p"><hp:p><hp:run><hp:t>첫 번째 구역의 문단</hp:t></hp:run></hp:p></hs:sec>')

# ── hwp (OLE 컨테이너)
def rec(tag, payload, level=0):
    size = len(payload)
    if size >= 0xfff: return struct.pack('<I', tag | (level << 10) | (0xfff << 20)) + struct.pack('<I', size) + payload
    return struct.pack('<I', tag | (level << 10) | (size << 20)) + payload

def para(text_units):
    """text_units: 글자 문자열 또는 (제어문자코드) 정수 조각의 리스트"""
    b = b''
    for u in text_units:
        if isinstance(u, str): b += u.encode('utf-16le')
        else: b += u
    b += struct.pack('<H', 13)                      # 문단 끝
    return rec(66, b'\x00' * 22) + rec(67, b)

def ext(code, info=b'dces' + b'\x00' * 10):           # 확장 제어 문자: 코드 2바이트 + 정보 14바이트
    return struct.pack('<H', code) + info

body = b''.join([
    para(['지역 상권과 대학이 함께하는 졸업작품 전시 제안']),
    para([ext(2, b'dces' + b'\x00\x00\x00\x00' + '捤獥'.encode('utf-16le') + b'\x00\x00'), '구역 정의 뒤에 이어지는 본문 문장이다.']),   # 확장 제어(구역 정의) 뒤 글자
    para(['탭이 있는 줄', struct.pack('<H', 9) + b'\x00' * 14, '탭 뒤 글자', struct.pack('<H', 10), '줄바꿈 뒤 글자']),
    para(['표 안의 칸 하나', ext(11, b' lbt' + b'\x00' * 10)]),
    para(['고정폭 공백과', struct.pack('<H', 30), '붙은 글자']),
    para(['\U0001F600 이모지와 한자 漢字']),
    para(['긴 문단 ' + '가나다라마바사 ' * 400]),         # 4000바이트를 넘는 레코드(크기 확장 헤더 경로)
])
# 압축 후에도 4096바이트를 넘게(= 일반 스트림으로 저장되게) 압축이 잘 안 되는 글자로 채운다. 결정적이도록 시드 고정.
import random
_r = random.Random(7)
body += para(['채움 문단 ' + ''.join(chr(0xAC00 + _r.randrange(0, 2350)) for _ in range(6000))])

def hwp(path, flags=1, with_body=True, pad=4096, body_bytes=None, trailing=b''):
    fh = (b'HWP Document File'.ljust(32, b'\x00') + struct.pack('<II', 0x05010100, flags)).ljust(256, b'\x00')
    data = body_bytes if body_bytes is not None else body
    if flags & 1: c = zlib.compressobj(wbits=-15); data = c.compress(data) + c.flush()
    data += trailing   # 실제 한글 파일은 압축 본문 뒤에 압축과 무관한 바이트가 붙어 있었다. Chrome의 DecompressionStream은 이를 오류로 본다.
    streams = [('FileHeader', fh.ljust(pad, b'\x00'), 2, 256)]
    if with_body: streams.append(('Section0', data, 2, len(data)))
    SS = 512
    def secs(n): return (len(n) + SS - 1) // SS
    # 섹터 배치: 0=FAT, 1=디렉터리, 이후 스트림
    layout = []; nxt = 2
    for name, d, typ, sz in streams: layout.append((nxt, d)); nxt += secs(d)
    total = nxt
    fat = [0xFFFFFFFD] + [0xFFFFFFFE] + [0xFFFFFFFF] * (128 - 2)
    pos = 2
    for (start, d) in layout:
        n = secs(d)
        for i in range(n): fat[start + i] = start + i + 1 if i < n - 1 else 0xFFFFFFFE
    assert total <= 128
    def entry(name, typ, left=0xFFFFFFFF, right=0xFFFFFFFF, child=0xFFFFFFFF, start=0, size=0):
        nm = (name + '\x00').encode('utf-16le')
        return nm.ljust(64, b'\x00') + struct.pack('<H', len(nm)) + bytes([typ, 1]) + struct.pack('<III', left, right, child) + b'\x00' * 36 + struct.pack('<I', start) + struct.pack('<II', size, 0)
    ents = [entry('Root Entry', 5, child=1, start=0xFFFFFFFE), entry('FileHeader', 2, right=2 if with_body else 0xFFFFFFFF, start=layout[0][0], size=len(streams[0][1]))]
    if with_body:
        ents.append(entry('BodyText', 1, child=3)); ents.append(entry('Section0', 2, start=layout[1][0], size=len(layout[1][1].rstrip(b'\x00')) if False else streams[1][3]))
    dirb = b''.join(ents).ljust(SS, b'\x00')
    hdr = bytearray(512)
    hdr[0:8] = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); hdr[24:26] = struct.pack('<H', 0x3e); hdr[26:28] = struct.pack('<H', 3)
    hdr[28:30] = struct.pack('<H', 0xFFFE); hdr[30:32] = struct.pack('<H', 9); hdr[32:34] = struct.pack('<H', 6)
    hdr[44:48] = struct.pack('<I', 1); hdr[48:52] = struct.pack('<I', 1); hdr[56:60] = struct.pack('<I', 4096)
    hdr[60:64] = struct.pack('<I', 0xFFFFFFFE); hdr[68:72] = struct.pack('<I', 0xFFFFFFFE)
    hdr[76:80] = struct.pack('<I', 0)
    for i in range(1, 109): hdr[76 + 4 * i: 80 + 4 * i] = struct.pack('<I', 0xFFFFFFFF)
    out = bytes(hdr) + struct.pack('<128I', *fat) + dirb
    for (start, d) in layout: out += d.ljust(secs(d) * SS, b'\x00')
    open(path, 'wb').write(out)

hwp(P('basic.hwp'))
hwp(P('trailing-junk.hwp'), trailing=b'\x00\x00\x00\x00JUNK')
hwp(P('uncompressed.hwp'), flags=0)
hwp(P('encrypted.hwp'), flags=1 | 2)
hwp(P('distribution.hwp'), flags=1 | 4)
hwp(P('no-body.hwp'), with_body=False)
open(P('legacy-doc-like.bin'), 'wb').write(bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) + b'\x00' * 600)
print(sorted(os.listdir(HERE)))
