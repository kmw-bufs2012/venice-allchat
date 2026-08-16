/**
 * Korean glosses for Venice's English model descriptions.
 *
 * Venice serves descriptions in English only. Rather than machine-translating
 * at request time (slow, costs tokens per model), we describe each model by its
 * family — the id encodes the lineage (llama, deepseek, qwen, dolphin, …) — and
 * keep the English original alongside for the tooltip. Unknown families fall
 * back to the English text so nothing is ever lost or invented.
 */

interface FamilyRule {
  pattern: RegExp;
  ko: string;
}

const FAMILY_RULES: FamilyRule[] = [
  { pattern: /dolphin/i, ko: "무검열 튜닝 계열 모델로, 제한 없이 자연스러운 답변을 생성합니다." },
  { pattern: /venice-uncensored/i, ko: "Venice 자체 무검열 튜닝 모델입니다." },
  { pattern: /claude|anthropic/i, ko: "Anthropic Claude 모델 — 복잡한 추론·코딩·장기 과제에 최적화된 최상위 성능 모델입니다." },
  { pattern: /gemini/i, ko: "구글 Gemini 모델 — 멀티모달 이해와 범용 작업 처리에 강합니다." },
  { pattern: /grok|xai/i, ko: "xAI Grok 모델 — 실시간성과 직설적인 답변이 특징입니다." },
  { pattern: /gpt|openai|o[34](-mini)?$/i, ko: "OpenAI 계열 모델 — 범용 대화와 과제 처리에 강한 성능을 제공합니다." },
  { pattern: /deepseek-r/i, ko: "DeepSeek 추론(R) 모델 — 수학·코딩 등 복잡한 추론 과제에 강합니다." },
  { pattern: /deepseek/i, ko: "DeepSeek의 고성능 범용 모델 — 긴 문맥 이해와 코딩에 강점이 있습니다." },
  { pattern: /qwen.*coder|coder.*qwen/i, ko: "알리바바 Qwen 코딩 특화 모델 — 코드 생성·수정에 최적화되어 있습니다." },
  { pattern: /qwen/i, ko: "알리바바 Qwen 범용 모델 — 한국어를 포함한 다국어 처리에 강합니다." },
  { pattern: /llama.*vision|vision.*llama/i, ko: "메타 Llama 비전 모델 — 이미지를 입력으로 이해할 수 있습니다." },
  { pattern: /llama/i, ko: "메타 Llama 계열 범용 모델 — 균형 잡힌 대화·작업 처리 성능을 제공합니다." },
  { pattern: /mistral.*code|codestral/i, ko: "Mistral 코딩 특화 모델 — 코드 생성과 리뷰에 최적화되어 있습니다." },
  { pattern: /mistral/i, ko: "Mistral 계열 모델 — 빠른 응답과 효율적인 추론이 특징입니다." },
  { pattern: /kimi/i, ko: "Moonshot Kimi 모델 — 초장문 문서 이해와 멀티모달 처리에 강합니다." },
  { pattern: /glm/i, ko: "Z.ai GLM 모델 — 한국어·중국어 등 다국어 대화 성능이 우수합니다." },
  { pattern: /gemma/i, ko: "구글 Gemma 경량 모델 — 빠르고 효율적인 응답에 적합합니다." },
  { pattern: /phi/i, ko: "마이크로소프트 Phi 소형 모델 — 가벼운 워크로드에서 빠른 응답을 제공합니다." },
  { pattern: /hunyuan/i, ko: "텐센트 Hunyuan 모델 — 다국어 범용 대화 성능을 제공합니다." },
  { pattern: /coder|code-/i, ko: "코딩 특화 모델 — 코드 생성·디버깅에 최적화되어 있습니다." },
  { pattern: /vision|vl(?!a)/i, ko: "비전 언어 모델 — 이미지 입력을 이해할 수 있습니다." },
];

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

/** Returns a Korean description for the model, or the English original. */
export function koreanDescription(id: string, englishDescription: string): string {
  const rule = FAMILY_RULES.find((r) => r.pattern.test(id));
  return rule ? rule.ko : englishDescription;
}
