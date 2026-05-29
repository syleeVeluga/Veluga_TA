# 구독 로그인 (ChatGPT Plus · Claude Pro)

Veluga는 API 키 없이도 **ChatGPT Plus** 또는 **Claude Pro** 구독으로 모델을 사용할 수 있습니다. 기존 API 키 방식은 그대로 유지되며, 설정에서 언제든 전환할 수 있습니다.

> 이 기능은 feature flag(`subscription_login`) 뒤에서 점진적으로 배포됩니다. 설정 화면에 인증 방식 선택지가 보이지 않으면 아직 활성화되지 않은 것입니다.

---

## ChatGPT Plus 로그인

1. **설정 → API → 인증 방식**에서 `ChatGPT Plus`를 선택합니다. (Provider가 `OpenAI`일 때만 표시)
2. **ChatGPT Plus 로그인** 버튼을 누릅니다.
3. 처음 사용할 때 비공식 엔드포인트 사용에 대한 **안내 dialog**가 한 번 표시됩니다. 내용을 확인하고 동의하면 진행됩니다.
4. 브라우저가 열리면 OpenAI 계정으로 로그인합니다. 완료되면 Veluga로 자동 복귀합니다.
5. 로그인되면 만료 시각이 표시되며, 토큰은 자동 갱신됩니다.

로그아웃하려면 같은 화면의 **로그아웃** 버튼을 누릅니다. (자동으로 API 키 방식으로 되돌아갑니다.)

> ⚠️ ChatGPT Plus 로그인은 공식 OpenAI API가 아닌 ChatGPT 내부 엔드포인트를 사용합니다. OpenAI가 정책을 변경하면 동작이 중단될 수 있으며, 그 경우 Veluga가 안내합니다.

## Claude Pro 연동 (Claude Code CLI 위임)

Claude Pro는 로컬에 설치된 **Claude Code CLI**에 채팅을 위임하는 방식입니다. Veluga는 Anthropic 토큰을 저장하지 않습니다 — 인증은 전적으로 CLI가 처리합니다.

1. [Claude Code CLI](https://docs.claude.com/en/docs/claude-code)를 설치합니다.
2. 터미널에서 `claude /login`을 실행해 Claude Pro 계정으로 로그인합니다.
3. **설정 → API → 인증 방식**에서 `Claude Pro`를 선택합니다. (Provider가 `Anthropic`일 때만 표시)
4. 패널에서 CLI 설치/인증 상태가 자동 감지됩니다. 상태를 바꾼 뒤에는 **다시 확인**을 누르세요.
5. "인증됨"이 표시되면 사용할 준비가 된 것입니다.

> ⓘ 현재(MVP) Claude Pro 위임 모드에서는 **도구 호출(Tool use), MCP, 이미지가 지원되지 않습니다.** 일반 채팅만 가능합니다.

---

## 자주 묻는 질문 (FAQ)

**Q. 기존 API 키는 어떻게 되나요?**
A. 그대로 사용할 수 있습니다. 인증 방식은 설정에서 언제든 전환할 수 있고, API 키는 삭제되지 않습니다.

**Q. 토큰은 어디에 저장되나요?**
A. ChatGPT Plus 토큰은 로컬 암호화 저장소(`electron-store` + AES-256)에만 저장됩니다. Claude Pro의 토큰은 Veluga가 보관하지 않으며 Claude Code CLI가 관리합니다.

**Q. OpenAI/Anthropic이 이 기능을 차단할 수 있나요?**
A. 가능합니다. 그 경우 자동으로 오류를 안내하며, 언제든 API 키 방식으로 되돌릴 수 있습니다.

**Q. 여러 계정을 사용할 수 있나요?**
A. 기존 구성 세트(Config Set) 시스템(`createSet` / `switchSet`)으로 분리해 사용할 수 있습니다.

**Q. 토큰이 로그에 남나요?**
A. 아니요. 액세스/리프레시 토큰, JWT, API 키는 모두 로그에서 마스킹됩니다.
