# Feishu → Discord(기본) + Slack 메신저 교체 플랜

## Context (왜 이 작업이 필요한가)

현재 Veluga_TA의 "원격 제어(remote control)" 기능은 Feishu(Lark)를 기반으로 동작한다. 사용자가 메신저에서 텍스트로 명령을 보내면 Claude Agent가 실행되고 응답이 다시 메신저로 흘러나오는 양방향(bidirectional) 구조다.

Feishu는 사용자 베이스가 좁고, 인증/도메인 검증 등 운영 비용이 크다. **국제 사용자가 보편적으로 사용하는 Discord를 기본으로** 하고, **Slack/Teams**도 옵션으로 제공하려 한다.

조사 결과 핵심 발견:
- **추상화는 이미 깔끔** — `IChannel` 인터페이스 + `ChannelBase` 추상 클래스가 메신저 transport와 비즈니스 로직을 잘 분리해 둠
- **Slack은 이미 `@slack/bolt` 기반으로 완전 구현됨** ([slack-channel.ts](../packages/cowork-core/src/main/remote/channels/slack/slack-channel.ts)) — 새 SDK 학습 없이 이를 패턴으로 활용 가능
- **재활용률 ≈ 85-90%** — 메신저별 작업은 (1) `ChannelBase` 상속 클래스 (2) Config 타입 (3) Config UI 컴포넌트 (4) 서명/토큰 검증 정도만 추가
- **미구현 채널 타입 잔재**(`wechat`/`telegram`/`dingtalk`)가 union에 남아있음 — upstream Open Cowork fork 흔적, 함께 정리

사용자 확정 사항:
- Feishu 완전 삭제(파일·UI·i18n·결합 코드·미구현 타입 잔재까지)
- 스코프: Discord(신규) + Slack(기존 완성) — Teams는 후속
- 인터랙션 메시지(현재 중국어 하드코딩) → i18n으로 분리

---

## 권장 라이브러리

| 메신저 | 라이브러리 | 근거 |
|---|---|---|
| **Discord** | `discord.js` v14 | 사실상 표준, Slack `@slack/bolt`와 같은 패턴(Gateway WS = Slack Socket Mode 동치 → 터널/공인 URL 불필요), 양방향 지원, TS 타입 우수 |
| **Slack** | `@slack/bolt` + `@slack/web-api` (기존) | 이미 통합되어 있음, 변경 없음 |
| **Teams (후속)** | `botbuilder` (Microsoft Bot Framework) | 양방향 가능한 사실상 유일한 옵션. Incoming Webhook은 outbound-only라 원격 제어 불가 |

자체 구현(raw API) 대안은 거부 — 서명 검증·재연결·heartbeat·rate-limit·shard 등 SDK가 처리해주는 기본 인프라를 재구현할 가치가 없음.

---

## 재활용 가능한 자산 (수정 없음)

다음은 메신저 무관하게 그대로 사용:

- [packages/cowork-core/src/main/remote/channels/channel-base.ts](../packages/cowork-core/src/main/remote/channels/channel-base.ts) — `ChannelBase` 추상 클래스 + `withRetry` 헬퍼, `splitMessage` 유틸
- [packages/cowork-core/src/main/remote/gateway.ts](../packages/cowork-core/src/main/remote/gateway.ts) — 웹훅·WS 서버, 페어링, 인증
- [packages/cowork-core/src/main/remote/message-router.ts](../packages/cowork-core/src/main/remote/message-router.ts) — 세션 매핑·큐잉
- `RemoteManager`의 인터랙션 핸들링(질문/권한 요청), 응답 버퍼링·dedup·owner verification·mutex 등 (코드는 유지하되 일부 Feishu-specific 부분만 일반화)
- 페어링 시스템(`feishu:`/`slack:` prefix 패턴 그대로 — `discord:` 추가만)
- 암호화 config store ([remote-config-store.ts](../packages/cowork-core/src/main/remote/remote-config-store.ts))
- 공통 UI 컴포넌트: `ConnectionConfigStep`, `AdvancedConfigStep`, `PairingGuideCard`, `AuthorizedUsersSection`, `GatewayControlCard`, `PairingRequestsSection`

---

## 작업 단계

### 1. Feishu 완전 삭제

**삭제 대상 (파일/디렉토리)**
- [packages/cowork-core/src/main/remote/channels/feishu/](../packages/cowork-core/src/main/remote/channels/feishu/) — `feishu-api.ts`, `feishu-channel.ts`, `feishu-ws-client.ts`, `index.ts` 전체
- [packages/cowork-core/src/renderer/components/remote/FeishuConfigStep.tsx](../packages/cowork-core/src/renderer/components/remote/FeishuConfigStep.tsx)

**참조 제거 (코드)**
- [types.ts](../packages/cowork-core/src/main/remote/types.ts): `FeishuChannelConfig` 인터페이스 삭제, `ChannelType` union에서 `'feishu'` 삭제, `RemoteConfig.channels.feishu` 필드 삭제. **함께 정리**: 미구현 잔재인 `WechatChannelConfig`, `TelegramChannelConfig`, `DingtalkChannelConfig` 인터페이스와 union 멤버(`'wechat'`, `'telegram'`, `'dingtalk'`)도 삭제
- [remote-manager.ts](../packages/cowork-core/src/main/remote/remote-manager.ts):
  - `updateFeishuConfig()` 메서드 삭제 (322-382행) — Discord/Slack용으로 일반화된 메서드로 대체 (3단계에서 처리)
  - `getFeishuWebhookUrl()` 메서드 삭제 (303-306행) — 일반화된 `getWebhookUrl(channelType)`로 대체
  - `registerChannels()`의 Feishu 등록 블록(1120-1139행) 삭제
  - `start()` 217행의 `Feishu Webhook URL` 로그를 채널-범용 로그로 변경
  - import문에서 `FeishuChannel`, `FeishuChannelConfig` 제거
- [tunnel-manager.ts:153](../packages/cowork-core/src/main/remote/tunnel-manager.ts#L153): `getWebhookUrl()`의 하드코딩된 `/webhook/feishu` 경로를 인자 받아 `/webhook/${channelType}`로 변경
- [remote-config-store.ts](../packages/cowork-core/src/main/remote/remote-config-store.ts): `setFeishuConfig`, `getFeishuConfig` 등 Feishu 전용 접근자 제거
- [shared/ipc-types.ts](../packages/cowork-core/src/shared/ipc-types.ts), [preload/index.ts](../packages/cowork-core/src/preload/index.ts), [main/index.ts](../packages/cowork-core/src/main/index.ts): Feishu IPC 채널/핸들러 제거
- [renderer/components/RemoteControlPanel.tsx](../packages/cowork-core/src/renderer/components/RemoteControlPanel.tsx), [ConfigStepNav.tsx](../packages/cowork-core/src/renderer/components/remote/ConfigStepNav.tsx), [QuickStartGuide.tsx](../packages/cowork-core/src/renderer/components/remote/QuickStartGuide.tsx), [GatewayControlCard.tsx](../packages/cowork-core/src/renderer/components/remote/GatewayControlCard.tsx), [renderer/components/remote/types.ts](../packages/cowork-core/src/renderer/components/remote/types.ts): Feishu 분기/렌더 제거

**i18n 정리**
- [renderer/i18n/locales/ko.json](../packages/cowork-core/src/renderer/i18n/locales/ko.json), [en.json](../packages/cowork-core/src/renderer/i18n/locales/en.json): `remote.feishu*` 키 일괄 삭제

**의존성 정리**
- [package.json](../packages/cowork-core/package.json): `@larksuiteoapi/node-sdk` 제거

---

### 2. Discord 채널 구현

**신규 파일**
- `packages/cowork-core/src/main/remote/channels/discord/discord-channel.ts`
- `packages/cowork-core/src/main/remote/channels/discord/index.ts`
- `packages/cowork-core/src/renderer/components/remote/DiscordConfigStep.tsx`

**`DiscordChannel` 클래스 구조** ([slack-channel.ts](../packages/cowork-core/src/main/remote/channels/slack/slack-channel.ts)를 그대로 미러):

```ts
// 핵심 책무:
// 1. start(): discord.js Client 생성, intents(Guilds, GuildMessages, DirectMessages, MessageContent) 설정, login(botToken)
// 2. messageCreate 이벤트 → RemoteMessage 정규화 → emitMessage()
//    - msg.author.bot 스킵
//    - DM vs Guild 구분(channel.isDMBased())
//    - mention 검출(msg.mentions.users.has(client.user.id))
//    - mention prefix 제거(<@id> 토큰 strip)
//    - thread reply는 channelId를 "channelId:threadId" 형식으로 인코딩(Slack과 동일)
// 3. send(response): channel.send(text)로 발송, 2000자 제한 → splitMessage(text, 1900)
// 4. stop(): client.destroy()
```

**Config 타입 추가** ([types.ts](../packages/cowork-core/src/main/remote/types.ts)):

```ts
export interface DiscordChannelConfig {
  type: 'discord';
  /** Bot token from Discord Developer Portal */
  botToken: string;
  /** Optional application ID (for slash commands, future) */
  applicationId?: string;
  /** DM policy (open/pairing/allowlist) */
  dm: { policy: 'open' | 'pairing' | 'allowlist'; allowFrom?: string[]; };
  /** Per-guild/channel settings */
  channels?: { [channelId: string]: { requireMention: boolean; allowFrom?: string[]; }; };
}
```
- `ChannelType` union에 `'discord'` 추가
- `RemoteConfig.channels.discord?: DiscordChannelConfig` 추가
- `DEFAULT_REMOTE_CONFIG`는 변경 없음(empty channels)

**의존성 추가**
- [package.json](../packages/cowork-core/package.json): `"discord.js": "^14.x"` 추가
- import는 `slack-channel.ts`처럼 **lazy dynamic import** (`await import('discord.js')`)로 — 미사용시 번들 비용 회피

**`DiscordConfigStep.tsx`** — [SlackConfigStep.tsx](../packages/cowork-core/src/renderer/components/remote/SlackConfigStep.tsx)을 그대로 클론, 필드만 교체:
- botToken (xxx.xxx.xxx 형태)
- DM policy 선택(공통 컴포넌트)
- 외부 링크: `https://discord.com/developers/applications`
- Discord는 Slack Socket Mode 같은 토글 불필요 — Gateway WS가 디폴트

**Discord 봇 권한 가이드**: [QuickStartGuide.tsx](../packages/cowork-core/src/renderer/components/remote/QuickStartGuide.tsx)에 Discord 봇 만들기 step 추가 — Application 생성 → Bot 추가 → `MESSAGE_CONTENT` privileged intent 활성화 → OAuth2 URL로 서버 초대.

---

### 3. RemoteManager 일반화

`updateFeishuConfig()`(remote-manager.ts:322-382)의 **DM policy → gateway auth 동기화 로직**은 Discord/Slack에도 동일하게 필요하다. 이를 일반 메서드로 추출:

```ts
// 기존 updateFeishuConfig를 일반화한 update*Config(*=Discord|Slack) 메서드를 동일 패턴으로 추가.
// 채널별 prefix(`discord:`, `slack:`)로 allowlist 엔트리 스코프 분리 (Feishu에서 이미 쓰던 패턴 유지)
async updateDiscordConfig(config: DiscordChannelConfig): Promise<void> { ... }
async updateSlackConfig(config: SlackChannelConfig): Promise<void> { ... }
```

추가 변경:
- `getWebhookUrl(channelType: ChannelType): string | null` — 기존 `getFeishuWebhookUrl()` 대체
- `registerChannels()`에 Discord 등록 블록 추가 (Slack 블록과 동일 패턴, webhook event는 Discord Gateway 모드에선 불필요)

---

### 4. 인터랙션 메시지 i18n 분리

[remote-manager.ts](../packages/cowork-core/src/main/remote/remote-manager.ts)의 인터랙션 메시지(중국어 하드코딩)를 i18n 키로 분리:
- 513-540행: 질문 메시지 템플릿 (`🤔 **답변이 필요합니다**`, `건너뛰기`/`skip` 등)
- 659-665행: 권한 요청 템플릿 (`⚠️ **승인이 필요합니다**`, `허용`/`거부`/`항상 허용` 등)
- 702-717행: 응답 파싱 키워드(`허용`, `y`, `항상 허용` 등)

**접근 방식**:
- 메인 프로세스에서 i18n을 직접 쓸 수 없으므로, **사용자의 locale 정보**(`remoteConfigStore`나 `app.getLocale()`)를 기반으로 한 **간단한 message-catalog 모듈** 신설: `packages/cowork-core/src/main/remote/interaction-messages.ts`
- 키워드 파싱(allow/deny)은 locale별 키워드 셋(ko: '허용'/'거부'/'항상 허용', en: 'allow'/'deny'/'always', zh: '允许'/'拒绝'/'始终允许')을 union으로 처리해 기존 중국어 사용자도 계속 동작

---

### 5. UI: 기본 채널 = Discord

[RemoteControlPanel.tsx](../packages/cowork-core/src/renderer/components/RemoteControlPanel.tsx) 및 [ConfigStepNav.tsx](../packages/cowork-core/src/renderer/components/remote/ConfigStepNav.tsx):
- 채널 선택 탭/스텝에서 **Discord 우선 표시 + 기본 선택**
- 순서: Discord → Slack → (Teams 미정)
- 초기 진입 시 `selectedChannel = 'discord'`

---

## 검증 계획

### 정적 검증
- `npm run typecheck` (cowork-core 패키지) — `ChannelType` union 축소·확장이 모든 호출부에 반영됐는지
- `npm run lint`
- import 그래프에서 `feishu`/`Feishu` 0 hit 확인 (`Grep`)

### 단위 동작 검증 (개발 환경)
1. Discord 개발자 포털에서 테스트용 봇 생성, `MESSAGE_CONTENT` intent 활성화
2. 테스트 서버에 봇 초대, 봇 토큰을 앱 UI에서 입력
3. Gateway 시작 → Discord 채널 connected 확인
4. DM 시나리오: 봇에 DM "ls" 같은 간단한 프롬프트 → Claude 세션 시작 → 응답이 DM으로 돌아오는지
5. 길드 채널 시나리오: `@bot 안녕` → 멘션 인식 후 응답
6. 인터랙션 시나리오: Read/Glob 같은 safe tool 실행 → autoApproveSafeTools 동작 확인; Bash/Write 같은 도구 → 권한 요청 → "허용" 응답 → 실행 진행
7. Long message 시나리오: 4000자 넘는 응답 → 1900자 단위 분할 발송 확인

### Slack 회귀 검증
- 기존 Slack 봇 토큰으로 Slack DM/채널 시나리오 동작 확인 — 일반화 작업 중 회귀가 없는지 (특히 `update*Config`의 DM policy → auth 동기화 로직)

### 클린업 검증
- Feishu 관련 i18n 키, IPC 타입, UI 분기, 로그 모두 사라졌는지 grep으로 0건 확인
- `package.json`에서 `@larksuiteoapi/node-sdk` 제거되고 `npm install` 재실행 후 dependency tree 정리 확인
- 미구현 잔재 타입(`wechat`/`telegram`/`dingtalk`)도 함께 사라졌는지 type 차원에서 확인

---

## 비스코프 (이번 작업에 포함하지 않음)

- **Teams 채널** — 추상화·UI 자리는 마련하지 않고 follow-up PR로 분리
- **Discord 인터랙티브 카드(Embed/Button)** — 우선 markdown 응답만; Embed 변환기는 후속
- **Slack 외 채널의 webhook 모드** — Discord는 Gateway WS만 지원(Slack도 Socket Mode 권장)
- **`tunnel-manager`의 Cloudflare 구현** — 기존 미구현 상태 유지

---

## 변경 규모 추정

| 항목 | 추정 LOC |
|---|---|
| 신규(Discord channel + UI + types) | ~450 |
| 삭제(Feishu 전체) | ~1,500 |
| 수정(RemoteManager, types, i18n, tunnel-manager, IPC) | ~250 |
| **순 변화** | **약 -800 LOC** |

추상화를 잘 만들어둔 덕에 **순감(net negative)** 으로 끝나는 것이 핵심 이득.
