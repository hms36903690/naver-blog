// 클라이언트·서버 공용(DB 를 import 하지 않는 순수 상수)
export type Visibility = "public" | "neighbor" | "both" | "private";
export const VISIBILITIES: Visibility[] = ["public", "neighbor", "both", "private"];
export const VISIBILITY_LABEL: Record<Visibility, string> = {
  public: "전체공개",
  neighbor: "이웃공개",
  both: "서로이웃공개",
  private: "비공개",
};
export const STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  scraping: "자료 모으는 중",
  writing: "글 쓰는 중",
  imaging: "사진 준비 중",
  publishing: "글쓰기 화면 입력 중",
  done: "완료",
  failed: "실패",
  canceled: "취소됨",
};
export const POST_LABEL: Record<string, string> = {
  published: "발행됨",
  dry_run: "연습 완료",
  failed: "발행 실패",
  blocked: "발행 막힘",
  pending: "대기",
  publishing: "발행 중",
};
