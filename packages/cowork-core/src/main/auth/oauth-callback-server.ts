import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface CallbackResult {
  code: string;
  state: string;
}

interface PendingFlow {
  state: string;
  resolve: (result: CallbackResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class OAuthCallbackServer {
  private server?: http.Server;
  private pending?: PendingFlow;

  async start(
    state: string,
    timeoutMs = 5 * 60_000
  ): Promise<{
    redirectUri: string;
    promise: Promise<CallbackResult>;
  }> {
    if (this.pending) {
      throw new Error('Another OAuth flow is already in progress');
    }

    const promise = new Promise<CallbackResult>((resolve, reject) => {
      this.pending = {
        state,
        resolve,
        reject,
        timeout: setTimeout(() => {
          reject(new Error('OAuth flow timed out'));
          this.stop();
        }, timeoutMs),
      };
    });

    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    const port = await new Promise<number>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        reject(new Error('OAuth callback server was not created'));
        return;
      }

      server.once('error', (error) => {
        this.stop();
        reject(error);
      });
      server.listen(0, '127.0.0.1', () => {
        resolve((server.address() as AddressInfo).port);
      });
    });

    return {
      redirectUri: `http://127.0.0.1:${port}/oauth_callback`,
      promise,
    };
  }

  stop(): void {
    if (this.pending) {
      clearTimeout(this.pending.timeout);
      this.pending = undefined;
    }
    this.server?.close();
    this.server = undefined;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const pending = this.pending;
    if (!pending) {
      res.writeHead(400);
      res.end('no oauth flow');
      return;
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname !== '/oauth_callback') {
      res.writeHead(404);
      res.end('not found');
      return;
    }

    const error = url.searchParams.get('error');
    if (error) {
      this.reject(res, `OAuth provider returned error: ${error}`, `OAuth error: ${error}`);
      return;
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) {
      this.reject(res, 'Missing code or state', 'missing code/state');
      return;
    }

    if (state !== pending.state) {
      this.reject(res, 'CSRF state mismatch', 'state mismatch');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<!doctype html><html><body><h2>Login complete</h2><p>You can close this window.</p></body></html>'
    );
    pending.resolve({ code, state });
    this.stop();
  }

  private reject(res: http.ServerResponse, message: string, responseText: string): void {
    const pending = this.pending;
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(responseText);
    pending?.reject(new Error(message));
    this.stop();
  }
}
