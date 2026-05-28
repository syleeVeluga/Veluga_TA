import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const COMMANDS = new Set(['inspect', 'login', 'call', 'agent', 'all']);

function getArg(name) {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function maskSecret(value) {
  if (!value) {
    return undefined;
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function findCommand() {
  return process.argv.slice(2).find((arg) => COMMANDS.has(arg)) || 'inspect';
}

function pickCodexModel(models, requestedModelId) {
  if (requestedModelId) {
    const requested = models.find((model) => model.id === requestedModelId);
    if (requested) {
      return requested;
    }
  }
  return models.find((model) => model.id.includes('codex')) || models[0];
}

async function inspectStaticSupport() {
  const ai = await import('@mariozechner/pi-ai');
  const oauth = await import('@mariozechner/pi-ai/oauth');
  const agent = await import('@mariozechner/pi-coding-agent');

  const provider = oauth.getOAuthProvider('openai-codex');
  const models = ai.getModels('openai-codex') || [];
  const model = pickCodexModel(models, getArg('--model'));
  const auth = agent.AuthStorage.inMemory();
  const registry = new agent.ModelRegistry(auth);

  let openaiRuntimeKeyForCodex;
  let codexRuntimeKeyForCodex;
  if (model) {
    auth.setRuntimeApiKey('openai', 'runtime-openai');
    openaiRuntimeKeyForCodex = await registry.getApiKey(model);
    auth.setRuntimeApiKey('openai-codex', 'runtime-openai-codex');
    codexRuntimeKeyForCodex = await registry.getApiKey(model);
  }

  return {
    q1Provider: {
      pass:
        !!provider &&
        typeof provider.login === 'function' &&
        typeof provider.getApiKey === 'function' &&
        typeof provider.refreshToken === 'function',
      id: provider?.id,
      name: provider?.name,
      hasLogin: typeof provider?.login,
      hasGetApiKey: typeof provider?.getApiKey,
      hasRefreshToken: typeof provider?.refreshToken,
      usesCallbackServer: provider?.usesCallbackServer,
    },
    q2BaseUrl: {
      pass:
        !!model &&
        model.provider === 'openai-codex' &&
        model.api === 'openai-codex-responses' &&
        model.baseUrl.includes('chatgpt.com/backend-api'),
      providerCount: models.length,
      selectedModel: model
        ? {
            provider: model.provider,
            id: model.id,
            api: model.api,
            baseUrl: model.baseUrl,
            headers: model.headers,
          }
        : null,
    },
    q5AuthStorageDryRun: {
      pass: openaiRuntimeKeyForCodex === undefined && codexRuntimeKeyForCodex === 'runtime-openai-codex',
      note: "Codex models resolve credentials under provider id 'openai-codex', not 'openai'.",
      setRuntimeApiKeyOpenaiResult: openaiRuntimeKeyForCodex ?? null,
      setRuntimeApiKeyOpenaiCodexResult: codexRuntimeKeyForCodex ?? null,
    },
  };
}

async function login() {
  const { loginOpenAICodex } = await import('@mariozechner/pi-ai/oauth');
  const rl = createInterface({ input, output });

  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const credentials = await loginOpenAICodex({
      onAuth(info) {
        console.log('\nOpen this URL in your browser:');
        console.log(info.url);
        if (info.instructions) {
          console.log(`\n${info.instructions}`);
        }
      },
      onProgress(message) {
        console.log(message);
      },
      onPrompt(prompt) {
        return rl.question(`${prompt.message} `);
      },
      onManualCodeInput() {
        if (hasArg('--no-manual-prompt')) {
          return new Promise(() => undefined);
        }
        return rl.question('Paste the authorization code or full redirect URL when ready: ');
      },
      originator: 'veluga',
    });

    console.log(
      JSON.stringify(
        {
          access: maskSecret(credentials.access),
          refresh: maskSecret(credentials.refresh),
          expires: new Date(credentials.expires).toISOString(),
          accountId: credentials.accountId,
        },
        null,
        2
      )
    );
    return credentials;
  } finally {
    rl.close();
  }
}

async function callWithToken(accessToken) {
  if (!accessToken) {
    throw new Error('Missing access token. Pass --access-token=<token> or run all after login.');
  }

  const ai = await import('@mariozechner/pi-ai');
  const model = pickCodexModel(ai.getModels('openai-codex') || [], getArg('--model'));
  if (!model) {
    throw new Error('No openai-codex model found.');
  }

  const stream = ai.streamSimpleOpenAICodexResponses(
    model,
    {
      systemPrompt: 'Reply with one short Korean greeting.',
      messages: [{ role: 'user', content: 'say hi in korean', timestamp: Date.now() }],
    },
    {
      apiKey: accessToken,
      maxTokens: 64,
      temperature: 0,
      transport: 'sse',
    }
  );

  const message = await stream.result();
  if (message.stopReason === 'error') {
    throw new Error(message.errorMessage || 'Codex response failed');
  }

  console.log(
    JSON.stringify(
      {
        model: `${model.provider}/${model.id}`,
        baseUrl: model.baseUrl,
        stopReason: message.stopReason,
        text: message.content.filter((item) => item.type === 'text').map((item) => item.text).join(''),
      },
      null,
      2
    )
  );
  return message;
}

async function agentWithToken(accessToken) {
  if (!accessToken) {
    throw new Error('Missing access token. Pass --access-token=<token> or run all after login.');
  }

  const ai = await import('@mariozechner/pi-ai');
  const agent = await import('@mariozechner/pi-coding-agent');
  const model = pickCodexModel(ai.getModels('openai-codex') || [], getArg('--model'));
  if (!model) {
    throw new Error('No openai-codex model found.');
  }

  const authStorage = agent.AuthStorage.inMemory();
  authStorage.setRuntimeApiKey('openai-codex', accessToken);

  const { session } = await agent.createAgentSession({
    authStorage,
    model,
    tools: agent.readOnlyTools,
    cwd: process.cwd(),
  });

  const events = [];
  const unsubscribe = session.subscribe((event) => {
    events.push(event.type);
  });

  try {
    await session.prompt('Reply with one short Korean greeting.');
    while (session.isStreaming) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.log(
      JSON.stringify(
        {
          model: `${model.provider}/${model.id}`,
          eventTypes: [...new Set(events)],
          lastAssistantText: session.getLastAssistantText(),
        },
        null,
        2
      )
    );
  } finally {
    unsubscribe();
    session.dispose();
  }
}

async function main() {
  const command = findCommand();
  if (command === 'inspect') {
    console.log(JSON.stringify(await inspectStaticSupport(), null, 2));
    return;
  }

  if (command === 'login') {
    await login();
    return;
  }

  if (command === 'call') {
    await callWithToken(getArg('--access-token') || process.env.CHATGPT_CODEX_ACCESS_TOKEN);
    return;
  }

  if (command === 'agent') {
    await agentWithToken(getArg('--access-token') || process.env.CHATGPT_CODEX_ACCESS_TOKEN);
    return;
  }

  if (command === 'all') {
    console.log(JSON.stringify(await inspectStaticSupport(), null, 2));
    const credentials = await login();
    await callWithToken(credentials.access);
    await agentWithToken(credentials.access);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
