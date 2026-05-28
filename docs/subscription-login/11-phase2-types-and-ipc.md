# Phase 2 — 타입 확장 & IPC 골격

> 목표: 본격 OAuth 구현 전에 **데이터 모델·IPC 채널·UI 라우팅을 먼저 정착**시키고, 기존 API key 경로는 변경 없이 그대로 동작하도록 보장.
>
> 예상 소요: **1일**

## 1. 작업 목록

### 1.1 `config-store.ts` 타입 확장

**파일**: `packages/cowork-core/src/main/config/config-store.ts`

**변경 (line 71-77 근처)**:
```typescript
export type AuthMethod = 'apikey' | 'oauth' | 'cli-delegate';

export interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: 'Bearer';
  scope?: string;
  accountId?: string;
  obtainedAt: number;
}

export interface ProviderProfile {
  id: string;
  name: string;
  provider: ProviderName;
  authMethod: AuthMethod;          // ← 신규. 기존 프로필은 마이그레이션 시 'apikey'로 설정
  apiKey?: string;                 // 기존
  oauthCredentials?: OAuthCredentials;  // ← 신규
  baseUrl?: string;
  customProtocol?: string;
}
```

**마이그레이션** (`AppConfig.version` 증가):
```typescript
// version: 3 → 4
if (loaded.version === 3) {
  loaded.profiles = loaded.profiles.map(p => ({
    ...p,
    authMethod: 'apikey' as const,
  }));
  loaded.version = 4;
}
```

**완료 기준**:
- 기존 사용자 설정 파일 로드 시 `authMethod: 'apikey'` 자동 부여
- 타입 검사 통과 (`tsc --noEmit`)
- 기존 `config.save`/`config.get` IPC 핸들러 회귀 없음 (테스트)

### 1.2 `auth-utils.ts` 헬퍼 추가

**파일**: `packages/cowork-core/src/main/config/auth-utils.ts`

**추가 함수**:
```typescript
/**
 * 프로필의 인증 방식에 따라 실제 SDK에 넘길 자격증명을 반환.
 * OAuth의 경우 만료 임박 시 oauth-manager가 refresh를 호출하므로,
 * 이 함수는 단순히 현재 저장된 값만 읽어 반환.
 */
export function getEffectiveCredential(profile: ProviderProfile): {
  type: 'apikey' | 'oauth' | 'cli-delegate';
  value?: string; // cli-delegate는 undefined
  expiresAt?: number;
} {
  switch (profile.authMethod) {
    case 'apikey':
      if (!profile.apiKey) throw new Error('API key missing');
      return { type: 'apikey', value: profile.apiKey };
    case 'oauth':
      if (!profile.oauthCredentials) throw new Error('OAuth credentials missing');
      return {
        type: 'oauth',
        value: profile.oauthCredentials.accessToken,
        expiresAt: profile.oauthCredentials.expiresAt,
      };
    case 'cli-delegate':
      return { type: 'cli-delegate' };
  }
}

export function isOAuthExpiringSoon(creds: OAuthCredentials, bufferMs = 60_000): boolean {
  return creds.expiresAt - Date.now() < bufferMs;
}
```

기존 `isLikelyOAuthAccessToken()` (line 29-39)은 그대로 유지 — 사용자가 OAuth 토큰을 실수로 apikey 필드에 붙여넣었을 때 경고용.

### 1.3 IPC 핸들러 스텁

**파일**: `packages/cowork-core/src/main/index.ts` (line 1417-1631 config.* 핸들러 옆에 추가)

```typescript
import type { IpcMainInvokeEvent } from 'electron';

// auth.* 핸들러 (Phase 2: 스텁만, 실제 구현은 Phase 3·4)
ipcMain.handle('auth.startOAuth', async (_e, args: { provider: 'openai-codex'; profileId: string }) => {
  if (!featureFlags.subscription_login.enabled) {
    return { error: 'subscription_login feature is disabled' };
  }
  // Phase 3에서 실제 구현
  throw new Error('Not implemented in Phase 2');
});

ipcMain.handle('auth.cancelOAuth', async (_e, args: { flowId: string }) => {
  // Phase 3
  throw new Error('Not implemented in Phase 2');
});

ipcMain.handle('auth.checkClaudeCli', async () => {
  if (!featureFlags.subscription_login.enabled) {
    return { installed: false, reason: 'feature disabled' };
  }
  // Phase 4에서 실제 구현
  return { installed: false, reason: 'not yet implemented' };
});

ipcMain.handle('auth.signOut', async (_e, args: { profileId: string }) => {
  // Phase 3·4: oauth credentials 삭제 또는 cli-delegate 해제
  throw new Error('Not implemented in Phase 2');
});

ipcMain.handle('auth.getStatus', async (_e, args: { profileId: string }) => {
  const profile = configStore.getProfile(args.profileId);
  if (!profile) return { error: 'profile not found' };

  if (profile.authMethod === 'apikey') {
    return { authMethod: 'apikey', loggedIn: !!profile.apiKey };
  }
  if (profile.authMethod === 'oauth') {
    return {
      authMethod: 'oauth',
      loggedIn: !!profile.oauthCredentials,
      expiresAt: profile.oauthCredentials?.expiresAt,
      // ⚠️ accessToken은 절대 반환하지 않음
    };
  }
  if (profile.authMethod === 'cli-delegate') {
    // Phase 4에서 CLI 상태 확인
    return { authMethod: 'cli-delegate', loggedIn: false };
  }
});
```

### 1.4 Preload bridge 확장

**파일**: `packages/cowork-core/src/preload/*.ts` (기존 `window.veluga.config.*` 옆)

```typescript
contextBridge.exposeInMainWorld('veluga', {
  ...existing,
  auth: {
    startOAuth: (args) => ipcRenderer.invoke('auth.startOAuth', args),
    cancelOAuth: (args) => ipcRenderer.invoke('auth.cancelOAuth', args),
    checkClaudeCli: () => ipcRenderer.invoke('auth.checkClaudeCli'),
    signOut: (args) => ipcRenderer.invoke('auth.signOut', args),
    getStatus: (args) => ipcRenderer.invoke('auth.getStatus', args),
    // 진행 이벤트 구독 (Phase 3에서 사용)
    onProgress: (cb) => ipcRenderer.on('auth.progress', (_, payload) => cb(payload)),
  },
});
```

### 1.5 설정 화면 UI 스켈레톤

**파일**: `packages/cowork-core/src/renderer/` (정확 경로는 구현 시 탐색 — 예: `components/settings/ProviderSettings.tsx`)

**변경**: provider별 설정 패널에 인증 방식 라디오 추가
```tsx
<RadioGroup
  value={profile.authMethod}
  onChange={(v) => updateProfile({ authMethod: v as AuthMethod })}
>
  <Radio value="apikey">API Key (기존)</Radio>

  {profile.provider === 'openai' && featureFlags.subscription_login.chatgpt_plus_oauth && (
    <Radio value="oauth">ChatGPT Plus 로그인 (구독)</Radio>
  )}

  {profile.provider === 'anthropic' && featureFlags.subscription_login.claude_pro_cli && (
    <Radio value="cli-delegate">Claude Pro (Claude Code CLI 위임)</Radio>
  )}
</RadioGroup>

{profile.authMethod === 'apikey' && <ApiKeyInput ... />}
{profile.authMethod === 'oauth' && <OAuthPanelPlaceholder />}      {/* Phase 3 */}
{profile.authMethod === 'cli-delegate' && <CliPanelPlaceholder />}  {/* Phase 4 */}
```

플레이스홀더는 "Phase 3·4에서 구현 예정" 표시만 (개발자 빌드에서만 노출, 사용자 빌드는 feature flag로 숨김).

### 1.6 Feature flag 추가

**파일**: 기존 feature flag 모듈 (정확 경로는 [agent-orchestration-plan](../agent-orchestration-plan/03-architecture.md)의 `policy.veluga.*` 패턴 따라가서 위치 확인)

```typescript
subscription_login: {
  enabled: false,
  chatgpt_plus_oauth: false,
  claude_pro_cli: false,
}
```

---

## 2. 회귀 가드 (Regression Guards)

기존 API key 사용자에게 0의 영향을 보장하기 위한 체크:

1. **마이그레이션 round-trip 테스트**:
   - v3 config 파일 로드 → v4 저장 → 다시 로드 → 원본과 동일 (authMethod='apikey' 부여 외 변화 없음)
2. **agent-runner 회귀**:
   - 기존 API key 프로필로 채팅 호출 → 응답 정상 (변화 없음)
   - `setRuntimeApiKey('openai', apiKey)` 호출 동일하게 발생 확인 (디버그 로그)
3. **타입 검사**: `tsc --noEmit` 0 에러
4. **기존 단위 테스트**: 모두 통과 (`pnpm test` 또는 프로젝트 표준 명령)

---

## 3. 완료 기준 (Definition of Done)

- [ ] 타입 확장 머지 + 마이그레이션 동작
- [ ] IPC 핸들러 스텁 (모두 `featureFlags.subscription_login.enabled` 가드)
- [ ] Preload bridge로 renderer에서 `window.veluga.auth.*` 호출 가능
- [ ] 설정 UI에 인증 방식 라디오 노출 (feature flag OFF 시 숨김)
- [ ] 회귀 테스트 0 실패
- [ ] PR 단위 테스트 추가:
  - `config-store.migrations.test.ts`: v3→v4 마이그레이션
  - `auth-utils.test.ts`: `getEffectiveCredential`, `isOAuthExpiringSoon`
- [ ] 문서 업데이트: 본 폴더 README의 적용 상태 체크박스

---

## 4. 다음 단계

Phase 2 완료 후 Phase 3(ChatGPT OAuth) 및 Phase 4(Claude CLI)는 **병렬 진행 가능**. 두 작업은 서로 독립이므로 별도 PR/브랜치로 나눠도 충돌 없음.
