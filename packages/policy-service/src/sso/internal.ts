import { createHmac, randomUUID } from 'node:crypto';
import type { Identity } from '../merge.js';

export interface SsoToken {
  token: string;
  expires_at: string;
}

export interface SsoProvider {
  login(identity: Identity): Promise<SsoToken>;
  resolve(token: string): Promise<Identity>;
}

export class InMemoryTokenVault {
  private token: SsoToken | null = null;

  save(token: SsoToken): void {
    this.token = token;
  }

  load(): SsoToken | null {
    return this.token;
  }
}

export class InternalSsoProvider implements SsoProvider {
  private readonly issued = new Map<string, Identity>();

  constructor(private readonly secret = 'veluga-dev-idp') {}

  async login(identity: Identity): Promise<SsoToken> {
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const nonce = randomUUID();
    const body = Buffer.from(JSON.stringify({ identity, expires, nonce }), 'utf8').toString('base64url');
    const sig = createHmac('sha256', this.secret).update(body).digest('base64url');
    const token = `${body}.${sig}`;
    this.issued.set(token, identity);
    return { token, expires_at: expires };
  }

  async resolve(token: string): Promise<Identity> {
    const [body, sig] = token.split('.');
    const expected = createHmac('sha256', this.secret).update(body).digest('base64url');
    if (sig !== expected) {
      throw new Error('Invalid SSO token signature');
    }
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { identity: Identity; expires: string };
    if (Date.parse(parsed.expires) <= Date.now()) {
      throw new Error('SSO token expired');
    }
    return parsed.identity;
  }
}
