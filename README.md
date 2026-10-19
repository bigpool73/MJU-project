# AI 사용 내역서

2026학년도 AI 리터러시 경진대회 출품작. 학생이 AI와 나눈 대화(PDF)와 과제를 올리면, 과제의 어느 문장이 AI 답변과 겹치는지를
근거와 함께 보여 주는 제출용 내역서를 만든다. 사이트: https://bigpool73.github.io/MJU-project/

## 쓰는 법
1. 이름·과목·과제명을 적는다.
2. **과제 결과물**을 올린다: PDF, 한글(`.hwp`, `.hwpx`), 워드(`.docx`), `.txt`/`.md`, 또는 붙여넣기.
   **AI 대화**는 대화 화면에서 `Ctrl+P → PDF로 저장`한 파일을 올린다.
3. 분석 결과를 본다: AI 의존도·주체성(%), 대화별 연관도(높은 순), 본문에서 AI 반영 부분 표시.
   과제와 관련 없는 대화(연관도 15% 미만)는 지울 수 있고, 관련 높은 대화는 지울 수 없다.
4. 내역서(PDF로 저장)와 확인 파일(.json)을 과제와 함께 낸다. 교수는 ‘교수용 확인’ 탭에서 .json을 열어 읽기 전용 화면과 변조 여부를 본다.

모든 처리는 브라우저 안에서만 이뤄지고 서버로 보내지 않는다.

## 읽을 수 있는 파일
| 형식 | 비고 |
|---|---|
| PDF | 글자가 있는 PDF. 스캔본(이미지)은 읽지 못한다. 쪽마다 반복되는 머리글·바닥글은 지운다 |
| .docx | 문단, 표 칸, 탭, 줄바꿈 |
| .hwpx | 구역 순서대로, 표 칸 포함 |
| .hwp | 한글 5.x. 암호 문서와 **배포용(복사 방지) 문서는 읽지 못한다** |
| .doc | 구형 워드는 읽지 못한다. .docx나 PDF로 저장해서 올린다 |

그림·도형 안의 글자는 읽지 못한다. 읽은 결과는 본문 칸에 보이므로 빠진 곳을 확인하고 고칠 수 있다.

## 한계
- 겹침 기반 **추정**이다. AI 탐지기가 아니며, AI 답변을 읽고 자기 말로 다시 쓴 내용은 놓칠 수 있어 하한에 가깝다.
- 대화 PDF가 원본인지는 검증하지 못한다.
- 확인한 대화 PDF 형식은 한국어 화면의 ChatGPT, Gemini(Chrome 인쇄)와 Claude(Claude Exporter 확장 프로그램의 PDF)다. 각각 실제 파일 1건씩이다. 역할 표지를 못 찾으면 의존도가 높게 나올 수 있다고 화면에 알린다.
- 한글(.hwp)은 실제 한글 양식 파일 1건과 직접 만든 시험 파일로 확인했다.

## 개발
```bash
node --test test/*.test.js     # 단위 시험 (헬드아웃 일부는 알려진 실패 1건)
node test/e2e.js               # 브라우저 시험 (Playwright, 전역 설치 필요)
node scripts/bundle.js out.html  # 단일 HTML
python3 test/pdf-fixtures/build.py 또는 node test/pdf-fixtures/build.js ; python3 test/doc-fixtures/build.py   # 시험 파일 재생성
```
- `src/analyze.js` 겹침·연관도 분석, `src/parse.js` 대화 역할 나누기, `src/pdf.js` PDF 글자 추출, `src/docs.js` 한글·워드 글자 추출,
  `src/core.js` 문서 구조·확인 코드, `src/app.js` 화면. 계약은 `docs/spec-v2.md`.
- 외부 라이브러리는 PDF용 pdf.js(`assets/vendor/pdfjs`, Apache-2.0) 하나뿐이다.
