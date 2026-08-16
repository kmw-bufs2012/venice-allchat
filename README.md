# Venice AllChat

올인원 멀티 모델 AI 챗봇 플랫폼 — [Venice.ai](https://venice.ai)의 모든 LLM 채팅 모델(무검열 모델 포함)을 하나의 화면에서 스트리밍으로 대화합니다.

디자인(팔레트·폰트·카드 스타일)과 아이디/비밀번호 로그인 시스템은
[kmw-bufs2012/multi-image-studio](https://github.com/kmw-bufs2012/multi-image-studio)에서 가져왔습니다.

## 기능

- Venice.ai 전체 텍스트 모델 자동 목록 (`/models?type=text`, 무검열 모델 배지 표시)
- 실시간 스트리밍 채팅 (SSE, 토큰 단위 렌더링)
- 시스템 프롬프트 / 온도 조절 / 다중 턴 대화
- 라이트·다크·시스템 테마 토글
- 아이디 + 비밀번호 로그인 (HMAC 서명 세션 쿠키, 전 페이지 보호)

## 환경 변수

| 변수 | 설명 |
|---|---|
| `VENICE_API_KEY` | Venice.ai API 키 (필수) |
| `DEEPL_API_KEY` | DeepL API 키 (선택) — 모델 설명을 원문 그대로 한국어 번역. 무료 키(`:fx`로 끝) 자동 인식 |
| `APP_USERNAME` | 로그인 아이디 (선택) |
| `APP_PASSWORD` | 로그인 비밀번호 (필수) |
| `SESSION_SECRET` | 세션 서명 시크릿 (선택, 없으면 APP_PASSWORD 사용) |

## 개발

```bash
npm install
npm run dev
```

## Vercel 배포

1. 이 리포지토리를 Vercel에서 Import
2. Project Settings → Environment Variables에 위 환경 변수 입력
3. Deploy
