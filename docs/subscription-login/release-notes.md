# 릴리즈 노트 (초안) — Subscription Login

> Phase 5 §3.2. 실제 버전 번호는 릴리즈 시 확정. feature flag가 default ON이 되는 일반 출시 단계에서 게시.

```markdown
## vX.Y.0 — Subscription Login (Beta)

### 신규 기능
- **ChatGPT Plus 로그인 지원** — API key 없이 ChatGPT Plus 구독으로 사용 가능
- **Claude Pro CLI 위임** — 로컬에 설치된 Claude Code CLI를 통해 Claude Pro 활용 (채팅 전용 MVP)

### 주의사항
- ChatGPT Plus 로그인은 OpenAI의 비공식 엔드포인트를 사용하며, OpenAI 정책 변경 시 차단될 수 있습니다.
- Claude Pro 위임은 별도 Claude Code CLI 설치 + `claude /login` 인증이 필요합니다.
- Claude Pro 위임 모드는 현재 도구 호출/MCP/이미지를 지원하지 않습니다 (일반 채팅만).
- 기존 API key 사용자에게는 영향 없습니다 (설정 → 인증 방식에서 전환 가능).
```

자세한 사용법: [docs/user-guides/subscription-login.md](../user-guides/subscription-login.md)
