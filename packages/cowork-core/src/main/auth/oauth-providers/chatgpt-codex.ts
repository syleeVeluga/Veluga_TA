import crypto from 'node:crypto';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const SCOPES = ['openid', 'profile', 'email', 'offline_access'];
const OPENAI_AUTH_CLAIM = 'https://api.openai.' + 'com/auth';

export interface ChatGPTOAuthCredentials {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresAt: number;
  accountId?: string;
}

export function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthorizeUrl(args: {
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('state', args.state);
  url.searchParams.set('code_challenge', args.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', 'veluga');
  return url.toString();
}

export async function exchangeCodeForToken(args: {
  code: string;
  redirectUri: string;
  verifier: string;
}): Promise<ChatGPTOAuthCredentials> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.verifier,
    client_id: CLIENT_ID,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status}`);
  }

  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
  };
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
    throw new Error('Token exchange response missing required fields');
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    idToken: json.id_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    accountId: extractAccountIdFromJwt(json.access_token) || extractAccountIdFromJwt(json.id_token),
  };
}

export async function refreshToken(
  creds: ChatGPTOAuthCredentials
): Promise<ChatGPTOAuthCredentials> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
    client_id: CLIENT_ID,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status}`);
  }

  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
  };
  if (!json.access_token || typeof json.expires_in !== 'number') {
    throw new Error('Token refresh response missing required fields');
  }

  return {
    ...creds,
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? creds.refreshToken,
    idToken: json.id_token ?? creds.idToken,
    expiresAt: Date.now() + json.expires_in * 1000,
    accountId:
      extractAccountIdFromJwt(json.access_token) ||
      extractAccountIdFromJwt(json.id_token) ||
      creds.accountId,
  };
}

function extractAccountIdFromJwt(jwt: string | undefined): string | undefined {
  try {
    const payloadB64 = jwt?.split('.')[1];
    if (!payloadB64) {
      return undefined;
    }
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const authClaim = payload[OPENAI_AUTH_CLAIM];
    if (authClaim && typeof authClaim === 'object') {
      const accountId = (authClaim as Record<string, unknown>).chatgpt_account_id;
      if (typeof accountId === 'string') {
        return accountId;
      }
    }
    const directAccountId = payload.account_id || payload[`${OPENAI_AUTH_CLAIM}/account_id`];
    return typeof directAccountId === 'string' ? directAccountId : undefined;
  } catch {
    return undefined;
  }
}
