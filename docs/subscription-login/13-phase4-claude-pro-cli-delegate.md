# Phase 4 — Claude Pro CLI 위임 구현

> 목표: 로컬에 설치된 Claude Code CLI에 채팅 요청을 위임하여, Veluga가 자체적으로 Anthropic 토큰을 보관하지 않으면서 Claude Pro 구독을 활용.
>
> 예상 소요: **1.5일** (MVP: chat-only)
>
> 선행 조건: Phase 2 머지 완료. Phase 3와 병렬 진행 가능.

## 1. 설계 원칙

- **Veluga는 Claude 토큰을 절대 저장하지 않는다.** 모든 인증은 `claude` CLI가 알아서 처리.
- **MVP는 chat-only**. 첫 PR에서는 system + user/assistant 메시지만 지원. Tool use, vision, MCP는 후속.
- **stdio JSON-RPC 우선**. goose가 사용하는 ACP 프로토콜(`@agentclientprotocol/claude-agent-acp`)도 옵션이지만, 우선 `claude` CLI의 native 명령(`claude --print`, `claude api ...` 등 실제 사양 확인 필요)으로 시도.

> ⚠️ **확인 필요**: Phase 4 시작 시 `claude --help`를 실제 실행해 어떤 비대화형 모드를 지원하는지 확정. 본 문서는 가설에 기반한 설계이며, CLI 사양에 따라 일부 명령은 변경 가능.

## 2. 모듈 구조

```
packages/cowork-core/src/main/auth/
├── claude-cli-detector.ts    ← 설치/버전/인증 상태
├── claude-cli-runner.ts      ← subprocess 위임 + stream 파싱
└── __tests__/
    ├── claude-cli-detector.test.ts
    └── claude-cli-runner.test.ts
```

## 3. `claude-cli-detector.ts`

```typescript
import { spawn } from 'node:child_process';
import which from 'which'; // 이미 의존성 있는지 먼저 확인, 없으면 직접 PATH 탐색

export interface ClaudeCliStatus {
  installed: boolean;
  path?: string;
  version?: string;
  authenticated?: boolean;
  installInstructions?: string;
}

const INSTALL_URL = 'https://docs.claude.com/en/docs/claude-code';

export async function detectClaudeCli(): Promise<ClaudeCliStatus> {
  const path = await findExecutable('claude');
  if (!path) return { installed: false, installInstructions: INSTALL_URL };

  const version = await tryGetVersion(path);
  if (!version) return { installed: false, path, installInstructions: INSTALL_URL };

  const authenticated = await tryCheckAuth(path);
  return { installed: true, path, version, authenticated };
}

async function findExecutable(name: string): Promise<string | undefined> {
  // 1. PATH
  try { return await which(name); } catch {}
  // 2. npm global
  // npm root -g → check {root}/.bin/{name}
  // 구현: child_process로 `npm root -g`, 그 디렉토리/.bin/claude 존재 확인
  return undefined;
}

async function tryGetVersion(path: string): Promise<string | undefined> {
  return new Promise(resolve => {
    const proc = spawn(path, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', c => { out += c.toString(); });
    proc.on('error', () => resolve(undefined));
    proc.on('exit', code => resolve(code === 0 ? out.trim() : undefined));
    setTimeout(() => { proc.kill(); resolve(undefined); }, 5000);
  });
}

async function tryCheckAuth(path: string): Promise<boolean> {
  // ⚠️ 실제 명령은 Phase 4 시작 시 `claude --help`로 확인.
  // 가설: `claude auth status` 또는 `claude config get user` 등.
  // 인증 안 되어 있으면 stderr나 non-zero exit code가 나옴.
  return new Promise(resolve => {
    const proc = spawn(path, ['auth', 'status'], { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.on('exit', code => resolve(code === 0));
    proc.on('error', () => resolve(false));
    setTimeout(() => { proc.kill(); resolve(false); }, 5000);
  });
}
```

## 4. `claude-cli-runner.ts`

```typescript
import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface ClaudeMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ClaudeChatOptions {
  messages: ClaudeMessage[];
  model?: string;       // 'claude-opus-4-7', 'claude-sonnet-4-6' 등
  maxTokens?: number;
}

export class ClaudeCliRunner extends EventEmitter {
  constructor(private cliPath: string) { super(); }

  /**
   * 채팅 호출 → assistant message를 stream으로 반환.
   * 'chunk' 이벤트 (delta string), 'done' 이벤트 (full text), 'error' 이벤트.
   */
  invoke(options: ClaudeChatOptions): { cancel: () => void } {
    // ⚠️ 실제 명령은 Phase 4 시작 시 확인. 가설:
    //   claude --print --model {model} --json   (stdin에 messages JSON)
    //   또는 claude api chat --stream
    const args = ['--print'];
    if (options.model) args.push('--model', options.model);
    args.push('--input-format', 'json', '--output-format', 'stream-json');

    const proc = spawn(this.cliPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // stdin: messages JSON
    const inputPayload = JSON.stringify({ messages: options.messages, max_tokens: options.maxTokens });
    proc.stdin.write(inputPayload);
    proc.stdin.end();

    let buffer = '';
    let fullText = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      // 줄 단위 JSON 파싱 (stream-json은 newline-delimited)
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'content_block_delta' && event.delta?.text) {
            this.emit('chunk', event.delta.text);
            fullText += event.delta.text;
          } else if (event.type === 'message_stop') {
            this.emit('done', fullText);
          }
        } catch {
          // 무시 또는 로깅
        }
      }
    });

    proc.stderr.on('data', chunk => {
      // stderr는 디버그 로그용 (토큰 정보 들어갈 수 있으므로 redact)
      this.emit('stderr', chunk.toString('utf8'));
    });

    proc.on('error', err => this.emit('error', err));
    proc.on('exit', code => {
      if (code !== 0) this.emit('error', new Error(`claude CLI exited with code ${code}`));
    });

    return {
      cancel: () => {
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), 3000);
      },
    };
  }
}
```

> 실제 CLI의 input/output 형식은 `claude --help`로 확인 필요. 가능성 있는 시나리오:
> 1. `claude --print "prompt"` — 단순 텍스트 in/out (system 메시지 못 넣음, MVP 부적합)
> 2. `claude --print --input-format json` — 우리가 가정한 형태
> 3. ACP 프로토콜 (`claude --acp-server`) — goose 방식, 가장 표준적

> Phase 4 첫날 첫 시간에 위 3개를 직접 시도해서 어느 것이 동작하는지 확정. 만약 (1)만 가능하면 system prompt를 user 메시지 첫 줄에 인라인하는 우회 사용 (한계 있음).

## 5. IPC 핸들러

**파일**: `packages/cowork-core/src/main/index.ts`

```typescript
import { detectClaudeCli } from './auth/claude-cli-detector.js';

ipcMain.handle('auth.checkClaudeCli', async () => {
  return await detectClaudeCli();
});
```

`auth.signOut`은 cli-delegate에서는:
```typescript
case 'cli-delegate':
  await configStore.updateProfile(args.profileId, { authMethod: 'apikey' });
  // 실제 Claude CLI 토큰은 우리가 보관하지 않으므로 건드릴 게 없음
```

## 6. agent-runner 통합

**문제**: pi-coding-agent의 `createAgentSession()`은 자체 SDK를 사용하므로 외부 CLI 위임과 호환되지 않음. 따라서 `cli-delegate` 경로는 **createAgentSession을 사용하지 않고** 별도 코드 경로를 사용해야 함.

**전략 A (권장)**: agent-runner의 `run()` 메서드에서 먼저 분기:
```typescript
async run(prompt, options) {
  const profile = await this.resolveActiveProfile();
  if (profile.authMethod === 'cli-delegate') {
    return await this.runViaClaudeCli(profile, prompt, options);
  }
  // 기존 pi-coding-agent 경로 (apikey, oauth)
  return await this.runViaPiAgent(profile, prompt, options);
}

private async runViaClaudeCli(profile, prompt, options) {
  const status = await detectClaudeCli();
  if (!status.installed) throw new Error(`Claude CLI not installed. ${INSTALL_URL}`);
  if (status.authenticated === false) throw new Error('Claude CLI not authenticated. Run `claude /login`.');

  const runner = new ClaudeCliRunner(status.path!);
  const messages = this.buildMessagesFromPrompt(prompt);
  return new Promise((resolve, reject) => {
    let acc = '';
    const handle = runner.invoke({ messages, model: options.model });
    runner.on('chunk', delta => {
      acc += delta;
      this.emitProgress({ type: 'token', text: delta });
    });
    runner.on('done', () => resolve({ text: acc }));
    runner.on('error', reject);
    options.signal?.addEventListener('abort', () => handle.cancel());
  });
}
```

**제약**: MVP에서는 tool use, MCP, skills 미지원. agent-runner의 tool 시스템과 통합하려면 ACP 어댑터가 필요하며 이는 후속 작업.

**Renderer UX**: cli-delegate 프로필 사용 시 UI에서 "이 모드에서는 도구 호출이 지원되지 않습니다" 안내 (회색 처리 또는 정보 아이콘).

## 7. 단위 테스트

`claude-cli-detector.test.ts`:
- CLI 미설치 시 `{ installed: false, installInstructions }` 반환
- 가짜 실행 가능 파일로 version detection
- 5초 타임아웃 동작

`claude-cli-runner.test.ts`:
- mock subprocess (예: `child_process.spawn`을 stub)
- stream-json 파싱 (정상 line, 깨진 line, 부분 chunk)
- cancel() 시 SIGTERM → 3초 후 SIGKILL

## 8. 위험 요소 & 미해결 질문

| 위험 | 영향 | 대응 |
|---|---|---|
| Claude CLI가 비대화형 모드 지원 안 함 | MVP 자체 불가능 | Phase 4 첫 시간에 확인. ACP 어댑터로 우회 검토 |
| stream 출력 포맷 변경 | 파싱 실패 | CLI 버전 lock (`>=X.Y.Z` 체크) + 호환성 매트릭스 유지 |
| 사용자가 `claude /logout` 후 Veluga에서 호출 | 에러 | CLI exit code 감지 + UI에 "CLI 재로그인 필요" 안내 |
| tool use / MCP 미지원 | 사용자 혼란 | UI에 명시적 표시. 추후 ACP 어댑터로 확장 |
| Windows에서 `claude.cmd` vs `claude.exe` | spawn 실패 | `which`/`where` 결과를 그대로 사용 (확장자 포함 경로) |

## 9. 완료 기준

- [ ] `claude --version` 감지 + UI 표시
- [ ] 미설치 시 설치 안내 dialog
- [ ] CLI 미인증 시 명확한 에러 메시지
- [ ] 간단한 채팅 (system + user → assistant) end-to-end 동작
- [ ] cancel/abort 동작
- [ ] tool use는 비활성화 (UI에 "지원 안 됨" 표시)
- [ ] 단위 테스트 추가 + 통과
- [ ] feature flag `claude_pro_cli=true` 시에만 노출
- [ ] 로그에 prompt 평문 또는 stderr 토큰 정보 출력 안 됨 (redaction 적용)

## 10. 후속 작업 (Phase 4 이후)

- ACP 어댑터 도입 (goose의 `@agentclientprotocol/claude-agent-acp` 참조) — tool use 지원
- MCP server 위임 — Veluga의 MCP를 Claude CLI에 전달
- skills 통합 — Veluga의 skills를 Claude CLI에 system prompt 일부로 포함
- streaming token usage 표시 (Anthropic API와 달리 CLI는 토큰 카운트 미제공 가능)
