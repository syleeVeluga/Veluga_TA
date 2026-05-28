# 00 — 개요 (Overview)

## 1. 문제 정의

현재 Veluga_TA는 사용자가 LLM을 사용하려면 **OpenAI / Anthropic API key**를 별도로 발급받고 결제 수단을 등록해야 한다. 그러나 실제 잠재 사용자 다수는:

- 이미 **ChatGPT Plus** ($20/월) 구독을 보유 — 추가 API 결제는 이중 지출
- 이미 **Claude Pro** ($20/월) 구독을 보유 — API key 발급 절차 자체가 낯섦
- API 사용량 기반 과금에 대한 심리적 저항 (지출 예측 불가)

→ **진입 장벽이 도입률을 누르고 있음.**

## 2. 목표

| 항목 | 현재 | 목표 |
|---|---|---|
| OpenAI 인증 | API key만 | API key **또는** ChatGPT Plus OAuth |
| Anthropic 인증 | API key만 | API key **또는** Claude Pro (Claude Code CLI 위임) |
| Gemini 인증 | API key만 | (이번 범위 제외) |
| 사용자 결제 | 별도 OpenAI/Anthropic 결제 필수 | 기존 구독 그대로 활용 가능 |
| 설정 복잡도 | API key 복붙 | "ChatGPT Plus로 로그인" 버튼 한 번 |

## 3. 확정 결정 사항 (사용자 합의 — 2026-05-28)

1. **도입 대상**: ChatGPT Plus(OAuth PKCE) + Claude Pro(Claude Code CLI 위임)
2. **제외 대상**: Gemini Advanced — `v1internal` 비공식 endpoint를 사용해야 하므로 보수적 입장과 충돌
3. **인증 방식 공존**: 기존 API key 사용자에게 0의 영향. 사용자가 설정에서 토글
4. **ToS 입장**: **보수적** — 공식 CLI(OpenAI Codex, Claude Code)가 사용하는 endpoint·flow와 동일한 패턴만 채택
5. **토큰 저장**: 기존 `packages/cowork-core/src/main/utils/store-encryption.ts` (electron-store + scrypt + AES-256) 재사용. 별도 keychain 도입 안 함

## 4. 현재 상태 vs 목표 상태

### 현재
```
사용자 → 설정 → API key 입력 → store-encryption 저장 → AuthStorage.setRuntimeApiKey('openai', sk-...)
                                                            → OpenAI SDK가 Bearer 헤더로 전송
```

### 목표 (ChatGPT Plus OAuth 경로 추가)
```
사용자 → 설정 → "ChatGPT Plus 로그인" 클릭
       → Main 프로세스가 localhost 콜백 서버 기동 + 브라우저 열기
       → 사용자가 OpenAI 인증 페이지에서 로그인
       → 콜백으로 code 수신 → PKCE verifier로 token 교환
       → {access_token, refresh_token, expires_at} 암호화 저장
       → Agent 실행 시 만료 체크 → 필요 시 refresh → setRuntimeApiKey('openai', access_token)
       → OpenAI SDK가 Bearer로 전송 (단, baseURL은 chatgpt.com/backend-api/codex/responses)
```

### 목표 (Claude Pro CLI 위임 경로 추가)
```
사용자 → 설정 → "Claude Pro (Claude Code 위임)" 선택
       → Main이 claude CLI 바이너리 탐지 (which/where + npm global)
       → 미설치 시 설치 안내 표시
       → Agent 실행 시 child_process.spawn('claude', [...]) — stdio JSON-RPC
       → Claude Code가 이미 가진 인증으로 응답 처리
       → Veluga는 어떤 credential도 저장하지 않음
```

## 5. 하드 제약 (Hard Constraints)

| # | 제약 | 이유 |
|---|---|---|
| HC-1 | **API key 방식 제거 금지** | 회귀 방지 + 사용자 선택권 보장 |
| HC-2 | **pi-ai / pi-coding-agent 수정 금지** | upstream fork 정책 ([agent-orchestration-plan](../agent-orchestration-plan/00-overview.md)와 동일) — `setRuntimeApiKey()` 등 공개 API만 사용 |
| HC-3 | **OAuth 토큰 로그 출력 금지** | 첫 4자만 표시 후 마스킹 (`sk-abc***`), 전체값 절대 dump 안 함 |
| HC-4 | **Gemini 도입 금지** | 사용자 결정 — ToS 보수적 입장 |
| HC-5 | **Renderer 프로세스에 평문 토큰 전송 금지** | 모든 토큰은 main 프로세스에서만 보관, renderer에는 "로그인됨 / 만료 시각" 메타데이터만 |
| HC-6 | **첫 OAuth 시 ToS 고지 의무** | dialog로 비공식 endpoint 사용 명시 후 사용자 동의 |
| HC-7 | **킬스위치 필수** | feature flag `subscription_login.enabled=false` 시 OAuth/CLI 분기 모두 비활성, API key only로 fallback |
| HC-8 | **token refresh는 main에서만** | renderer가 refresh 호출 가능하면 안 됨, main의 timer 또는 lazy refresh로 처리 |

## 6. 범위 밖 (Out of Scope)

- Gemini Advanced 구독 로그인
- Microsoft Copilot / GitHub Copilot 구독 통합 (별도 검토)
- 조직 SSO (SAML/OIDC) — 개인 사용자 대상 우선
- 토큰 동기화 (여러 디바이스 간) — 로컬 only
- Claude Code CLI 자동 설치 — 사용자가 직접 설치하도록 안내만

## 7. 성공 기준

- ChatGPT Plus 가입자가 API key 없이 Veluga에서 정상 채팅 가능
- Claude Pro 가입자가 Claude Code CLI 설치만으로 Veluga 통합 가능
- 기존 API key 사용자 0% 영향 (회귀 테스트 통과)
- OAuth 토큰 만료/갱신이 사용자 개입 없이 동작
- 토큰 dump/유출 보안 사고 0건 (정적 분석 + 로그 감사)
