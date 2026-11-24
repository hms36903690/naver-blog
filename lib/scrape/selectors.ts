/**
 * ★ 네이버 셀렉터 중앙 관리 — 네이버 DOM 이 바뀌면 이 파일 하나만 고친다.
 *
 * 아래 값은 살아 있는 스마트에디터 ONE 에서 클릭까지 확인한 "실측값"이다. 리팩터링·정리·통합 대상이 아니다.
 * 각 항목은 후보 배열: 위에서부터 isVisible 인 첫 번째를 쓴다.
 * 새로 측정한 값은 배열 "앞"에 추가하고, 기존 값은 지우지 말고 뒤에 남긴다
 * (다른 계정·시점·A/B 에서는 그쪽이 맞을 수 있다).
 */
export const EDITOR = {
  frame: "iframe#mainFrame",

  restorePopup: [".se-popup-container", ".se-popup-dialog", ".se-popup", "[class*='popup_container']"],
  // ⚠️ 7-1 ★최악: `button:has-text('취소')` 는 부분일치라 툴바의 '취소선' 버튼을 누른다 →
  //   글 전체에 취소선이 그어진 채 발행됨. (틀린 추측: "물결표가 마크다운 취소선으로 변환됐다" — DB 에 물결표 0개였다)
  //   클래스 기반을 먼저, 텍스트는 반드시 팝업 안으로 스코프 + :text-is() 정확일치.
  restoreCancel: [
    "button.se-popup-button-cancel",
    ".se-popup-button-cancel",
    ".se-popup-container button:text-is('취소')",
    ".se-popup-dialog button:text-is('취소')",
    ".se-popup button:text-is('취소')",
  ],

  title: [".se-section-documentTitle .se-text-paragraph", ".se-documentTitle .se-text-paragraph", ".se-title-text"],
  body: [".se-section-text .se-text-paragraph", ".se-component-content .se-text-paragraph", ".se-main-container"],

  imageButton: [
    "button.se-image-toolbar-button",
    "button[data-name='image']",
    "button[data-log='sti.image']",
    "button.se-toolbar-item-image",
  ],

  // ⚠️ 7-4: 진입 시 자동으로 뜨는 도움말 패널이 우측 전체와 발행 버튼을 가린다.
  helpPanel: [".se-help-container", ".se-help-panel"],
  helpClose: [".se-help-panel-close-button", ".se-help-header button"],
  // ⚠️ 7-3: 복원 팝업과 함께 깔리는 반투명 차단막. 남아 있으면 발행 클릭이 에러 없이 무시된다.
  popupDim: [".se-popup-dim"],

  textFormatOpen: [".se-text-format-toolbar-button"],
  optHeading: [".se-toolbar-option-text-format-sectionTitle-button"],
  optBody: [".se-toolbar-option-text-format-text-button"],
  optQuote: [".se-toolbar-option-text-format-quotation-button"],
  dividerInsert: [".se-insert-horizontal-line-default-toolbar-button"],
  bold: [".se-bold-toolbar-button"],
  bgColorOpen: [".se-background-color-toolbar-button"],
  bgColorYellow: ["button[title='#fff8b2']", ".se-color-palette[title='#fff8b2']"],
  bgColorNone: [".se-color-palette-no-color"],
  contentComponents: [".se-content .se-component"],
  content: [".se-content"],

  // ⚠️ 7-2: `:has-text('발행')` 은 '예약 발행 0건' 을 누른다. 데이터 속성을 쓴다.
  publishOpen: ["button[data-click-area='tpb.publish']", "button.publish_btn__m9KHH"],
  // 최종 확인 버튼 — 값에 `*` 가 들어간 것이 맞다(오타 아님).
  publishConfirm: ["button[data-click-area='tpb*i.publish']", "button.confirm_btn__WEaBq"],

  // ⚠️ 7-19: radio input 은 opacity:0 이라 클릭되지 않는다. label 을 누르고 input.checked 로 확인.
  //   네이버 발행 레이어의 기본값은 "전체공개"(open_public, value=2)다.
  visibility: {
    public: { label: 'label[for="open_public"]', input: "#open_public" },
    neighbor: { label: 'label[for="open_neighbor"]', input: "#open_neighbor" },
    both: { label: 'label[for="open_both_neighbor"]', input: "#open_both_neighbor" },
    private: { label: 'label[for="open_private"]', input: "#open_private" },
  },

  // ⚠️ 7-18: 업로드 직후 캡션은 0×0. 이미지 컴포넌트를 클릭해야 펼쳐지고 `se-is-on` 이 붙는다.
  //   크기 숫자(640×24 / 64×63)는 환경마다 달라 판정 기준으로 쓰지 않는다.
  caption: [".se-caption"],
  imageComponent: [".se-content .se-component.se-image"],

  // ⚠️ 7-21: 사진을 넣으면 우측 "라이브러리" 도크가 자동으로 열린다. 계열이 환경마다 다르다 → 둘 다 시도.
  sidebarClose: [".se-help-panel-close-button", ".se-sidebar-close-button"],
  sidebar: [".se-sidebar", ".se-sidebar-container-library"],

  // ⚠️ 7-6: 하단 글감 검색바. 탈출 클릭 y 를 아무렇게나 잡으면 여기로 포커스가 가 캡션이 검색창에 타이핑된다.
  bottomToolbar: [".se-flayer-unified-toolbar-wrapper"],
  bottomSearchInput: [".se-flayer-unified-search-input"],
} as const;

export const NAVER = {
  loginUrl: "https://nid.naver.com/nidlogin.login",
  myBlog: "https://blog.naver.com/MyBlog.naver",
  writeUrl: (blogId: string) => `https://blog.naver.com/${blogId}?Redirect=Write&categoryNo=0`,
  // ⚠️ 7-11: 게시글 주소로 이동해야 진짜 발행. 글쓰기 URL 이 그대로면 임시저장 상태다.
  postUrlRe: /blog\.naver\.com\/[^/?#]+\/\d{6,}/,
  newsSearch: (q: string) => `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(q)}&sort=1`,
  blogSearch: (q: string) => `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(q)}`,
  imageSearch: (q: string) => `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(q)}`,
  googleImageSearch: (q: string) => `https://www.google.com/search?tbm=isch&hl=ko&q=${encodeURIComponent(q)}`,
};

/**
 * 티스토리 글쓰기 화면 — ⚠️ 아직 "실측 전" 후보값이다(개발 환경에서 티스토리 접속이 막혀 있었다).
 * 사용자 PC 에서 [티스토리 화면 점검] 으로 실측한 값을 각 배열 "앞"에 추가하고, 기존 값은 남겨라.
 *
 * ⚠️ 반자동 원칙: 이 앱은 티스토리에서 "임시저장"까지만 한다. 발행(완료/공개발행) 버튼의 셀렉터는
 *   일부러 여기에 두지 않는다 — 코드 어디에도 발행 버튼을 누르는 경로가 없어야 한다.
 */
export const TISTORY = {
  loginUrl: "https://www.tistory.com/auth/login",
  home: "https://www.tistory.com/",
  newPost: (blog: string) => `https://${blog}.tistory.com/manage/newpost/`,
  manage: (blog: string) => `https://${blog}.tistory.com/manage`,
  /** 로그인 판정 쿠키 후보(실측 전) */
  sessionCookies: ["TSSESSION"],
  /**
   * 티스토리 로그인 화면의 "카카오계정으로 로그인" 버튼(실측 전 후보).
   * 티스토리 자체 로그인이 끝나도 카카오 쪽 로그인이 살아 있으면 이 버튼 한 번으로 비밀번호 없이 다시 들어간다(평소 브라우저가 하는 일).
   * ⚠️ 텍스트 부분일치는 이 화면에 비슷한 버튼이 없어 허용(7-1 의 '취소선' 같은 함정 없음) — 실측되면 클래스 값을 앞에 추가.
   */
  kakaoLoginButton: ["a.btn_login.link_kakao_id", "a.link_kakao_id", "a:has-text('카카오계정으로 로그인')", "button:has-text('카카오계정으로 로그인')"],
  title: ["textarea#post-title-inp", "#post-title-inp", "textarea[placeholder*='제목']", "input[placeholder*='제목']"],
  /** TinyMCE 편집 영역 iframe 후보(본문은 가능하면 tinymce API 로 넣는다) */
  editorFrame: ["iframe#editor-tistory_ifr", "iframe[id$='_ifr']", ".mce-edit-area iframe", ".tox-edit-area iframe"],
  // ⚠️ 7-1 교훈: 텍스트 부분일치는 엉뚱한 버튼을 누른다. 클래스 → 정확일치 순. "임시저장" 은 발행 계열과 겹치지 않는다.
  draftSave: ["button.btn-draft", "a.btn-draft", ".btn-draft button", "button:text-is('임시저장')", "a:text-is('임시저장')"],
} as const;
