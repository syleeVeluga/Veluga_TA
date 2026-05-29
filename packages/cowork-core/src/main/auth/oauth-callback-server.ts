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

export interface OAuthCallbackServerOptions {
  port?: number;
  fallbackPort?: number;
  path?: string;
  redirectHost?: string;
  bindHost?: string;
}

export class OAuthCallbackServer {
  private server?: http.Server;
  private pending?: PendingFlow;
  private callbackPath = '/oauth_callback';

  async start(
    state: string,
    timeoutMs = 5 * 60_000,
    options: OAuthCallbackServerOptions = {}
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

    this.callbackPath = options.path ?? '/oauth_callback';
    const requestedPort = options.port ?? 0;
    const bindHost = options.bindHost ?? '127.0.0.1';
    const redirectHost = options.redirectHost ?? bindHost;

    let port: number;
    try {
      port = await this.listen(requestedPort, bindHost);
    } catch (error) {
      if (!requestedPort || !options.fallbackPort) {
        this.stop();
        throw error;
      }
      try {
        port = await this.listen(options.fallbackPort, bindHost);
      } catch (fallbackError) {
        this.stop();
        throw fallbackError;
      }
    }

    return {
      redirectUri: `http://${redirectHost}:${port}${this.callbackPath}`,
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

  private async listen(port: number, bindHost: string): Promise<number> {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    return await new Promise<number>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        reject(new Error('OAuth callback server was not created'));
        return;
      }

      server.once('error', (error) => {
        this.server = undefined;
        reject(error);
      });
      server.listen(port, bindHost, () => {
        resolve((server.address() as AddressInfo).port);
      });
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const pending = this.pending;
    if (!pending) {
      res.writeHead(400);
      res.end('no oauth flow');
      return;
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname !== this.callbackPath) {
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
