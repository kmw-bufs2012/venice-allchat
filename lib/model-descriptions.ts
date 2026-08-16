/** Trait labels shown under the model selector, translated where known. */
export function traitLabel(trait: string): string {
  const map: Record<string, string> = {
    default: "기본 모델",
    fastest: "가장 빠름",
    "default_code": "코딩 기본",
    "optimized-for-code": "코딩 최적화",
    "long-context": "장문 컨텍스트",
    "system-safety-message": "Venice 기본 시스템 프롬프트 사용",
  };
  return map[trait] ?? trait;
}
