---
layout: home
head:
  - - link
    - rel: canonical
      href: https://opencoworkai.github.io/open-cowork/ko/
  - - link
    - rel: alternate
      hreflang: en
      href: https://opencoworkai.github.io/open-cowork/
  - - link
    - rel: alternate
      hreflang: ko
      href: https://opencoworkai.github.io/open-cowork/ko/
  - - link
    - rel: alternate
      hreflang: x-default
      href: https://opencoworkai.github.io/open-cowork/

hero:
  name: Open Cowork
  text: 오픈소스 AI 에이전트 데스크톱 앱
  tagline: Windows & macOS 원클릭 설치. 멀티 모델 지원, VM 샌드박스 격리, 내장 Skills 시스템, MCP 통합 — 코딩 지식 불필요.
  image:
    src: /logo.png
    alt: Open Cowork Logo
  actions:
    - theme: brand
      text: 다운로드
      link: https://github.com/OpenCoworkAI/open-cowork/releases
    - theme: alt
      text: GitHub 저장소
      link: https://github.com/OpenCoworkAI/open-cowork

features:
  - icon: 🚀
    title: 원클릭 설치, 바로 사용
    details: Windows (.exe) 및 macOS (.dmg) 사전 빌드 설치 패키지 제공. Homebrew로도 설치 가능. 터미널이나 코딩 지식 불필요.
  - icon: 🤖
    title: 유연한 멀티 모델 지원
    details: Claude, GPT, Gemini, DeepSeek, GLM, MiniMax, Kimi 등 지원. OpenAI 호환 API를 제공하는 모든 서비스 사용 가능.
  - icon: 🔒
    title: VM 수준 보안 격리
    details: WSL2 (Windows) 및 Lima (macOS) 기반 가상 머신 격리. AI 명령이 안전한 Linux 환경에서 실행되어 호스트 시스템을 보호.
  - icon: 🧰
    title: 내장 Skills 시스템
    details: PPTX, DOCX, XLSX, PDF 문서를 원클릭으로 생성. skill-creator 툴킷으로 커스텀 스킬 개발 가능.
  - icon: 🔌
    title: MCP 외부 도구 연동
    details: Model Context Protocol을 통해 브라우저, Notion 등 데스크톱 앱 연결. AI 기능을 파일 관리 너머로 확장.
  - icon: 🖥️
    title: GUI 자동화
    details: 컴퓨터 사용(computer use)으로 데스크톱 GUI 앱 제어 및 자동화. 최적 모델로 Gemini-3-Pro 권장.
  - icon: 📡
    title: 원격 제어
    details: Feishu(Lark) 및 Slack 연동으로 명령 전송 및 결과 수신. 협업 플랫폼을 통한 워크플로우 자동화.
  - icon: 🛡️
    title: 무료 오픈소스
    details: MIT 라이선스. 완전 투명한 코드베이스. 데이터는 로컬에서만 처리 — 원격 측정 없음, Open Cowork 서버로 데이터 전송 없음.
---

<style>
.faq-section {
  max-width: 800px;
  margin: 0 auto;
  padding: 48px 24px;
}
.faq-section h2 {
  text-align: center;
  font-size: 2em;
  margin-bottom: 32px;
}
.faq-item {
  margin-bottom: 24px;
}
.faq-item h3 {
  font-size: 1.1em;
  margin-bottom: 8px;
}
.faq-item p {
  color: var(--vp-c-text-2);
  line-height: 1.7;
}

.comparison-section {
  max-width: 700px;
  margin: 0 auto;
  padding: 32px 24px 48px;
}
.comparison-section h2 {
  text-align: center;
  font-size: 2em;
  margin-bottom: 24px;
}
.comparison-section table {
  width: 100%;
  border-collapse: collapse;
}
.comparison-section th, .comparison-section td {
  padding: 12px 16px;
  border: 1px solid var(--vp-c-divider);
  text-align: center;
}
.comparison-section th {
  background: var(--vp-c-bg-soft);
}

.install-section {
  max-width: 700px;
  margin: 0 auto;
  padding: 32px 24px;
}
.install-section h2 {
  text-align: center;
  font-size: 2em;
  margin-bottom: 24px;
}
</style>

<div class="comparison-section">

## 기능 비교

|                 | MCP & Skills | 원격 제어 | GUI 자동화 |
| --------------- | :----------: | :-------: | :--------: |
| Claude Cowork   |      ✓       |     ✗     |     ✗      |
| **Open Cowork** |    **✓**     |   **✓**   |   **✓**    |

</div>

<div class="install-section">

## 빠른 설치

**macOS (Homebrew)**

```bash
brew tap OpenCoworkAI/tap
brew install --cask --no-quarantine open-cowork
```

**Windows / macOS** — [다운로드 페이지로 이동 →](https://github.com/OpenCoworkAI/open-cowork/releases)

</div>

<div class="faq-section">

## 자주 묻는 질문

<div class="faq-item">

### Open Cowork이란 무엇인가요?

Open Cowork은 Windows와 macOS를 위한 무료 오픈소스 AI 에이전트 데스크톱 애플리케이션입니다. Claude, GPT, Gemini, DeepSeek 등 AI 모델을 원클릭 설치의 GUI로 제공합니다. 터미널이나 코딩 지식 없이도 사용할 수 있습니다.

</div>

<div class="faq-item">

### 어떤 AI 모델을 지원하나요?

Anthropic 또는 OpenRouter를 통한 Claude, OpenAI 호환 API, 그리고 GLM, MiniMax, Kimi 등 다양한 모델을 지원합니다. OpenAI 호환 API 엔드포인트를 제공하는 모든 서비스를 설정하여 사용할 수 있습니다.

</div>

<div class="faq-item">

### 무료인가요?

네. Open Cowork은 MIT 라이선스로 완전 무료 오픈소스입니다. 사용하는 AI 모델 API 비용만 해당 서비스 제공자에게 지불하시면 됩니다.

</div>

<div class="faq-item">

### 샌드박스 격리는 어떻게 동작하나요?

Open Cowork은 WSL2 (Windows) 또는 Lima (macOS)를 사용하여 모든 AI 실행 명령을 격리된 Linux 가상 머신 내에서 처리합니다. AI가 실수를 하더라도 호스트 시스템 파일은 안전하게 보호됩니다.

</div>

<div class="faq-item">

### 데이터는 안전한가요?

Open Cowork은 사용자의 로컬 머신에서만 실행됩니다. 외부 통신은 사용자가 설정한 AI 모델 API와의 통신뿐입니다. Open Cowork 서버로는 어떠한 데이터도 전송되지 않습니다.

</div>

<div class="faq-item">

### 누가 만든 건가요?

Open Cowork은 [Veluga Inc.](https://github.com/OpenCoworkAI)에서 개발한 오픈소스 프로젝트입니다. MIT 라이선스로 공개되어 있으며 누구나 기여할 수 있습니다.

</div>

<div class="faq-item">

### Linux에서도 사용할 수 있나요?

사전 빌드 설치 패키지는 Windows와 macOS용으로 제공됩니다. Linux 사용자는 소스에서 빌드하여 사용할 수 있습니다 — 자세한 내용은 [GitHub 저장소](https://github.com/OpenCoworkAI/open-cowork)를 참고하세요.

</div>

</div>
