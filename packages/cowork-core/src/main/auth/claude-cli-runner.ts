/**
 * @module main/auth/claude-cli-runner
 *
 * Delegates a chat turn to the local Claude Code CLI (Phase 4, chat-only MVP).
 *
 * Veluga stores no Anthropic tokens — `claude` handles all auth. We spawn it in
 * non-interactive print mode with streaming JSON output and feed the prompt via
 * stdin (so arbitrary content never touches argv / the shell). The CLI's
 * stream-json output is newline-delimited; we forward text deltas as `chunk`
 * events and resolve on the terminal `result` event.
 *
 * Verified against Claude Code CLI v2.1.x:
 *   claude -p --output-format stream-json --include-partial-messages --verbose \
 *          --no-session-persistence --tools "" [--model <m>]
 *
 * MVP limitations (documented in 13-phase4): no tool use, no MCP, no vision.
 * Tools are explicitly disabled (`--tools ""`) so the delegate stays chat-only.
 */
import { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { spawnClaudeCli } from './claude-cli-spawn';

export interface ClaudeMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ClaudeChatOptions {
  messages: ClaudeMessage[];
  model?: string;
}

export interface ClaudeCliRunHandle {
  cancel: () => void;
}

const KILL_GRACE_MS = 3000;

/**
 * Serialize a chat history into a single text prompt.
 *
 * Because the chat-only MVP passes everything through stdin (no `--system-prompt`
 * to avoid shell-quoting arbitrary content on Windows `.cmd` shims), system and
 * prior turns are inlined with role labels. The final user turn is appended last
 * so the model answers it.
 */
export function buildPromptText(messages: ClaudeMessage[]): string {
  const parts: string[] = [];
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content.trim());
  if (system.length > 0) {
    parts.push(system.join('\n\n'));
  }

  const turns = messages.filter((m) => m.role !== 'system');
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i];
    const isLastUser = i === turns.length - 1 && turn.role === 'user';
    if (isLastUser) {
      // Latest user turn: present plainly so the CLI treats it as the prompt.
      parts.push(turn.content.trim());
    } else {
      const label = turn.role === 'assistant' ? 'Assistant' : 'User';
      parts.push(`${label}: ${turn.content.trim()}`);
    }
  }
  return parts.join('\n\n').trim();
}

interface StreamEnvelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
}

/**
 * Streams a single chat turn from the Claude Code CLI.
 *
 * Events:
 *  - `chunk`  (delta: string)  incremental assistant text
 *  - `done`   (fullText: string) terminal success
 *  - `error`  (err: Error)
 *  - `stderr` (redacted: string) debug only; token-like material is masked
 */
export class ClaudeCliRunner extends EventEmitter {
  constructor(private readonly cliPath: string) {
    super();
  }

  invoke(options: ClaudeChatOptions): ClaudeCliRunHandle {
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--no-session-persistence',
      // Chat-only MVP: disable all built-in tools so the delegate never edits files.
      '--tools',
      '',
    ];
    if (options.model) {
      args.push('--model', options.model);
    }

    let proc: ChildProcess;
    try {
      proc = spawnClaudeCli(this.cliPath, args);
    } catch (err) {
      // Defer so listeners attached after invoke() still receive the error.
      queueMicrotask(() => this.emit('error', err instanceof Error ? err : new Error(String(err))));
      return { cancel: () => {} };
    }

    // Feed the prompt via stdin so arbitrary content never touches argv/shell.
    try {
      proc.stdin?.write(buildPromptText(options.messages));
      proc.stdin?.end();
    } catch {
      // If stdin is already gone the process will exit and surface an error.
    }

    let buffer = '';
    let fullText = '';
    let resultText: string | undefined;
    let emittedTerminal = false;

    const emitTerminal = (kind: 'done' | 'error', payload: string | Error) => {
      if (emittedTerminal) return;
      emittedTerminal = true;
      this.emit(kind, payload);
    };

    const handleEnvelope = (env: StreamEnvelope) => {
      if (env.type === 'stream_event') {
        const ev = env.event;
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          fullText += ev.delta.text;
          this.emit('chunk', ev.delta.text);
        }
        return;
      }
      if (env.type === 'result') {
        if (env.is_error || (env.subtype && env.subtype !== 'success')) {
          emitTerminal('error', new Error(env.result || `claude CLI error: ${env.subtype}`));
        } else {
          resultText = typeof env.result === 'string' ? env.result : fullText;
          emitTerminal('done', resultText);
        }
      }
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          handleEnvelope(JSON.parse(line) as StreamEnvelope);
        } catch {
          // Non-JSON lines (rare) are ignored.
        }
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      this.emit('stderr', redactSecrets(chunk.toString('utf8')));
    });

    proc.on('error', (err) => emitTerminal('error', err));
    proc.on('exit', (code) => {
      if (emittedTerminal) return;
      if (code === 0) {
        // Stream ended without an explicit result envelope — use accumulated text.
        emitTerminal('done', resultText ?? fullText);
      } else {
        emitTerminal('error', new Error(`claude CLI exited with code ${code ?? 'null'}`));
      }
    });

    return {
      cancel: () => {
        try {
          proc.kill('SIGTERM');
        } catch {
          // ignore
        }
        const killTimer = setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // ignore
          }
        }, KILL_GRACE_MS);
        proc.on('exit', () => clearTimeout(killTimer));
      },
    };
  }
}

/**
 * Mask anything that looks like a token/key/JWT so stderr is safe to log.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '***.jwt.***')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***')
    .replace(/("?(?:access_token|refresh_token|token|api[_-]?key)"?\s*[:=]\s*)"?[^"\s,}]+/gi, '$1***');
}
