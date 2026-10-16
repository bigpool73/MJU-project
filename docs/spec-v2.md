# v2 설계 명세 (PDF 첨부 흐름)

이 문서는 모듈 간 계약이다. 구현은 이 인터페이스를 지킨다. 바꿔야 하면 코드를 고치기 전에 보고한다.

## 사용 흐름
1. **인적사항·과목**: 이름, 학번, 과목, 교수, 과제명, (선택) 과제 안내문
2. **자료 첨부**: 과제 결과물(**PDF**, .txt/.md, 또는 붙여넣기) + AI 대화 **PDF**(여러 개)
3. **분석 결과**: 의존도·주체성, 대화별 연관도(내림차순), 대화 요약, 과제 본문에 AI 반영 부분 토글 표시, 연관도가 낮은 대화 삭제
4. **제출**: 인쇄/PDF + `.json`. 교수는 같은 앱의 ‘교수용’ 탭에서 `.json`을 열어 같은 화면과 검증 결과를 본다.
- 앱 상단과 내역서(화면·인쇄 모두) 머리글에 명지대학교 로고(`assets/mju-logo.jpg`)가 들어간다.

## 왜 링크가 아니라 PDF인가 (사실)
브라우저의 정적 페이지는 `chatgpt.com/share/...` 같은 외부 페이지를 CORS 때문에 읽을 수 없고, 서버가 대신 읽는 방법도 서비스가 봇 접근을 막거나 자바스크립트로 그려서 불안정하다. 반면 학생은 대화 화면에서 Ctrl+P → “PDF로 저장”(또는 서비스의 PDF 내보내기)으로 대화를 PDF로 만들 수 있고, 브라우저가 PDF 텍스트를 직접 추출할 수 있다. 그래서 v2의 입력은 PDF다. 붙여넣기는 PDF가 안 될 때의 보조 수단이다.

### 모르는 것 (구현 시 지어내지 않는다)
서비스별 인쇄 PDF에 “나/ChatGPT” 같은 **역할 표지가 글자로 들어가는지는 확인되지 않았다.** 화면에서 숨겨진 글자는 인쇄에 나오지 않을 수 있다. 그래서:
- 표지가 인식되면 `Parse.parseTranscript`로 턴을 나눈다(`parsed:'ok'`).
- 인식 못 하면 `parsed:'unparsed'`. 이때 텍스트를 문단 묶음(의사 턴, `prompt:''`)으로 나눠 연관도 정렬·삭제가 동작하게 한다. 역할을 모르므로 학생이 AI에게 보낸 자기 글도 응답 쪽으로 세어져 **의존도가 실제보다 높게 나올 수 있다(상한 추정).** UI는 이 상태를 눈에 띄게 알린다.
- 스캔본(글자 없는 이미지 PDF)은 OCR을 지원하지 않는다. 감지해서 안내한다.

## 데이터 모델 (`Doc`)
```
Doc = {
  version: 2,
  meta: { student, studentId, course, professor, assignment, assignmentBrief },
  submission: { text },
  conversations: Conversation[],
  deletions: Deletion[],
  reflection: string,
  claimed: { dependency, autonomy, relevance: { [turnId]: number } } | null,   // export 시 채움
  code: string | null                                                         // export 시 채움
}
Conversation = { id, provider: 'chatgpt'|'claude'|'gemini'|'other', source, parsed: 'ok'|'unparsed', turns: Turn[] }
                 // source: 첨부한 PDF 파일명, 붙여넣기면 ''
Turn         = { id, prompt, response }
Deletion     = { turnId, convId, relevance, chars }     // 삭제된 대화의 내용은 남기지 않는다
```
- 원문(PDF 바이트, 추출한 전체 텍스트)은 저장하지 않는다. 파싱한 `turns`만 저장한다. 삭제한 대화가 원문에 남으면 안 되기 때문이다.
- 분석 결과는 저장하지 않고 항상 `Analyze.run(doc)`으로 다시 계산한다. `claimed`는 검증용 사본이다.

## `Parse` (`src/parse.js`, UMD → `root.Parse`)
```
Parse.detectProvider(url) → { provider, label, valid, url }          // valid: 공유 링크 형식으로 보이는가
Parse.parseTranscript(text) → { turns: [{prompt, response}], ok: boolean, notes: string[] }
```
- 역할 표지는 한국어·영어 UI 둘 다 지원: `나의 말:` `You said:` `User:` `Human:` `사용자` `ChatGPT의 말:` `ChatGPT said:` `Assistant:` `Claude:` `Gemini:` `AI:` `Q:` `A:` 등.
- 표지를 못 찾으면 `ok:false`, 전체를 하나의 응답으로 보존(`prompt:''`), `notes`에 사유.
- 실제 각 서비스의 복사 형식은 검증하지 못했으므로 표지 목록은 확장 가능한 배열로 둔다.

## `Pdf` (`src/pdf.js`, UMD → `root.Pdf`) — PDF 담당
```
Pdf.extract(arrayBuffer) → Promise<{ ok, text, pageCount, notes: string[] }>   // 예외를 던지지 않는다
Pdf.buildText(pages)     → string    // 순수 함수: pages = [{ items: [{ str, x, y, w, h, font? }] }] → 문단이 복원된 텍스트
Pdf.toConversation(text, { fileName, provider? }) → Conversation            // Parse.parseTranscript 사용, 실패 시 의사 턴 분할
Pdf.guessProvider(text) → 'chatgpt'|'claude'|'gemini'|'other'              // 본문 속 서비스명으로 추정, 확신 없으면 'other'
```
- `buildText`는 인쇄 PDF의 머리글/바닥글(날짜, 제목, URL, `n/m` 쪽수)처럼 **쪽마다 반복되는 줄을 제거**하고, 줄 단위로 끊긴 문장을 문단으로 이어 붙인다(세로 간격으로 문단 구분). 분석 엔진이 줄바꿈을 문장 경계로 쓰기 때문에 쪽·줄 바꿈이 문장을 쪼개면 안 된다.
- PDF 라이브러리는 `assets/vendor/pdfjs/` 에 **버전을 고정해 포함**한다(CDN 의존 없음, file://와 https 모두에서 동작해야 함 → 클래식 스크립트 빌드).
- 입력 제한: 파일 30MB, 300쪽 초과 시 `ok:false` + 안내. 암호화·손상 PDF는 `ok:false`.

## `Analyze` (`src/analyze.js`, UMD → `root.Analyze`)
```
Analyze.DELETE_THRESHOLD = 0.15
Analyze.REFUSAL_MESSAGE  = '해당 대화는 과제와 연관도가 높아, 삭제가 불가합니다.'
Analyze.run(doc) → Result
Analyze.canDelete(doc, turnId) → { ok: boolean, relevance: number, message: string }
Analyze.deleteTurn(doc, turnId) → { ok, doc, message }     // 불변: 새 doc 반환. ok면 turns에서 제거하고 deletions에 기록
Analyze.intentLabel(intent) → 한국어 라벨
```
```
Result = {
  turns: TurnResult[],        // 연관도 내림차순 (동점은 대화 순서, 턴 순서)
  sentences: SentenceResult[],// 과제 본문 순서
  summary: {
    dependency: 0..1, autonomy: 0..1 (= 1 - dependency), band: 'low'|'mid'|'high',
    shares: { verbatim, adapted, studentOrigin, original },  // 글자 수 비율, 합 = 1
    sentenceCounts: { verbatim, adapted, studentOrigin, original },
    turnCount, relatedTurnCount, deletableTurnCount,
    intents: { [intent]: number }
  },
  narrative: string[]         // 교수가 읽을 한국어 요약 문장들
}
TurnResult = {
  id, convId, convIndex, index, relevance: 0..1, relevanceLabel: 'high'|'mid'|'low',
  intent: 'generate'|'revise'|'explain'|'ideas'|'outline'|'summarize'|'feedback'|'other',
  promptHead, responseHead,            // 각 80자 이내
  reflected: { verbatim, adapted, studentOrigin },   // 이 턴이 출처로 지목된 문장 수
  deletable: boolean, summaryLine: string
}
SentenceResult = {
  idx, text, start, end,               // start/end: submission.text 안의 오프셋 (text === submission.text.slice(start,end))
  kind: 'verbatim'|'adapted'|'studentOrigin'|'original',
  score: 0..1, source: { turnId, convIndex, turnIndex, snippet } | null
}
```
### 불변 조건
- `relevance`는 **그 턴 자체와 과제(본문+제목+안내문)만으로** 정해진다. 다른 턴을 지워도 남은 턴의 값이 바뀌지 않는다.
- 삭제 규칙: `relevance < DELETE_THRESHOLD`일 때만 삭제 가능. 그 외에는 거부 메시지.
- `studentOrigin`: 학생이 먼저 자기 글을 AI에게 보냈고(교정·피드백 요청) 과제 문장이 그 원문과 더 가까운 경우. AI 응답과 겹쳐도 AI가 쓴 글로 세지 않는다.
- `dependency = (verbatim + 0.5 * adapted)` 글자 비율. `studentOrigin`과 `original`은 주체적 작성으로 본다.
- 같은 입력은 항상 같은 결과(결정적). 난수·시간 사용 금지.
- 한국어는 형태소 분석기 없이 글자 2-gram 기반으로 처리한다. 영어·숫자는 단어 단위. 외부 라이브러리 금지.

### 정직성 규칙 (UI·문구 모두)
- 이 점수는 **글자·단어 겹침에 기반한 추정**이다. AI 탐지기가 아니며, AI 답변을 읽고 자기 말로 다시 쓴 아이디어는 잡지 못한다. 그러므로 하한 추정에 가깝다.
- “표절”, “부정행위”, “AI가 썼다” 같은 단정 표현을 쓰지 않는다. “AI 답변과의 겹침” 같은 근거 중심 표현을 쓴다.
- 붙여넣은 대화는 학생이 고칠 수 있어 링크로 검증되지 않는다. 화면과 내역서에 한계로 적는다.

## `Core` (`src/core.js`)
`newId`, `sha256`, `blankDoc`, `documentCode(doc)`, `verifyDoc(doc, Analyze)`, `formatCode`. 확인 코드는 문서 전체(표지·본문·대화·삭제기록·성찰·`claimed`)의 SHA-256 앞 16자리다. 서명이 아니므로 PDF와 `.json`을 같이 낼 때 둘이 일치하는지 보는 용도다.

## 파일 소유권 (병렬 작업 시 충돌 방지)
- `src/analyze.js`, `test/analyze.test.js`, `test/fixtures/` → 엔진 담당
- `src/parse.js`, `test/parse.test.js` → 파서 담당
- `src/pdf.js`, `test/pdf.test.js`, `test/pdf-fixtures/`, `assets/vendor/pdfjs/` → PDF 담당
- `test/heldout/`, `test/heldout.test.js` → 블라인드 검증 담당 (엔진 구현을 읽지 않는다)
- `index.html`, `src/app.js`, `src/style.css` → 화면 담당
- `src/core.js`, `test/core.test.js`, `docs/spec-v2.md` → 조정자
