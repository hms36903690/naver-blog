/**
 * Cloudflare Workers AI 단가 — 서버·클라이언트 공용 순수 함수.
 * ⚠️ 7-12: "타일×4.8 + 스텝×9.6" 이 아니다. 스텝 요금은 "타일마다" 붙는다.
 *   잘못: 4×4.8 + 6×9.6 = 76.8/장   맞음: 4×(4.8 + 6×9.6) = 249.6/장 (실측 7,738 ÷ 31장 = 249.6)
 * ⚠️ 반환값은 정수가 아니다(6스텝 = 249.6). 계산은 실수로, 화면 표시할 때만 Math.round().
 */
export function neuronsPerImage(steps: number, size = 1024): number {
  const tiles = Math.max(1, Math.round((size / 512) * (size / 512)));
  return tiles * (4.8 + Math.min(Math.max(steps, 1), 8) * 9.6);
}

export const FREE_DAILY_NEURONS = 10_000;

export const imagesPerDay = (steps: number) => Math.floor(FREE_DAILY_NEURONS / neuronsPerImage(steps));
