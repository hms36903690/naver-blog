# 구현하며 새로 알아낸 것 (원본 명세 3판 이후)

원본 명세(3판 프롬프트)는 이 앱을 만들 때 받은 것으로, 공개 저장소에는 두지 않고 따로 보관합니다. 아래는 그 명세대로 만들면서 **명세에 없던 문제**를
측정으로 특정하고 고친 기록입니다. 다음 개정 때 7장 함정 목록에 추가할 후보입니다.

| # | 증상 | 틀린 추측 | 실제 원인(측정) | 해결 | 위치 |
|---|---|---|---|---|---|
| N-1 | 사진이 **에러 없이** 본문에 안 들어감 | "업로드가 느리다" | 파일명(`사진1.png`)이든 폴더명(`한글폴더/photo1.png`)이든 **경로에 한글**이 있으면 `filechooser.setFiles(경로)` 가 성공한 척 끝나지만 input 의 `change` 가 0회. ASCII 경로면 즉시 1회 | 경로 대신 `{ name: 영문, mimeType, buffer }` 로 넘김 | `lib/naver/publish.ts` |
| N-2 | 비전 판정이 "파일 읽기 권한이 승인되지 않아 볼 수 없다" | — (명세 2-1 은 "프로젝트 밖 경로도 동작(검증됨)") | claude 2.1.x 의 `-p` 는 cwd 밖 `@경로` 읽기를 거부(`permission_denials` 1개). `--add-dir` / `--allowedTools Read` / **cwd=사진 폴더** 셋 다 정답·거부 0 | 사진 폴더를 cwd 로 claude 실행(argv 에 경로를 안 넣어 윈도우 shell 인용 문제 없음) | `lib/claude.ts` |
| N-3 | 윈도우에서 `npm install` 전체 실패 | "인터넷 문제" | better-sqlite3 가 소스 빌드(node-gyp) 시도 → `Could not find any Visual Studio installation` | Node 내장 `node:sqlite` 로 교체 + `.npmrc` `ignore-scripts=true` (sharp 등의 빌드 시도도 차단) | `lib/db.ts`, `.npmrc` |
| N-4 | `start.bat` 을 더블클릭하면 창이 **즉시 사라짐** | — | UTF-8 한글이 든 배치 파일을 윈도우 10 cmd 가 해석 못 함 | 배치 파일은 **ASCII + CRLF** 로만(`.gitattributes` `*.bat -text`) | `start.bat` |
| N-5 | 윈도우 콘솔에 `DEP0190` 경고 | — | Node 24 는 `shell:true` + 인자 배열에 경고 | 윈도우에서는 한 줄 명령 문자열로 spawn | `lib/claude.ts`, `lib/playwright.ts` |
| N-6 | (잠재) 긴 한글 응답 중간 글자 깨짐(�) | — | stdout Buffer 조각을 그대로 `+=` 하면 UTF-8 3바이트가 조각 경계에서 잘림 | `stdout.setEncoding("utf8")` | `lib/claude.ts` |
| N-7 | 사용자 PC 에 `claude` 명령이 안 생김 | — | 최신 npm 은 설치 스크립트를 기본 차단 → claude-code 의 postinstall 미실행 | `npm install -g --allow-scripts=@anthropic-ai/claude-code @anthropic-ai/claude-code` | README |

## 데이터 위치

- 사용자 요청: "새 압축 파일을 풀고 start 만 누르면 되게". 앱 폴더 안 ./data 는 새로 푼 폴더마다 비어 로그인·글투·열쇠가 사라졌다.
  → 데이터와 열쇠 파일을 **사용자 폴더/naver-blog-data** 로 옮겼다. 새 버전 첫 실행 때 바탕화면·다운로드·문서(깊이 3)에서
  예전 앱 폴더(package.json name=naver-blog-auto + data/app.db)를 찾아 가장 최근 것을 복사한다(원본 보존).
  **사용자 PC 확인(2026-11-12): 새로 푼 폴더에서 start → `C:\Users\사용자\naver-blog-data` 로 예전 작업 기록·열쇠·글투가 이어짐.**

## 티스토리 자동 재로그인 (실측)

- 사용자: "몇 번 로그인해도 계속 풀린다". 티스토리 자체 세션이 짧고, 평소 브라우저는 [카카오계정으로 로그인] 한 번으로
  카카오에 남은 로그인으로 다시 들어간다는 가설 → 앱도 로그인 화면을 만나면 그 버튼을 한 번 누른다(비밀번호는 입력하지 않음).
- **실측(실제 tistory.com):** 로그인 화면 버튼은 `a.btn_login.link_kakao_id`("카카오계정으로 로그인", href="#", 같은 창에서
  accounts.kakao.com 으로 이동). 카카오 로그인이 없으면 비밀번호 칸이 나오고 앱은 need_password 로 멈춤을 확인.
- **함정(실측):** 카카오 로그인 주소에는 redirect_uri 로 `www.tistory.com` 이 글자 그대로 들어 있다. 주소 전체에
  `/tistory\.com/` 을 쓰면 카카오 화면을 "티스토리로 돌아왔다"고 착각한다 → **호스트 이름으로만 판정**(isTistoryLoginUrl).
- 카카오 로그인이 살아 있을 때 자동 재로그인되는 흐름은 가짜 화면(scripts/test-relogin.ts)으로만 확인 — 실제 계정으로는 사용자 PC 에서 확인 필요.

## AI 그림

- **실측(사용자 PC):** "얼굴 대신 손·뒷모습" 구도를 권했더니 손이 기형(엄지 없음, 손가락을 관통한 시험관 받침)으로 그려져
  재생성까지 2자리 모두 탈락. → AI 그림은 **사람·손 없이 사물·공간·풍경만, 물건 3~5개 이하**로 바꿈.

## 업데이트

- `update.bat`: 다운로드 폴더의 최신 `naver-blog-main*.zip` 을 풀어 덮어쓰고 `data`·`.env.local`·`node_modules` 는 건드리지 않는다.
  **사용자 PC(윈도우 10, 한글 사용자 폴더 `C:\Users\사용자`)에서 동작 확인**(2026-11-12).

## 티스토리 반자동 (명세 밖 추가 기능)

- 원칙: 이미 애드센스 승인을 받은 블로그를 지키기 위해 **임시저장까지만**. 발행 버튼 셀렉터는 코드에 두지 않고, 테스트가 이를 정적으로 검사한다.
- 본문은 타이핑하지 않고 TinyMCE API(`tinymce.activeEditor.setContent`)로 HTML 을 넣는다(네이버 7장 함정 대부분이 타이핑에서 나왔다).
- 셀렉터(`TISTORY` in `lib/scrape/selectors.ts`)는 **실측 전 후보값**이다 — 개발 환경에서 tistory.com·kakao.com 접속이 막혀 있었다.
  사용자 PC 의 [설정 → 티스토리 화면 점검] 결과(`data/debug/tistory-diagnose-*.json`)로 확정할 것.
- **실측 완료(2026-11, 사용자 PC, bnlife3.tistory.com):** [티스토리 화면 점검]에서 로그인·제목(`textarea#post-title-inp`)·본문(tinymce)·임시저장 버튼 모두 찾음.
  실제 임시저장까지 성공했고, 티스토리 임시저장 목록에 글이 있는 것을 사용자가 확인했다.
  진입 시 "○○에 저장된 글이 있습니다. 이어서 작성하시겠습니까?" 확인창이 실제로 뜬다(앱은 취소=새 글).
- 티스토리 로그인은 이틀 뒤 "풀렸습니다"로 만료됐다(카카오 '로그인 상태 유지' 미체크 추정 — 네이버 7-10 과 같은 계열). 로그인 안내에 체크 문구를 넣었다.
- **원인 특정(로그인이 계속 풀림):** 로그인 정보(storageState)를 로그인할 때 한 번만 저장하고, 이후 사이트가 연장해 준 쿠키를
  버렸다(평소 브라우저는 계속 저장). → 로그인 유지를 확인한 직후(검증 성공·글쓰기 화면 진입)마다 갱신 저장(lib/sessionFile.ts).
  네이버도 같은 구조라 함께 적용. [티스토리 화면 점검]에 로그인 정보 유지 기한과 '세션 쿠키만'(=로그인 상태 유지 꺼짐) 여부 표시.
- 사진 자동 업로드는 v1 에서 하지 않는다(업로드 경로 실측 전). 사진 자리에 안내문 + [사진 폴더 열기].

## 아직 확인하지 못한 것 (네이버 계정 필요 — 9장 6.5-b)

- 살아 있는 스마트에디터에서 7장 셀렉터 실측(조건부 요소 3단계 덤프)
- 실제 발행(비공개)과 게시글 주소 확인
- 네이버 검색 수집(개발 환경에서 네이버 접속이 막혀 있었음 — 필터 로직은 고정 자료로만 검증)
- Cloudflare AI 이미지 생성(열쇠 없음)
- 티스토리: 사진 자동 업로드 경로(아직 미구현)
