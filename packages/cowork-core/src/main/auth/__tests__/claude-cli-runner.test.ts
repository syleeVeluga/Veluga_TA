import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('../claude-cli-spawn', () => ({ spawnClaudeCli: spawnMock }));

import {
  ClaudeCliRunner,
  buildPromptText,
  redactSecrets,
  type ClaudeMessage,
} from '../claude-cli-runner';

class FakeProc extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  kill = vi.fn();
}

function streamEvent(text: string): string {
  return JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
  });
}

function resultEvent(text: string): string {
  return JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text });
}

describe('claude-cli-runner', () => {
  beforeEach(() => spawnMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('streams text deltas as chunks and resolves on the result envelope', async () => {
    const proc = new FakeProc();
    spawnMock.mockReturnValue(proc);
    const runner = new ClaudeCliRunner('/usr/bin/claude');

    const chunks: string[] = [];
    runner.on('chunk', (c: string) => chunks.push(c));
    const done = new Promise<string>((resolve) => runner.on('done', resolve));

    runner.invoke({ messages: [{ role: 'user', content: 'hi' }], model: 'opus' });

    // System message + flags reach argv; prompt goes to stdin.
    expect(proc.stdin.write).toHaveBeenCalledWith('hi');
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json']));
    expect(args).toEqual(expect.arrayContaining(['--model', 'opus']));
    expect(args).toEqual(expect.arrayContaining(['--tools', '']));

    proc.stdout.emit('data', Buffer.from(streamEvent('Hel') + '\n'));
    proc.stdout.emit('data', Buffer.from(streamEvent('lo') + '\n'));
    proc.stdout.emit('data', Buffer.from(resultEvent('Hello') + '\n'));

    await expect(done).resolves.toBe('Hello');
    expect(chunks).toEqual(['Hel', 'lo']);
  });

  it('reassembles JSON lines split across stdout chunks', async () => {
    const proc = new FakeProc();
    spawnMock.mockReturnValue(proc);
    const runner = new ClaudeCliRunner('/usr/bin/claude');
    const chunks: string[] = [];
    runner.on('chunk', (c: string) => chunks.push(c));
    const done = new Promise<string>((resolve) => runner.on('done', resolve));

    runner.invoke({ messages: [{ role: 'user', content: 'hi' }] });

    const line = streamEvent('split') + '\n';
    proc.stdout.emit('data', Buffer.from(line.slice(0, 10)));
    proc.stdout.emit('data', Buffer.from(line.slice(10)));
    proc.stdout.emit('data', Buffer.from(resultEvent('split') + '\n'));

    await expect(done).resolves.toBe('split');
    expect(chunks).toEqual(['split']);
  });

  it('emits error on an error result envelope', async () => {
    const proc = new FakeProc();
    spawnMock.mockReturnValue(proc);
    const runner = new ClaudeCliRunner('/usr/bin/claude');
    const err = new Promise<Error>((resolve) => runner.on('error', resolve));

    runner.invoke({ messages: [{ role: 'user', content: 'hi' }] });
    proc.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true }) + '\n')
    );

    await expect(err).resolves.toBeInstanceOf(Error);
  });

  it('emits error on a non-zero exit without a result', async () => {
    const proc = new FakeProc();
    spawnMock.mockReturnValue(proc);
    const runner = new ClaudeCliRunner('/usr/bin/claude');
    const err = new Promise<Error>((resolve) => runner.on('error', resolve));

    runner.invoke({ messages: [{ role: 'user', content: 'hi' }] });
    proc.emit('exit', 1);

    const e = await err;
    expect(e.message).toMatch(/exited with code 1/);
  });

  it('cancel() sends SIGTERM then SIGKILL after the grace period', () => {
    vi.useFakeTimers();
    const proc = new FakeProc();
    spawnMock.mockReturnValue(proc);
    const runner = new ClaudeCliRunner('/usr/bin/claude');

    const handle = runner.invoke({ messages: [{ role: 'user', content: 'hi' }] });
    handle.cancel();
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    vi.advanceTimersByTime(3000);
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    vi.useRealTimers();
  });
});

describe('buildPromptText', () => {
  it('inlines system + history and presents the final user turn plainly', () => {
    const messages: ClaudeMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'follow up' },
    ];
    const text = buildPromptText(messages);
    expect(text.startsWith('You are helpful.')).toBe(true);
    expect(text).toContain('User: first question');
    expect(text).toContain('Assistant: first answer');
    expect(text.endsWith('follow up')).toBe(true);
  });
});

describe('redactSecrets', () => {
  it('masks api keys, JWTs and bearer tokens', () => {
    expect(redactSecrets('key sk-abcdef123456 done')).toBe('key sk-*** done');
    expect(redactSecrets('Authorization: Bearer abc.def-ghi')).toContain('Bearer ***');
    expect(redactSecrets('"access_token":"super-secret-value"')).toContain('***');
    expect(redactSecrets('eyJhbGciOiJI.eyJzdWIiOiIx.sigPART')).toContain('***.jwt.***');
  });
});
