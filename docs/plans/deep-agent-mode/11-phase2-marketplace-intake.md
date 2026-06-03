# 11 — Phase 2: 마켓플레이스 수용

> 상위 인덱스: [README.md](README.md) · 이전: [10-phase1-native-primitive.md](10-phase1-native-primitive.md) · 다음: [12-phase3-review-patterns.md](12-phase3-review-patterns.md)
> Status: **📝 구현 계획** · 2026-06-03

**목표**: harness/harness-100 계열 팀 자산을 직접 대량 이식하지 않고, Veluga 자체 마켓플레이스/활성화/스크럽 경로로 수용할 수 있게 한다. 사용자가 활성화한 플러그인의 `skills`와 `agents`만 Deep Agent Mode persona pool에 합류한다.

**전제**: Phase 1의 `spawn_agent` primitive와 `SubAgentPersona` contract가 이미 동작한다.

**완료 정의(DoD)**: 공개 카탈로그/Claude CLI/외부 네트워크 없이 검증용 플러그인 1~2개를 설치·활성화하고, 활성화된 `agents/*.md`만 persona registry에 등록되며, 비활성/미설치 플러그인은 런타임에 영향을 주지 않는다.

---

## 1. Veluga 자체 카탈로그 소스

대상: [plugin-catalog-service.ts](../../../packages/cowork-core/src/main/skills/plugin-catalog-service.ts), [plugin-runtime-service.ts](../../../packages/cowork-core/src/main/skills/plugin-runtime-service.ts)

- [ ] `catalogSource`에 `veluga-marketplace` 또는 `veluga-offline-bundle`을 추가한다.
- [ ] Deep Agent Mode용 catalog fetch는 공개 `claude.com/plugins`가 아니라 Veluga 자체 manifest 또는 로컬 bundle index를 읽는다.
- [ ] 카탈로그 manifest에는 pluginId, name, version, componentCounts, sha256, signature, offlineBundlePath 또는 internalUrl만 허용한다.
- [ ] 폐쇄망 profile에서는 network fetch를 하지 않고 로컬 bundle만 사용한다.

**수용 기준**: Phase 2 테스트에서 외부 URL 없이 catalog list가 동작한다.

---

## 2. 설치 경로 대체

대상: [PluginRuntimeService.install](../../../packages/cowork-core/src/main/skills/plugin-runtime-service.ts)

- [ ] Deep Agent plugin 설치는 `claude plugin install` CLI 셸아웃을 사용하지 않는다.
- [ ] 내부 bundle 또는 사용자가 선택한 디렉터리를 `installFromDirectory`로 가져오되, 설치 전 스크럽 검사기를 통과해야 한다.
- [ ] sourcePath/runtimePath materialization은 기존 경로를 재사용한다.
- [ ] 설치 결과 warnings에 스크럽 경고와 disabled component를 명시한다.

**수용 기준**: CLI가 없는 환경에서도 검증 플러그인 설치가 성공한다.

---

## 3. 플러그인 manifest 수용 계약

지원 포맷:

```text
.claude-plugin/plugin.json
skills/**/SKILL.md
agents/*.md
```

- [ ] `plugin.json`의 `agents` 경로를 resolve하고 markdown 파일만 persona 후보로 인정한다.
- [ ] hooks, mcpServers, commands는 기본 disabled로 시작한다. 별도 정책 승인이 없으면 runtime에서 materialize하지 않는다.
- [ ] persona markdown은 frontmatter 또는 1차 heading 기반 metadata를 파싱한다.
- [ ] 각 persona는 `id`, `name`, `description`, `systemPrefix`, `defaultToolScope`, `pluginId`, `sourcePathHash`를 가진다.

**수용 기준**: malformed agent markdown은 설치 실패가 아니라 해당 persona skip + warning으로 처리된다.

---

## 4. 가드레일 스크럽 검사기

신규 대상 예시: `packages/cowork-core/src/main/skills/plugin-scrubber.ts`

- [ ] 직접 LLM endpoint 문자열(`api.anthropic.com`, `api.openai.com`)을 검사한다.
- [ ] telemetry/tracing SaaS SDK 또는 endpoint 문자열(PostHog, Sentry, Datadog, Segment, Mixpanel 등)을 검사한다.
- [ ] 원격 fetch/curl/wget/Invoke-WebRequest 같은 외부 송신 명령을 agent/skill 문서와 scripts에서 검사한다.
- [ ] hooks/mcp/commands가 포함된 경우 정책 허용 전 disabled 처리한다.
- [ ] 검사 결과는 audit와 install warnings에 기록한다.

**수용 기준**: 위험 fixture는 설치가 거부되거나 위험 component가 disabled 되며, 안전 fixture는 warnings 없이 설치된다.

---

## 5. persona registry

신규 대상 예시: `packages/cowork-core/src/main/skills/agent-persona-registry.ts`

- [ ] 활성화된 plugin + `componentsEnabled.agents=true`인 항목만 읽는다.
- [ ] `agents/*.md`를 `SubAgentPersona`로 변환한다.
- [ ] plugin toggle/component toggle 후 registry를 갱신한다.
- [ ] registry snapshot을 `spawn_agent` persona resolver에 공급한다.
- [ ] 같은 persona id 충돌 시 `pluginId/personaId` namespace를 사용한다.

**수용 기준**: component agents를 끄면 persona가 즉시 pool에서 제거된다.

---

## 6. skills-manager와 역할 분리

- [ ] 기존 [skills-manager.ts](../../../packages/cowork-core/src/main/skills/skills-manager.ts)는 `SKILL.md` 감지를 계속 담당한다.
- [ ] persona registry는 `agents/*.md`만 담당한다.
- [ ] `skills`와 `agents` component enable state가 다를 수 있음을 UI와 runtime 모두 반영한다.
- [ ] plugin skill은 기존 skill 활성화 정책을 따르고, persona는 Deep Agent Mode policy를 추가로 따른다.

**수용 기준**: skills만 켠 플러그인은 skill로만 보이고 persona pool에는 나오지 않는다. agents만 켠 플러그인은 persona pool에만 나온다.

---

## 7. 검증 패키지 1~2개

테스트 fixture 예시:

- `deep-agent-basic-team`: planner/researcher/reviewer 3개 persona, 외부 명령 없음.
- `deep-agent-risky-team`: 직접 LLM endpoint 또는 telemetry 문자열 포함, 설치 거부/disabled 검증용.

작업:

- [ ] fixtures를 tests 또는 docs fixture 위치에 추가한다.
- [ ] catalog manifest가 fixture를 가리키게 한다.
- [ ] 설치, component toggle, persona registry 반영, `spawn_agent(personaId)`까지 통합 테스트한다.

---

## 8. Renderer / Settings UI

- [ ] 기존 plugins UI에 `agents` component count와 enabled state가 이미 노출되는지 확인한다.
- [ ] persona pool preview가 필요하면 Phase 2 범위 안에서 최소 UI만 추가한다. 기본 채팅 UI에는 설치 설명 텍스트를 넣지 않는다.
- [ ] 위험 플러그인 warnings는 설정/플러그인 화면에서만 보여준다.

**수용 기준**: 사용자가 켠 팀만 딥 에이전트 모드에서 선택/사용 가능하다.

---

## 9. 테스트

- [ ] catalog: Veluga local manifest list.
- [ ] install: CLI 없이 safe fixture 설치.
- [ ] scrub: direct endpoint/telemetry fixture 거부.
- [ ] toggle: plugin enabled/component enabled에 따른 runtime materialization.
- [ ] persona registry: parse/skip/collision/disable.
- [ ] runner integration: plugin personaId로 `spawn_agent` 실행.
- [ ] whiteout: catalog/install 경로 외부 송신 없음.

---

## 리스크 / 주의

- 기존 plugin runtime은 일반 플러그인 기능도 담당한다. Deep Agent Mode를 위해 공개 marketplace 경로를 전면 삭제할지, Veluga profile에서만 대체할지는 별도 정책 결정이 필요하다.
- hooks/mcp/commands는 강력하다. Phase 2 기본은 disabled이며, agents/skills 수용만 목표로 한다.
- harness 원본을 그대로 신뢰하지 않는다. 내부 mirror/bundle snapshot과 스크럽 결과를 기준으로 설치한다.
