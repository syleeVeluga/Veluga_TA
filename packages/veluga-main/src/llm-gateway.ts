export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  max_tokens?: number;
  json_schema?: object;
}

export interface ChatResponse {
  text: string;
  usage: { prompt_tokens: number; completion_tokens: number };
  model: string;
}

export interface LlmGateway {
  chat(req: ChatRequest): Promise<ChatResponse>;
}

function timeoutFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function isAbortLike(error: unknown): boolean {
  // Key off the abort/timeout error name only. Matching the message text would
  // misclassify unrelated failures (e.g. "connect ETIMEDOUT", or a server body
  // mentioning "timeout") as client-side timeouts.
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createOpenAICompatibleGateway(env: NodeJS.ProcessEnv = process.env): LlmGateway {
  const baseURL = env.VELUGA_LLM_GATEWAY_URL;
  if (!baseURL) {
    throw new Error('VELUGA_LLM_GATEWAY_URL is required; closed-network builds forbid public fallback endpoints');
  }
  const apiKey = env.VELUGA_LLM_API_KEY ?? '';
  const timeoutMs = timeoutFromEnv(env.VELUGA_LLM_GATEWAY_TIMEOUT_MS, 120000);
  return {
    async chat(req: ChatRequest): Promise<ChatResponse> {
      let response: Response;
      try {
        response = await fetch(new URL('/v1/chat/completions', baseURL), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`
          },
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            model: req.model,
            messages: req.messages,
            temperature: req.temperature,
            max_tokens: req.max_tokens,
            response_format: req.json_schema
              ? { type: 'json_schema', json_schema: { name: 'veluga_schema', schema: req.json_schema } }
              : undefined
          })
        });
      } catch (error) {
        if (isAbortLike(error)) {
          throw new Error(`LLM gateway timed out after ${timeoutMs}ms`);
        }
        throw new Error(`LLM gateway unreachable: ${errorMessage(error)}`);
      }
      if (!response.ok) {
        throw new Error(`LLM gateway failed: ${response.status} ${response.statusText}`);
      }
      let json: {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };
      try {
        json = await response.json();
      } catch (error) {
        // The timeout signal keeps aborting while the body streams, so a stall
        // during the body read surfaces here rather than at the fetch call.
        if (isAbortLike(error)) {
          throw new Error(`LLM gateway timed out after ${timeoutMs}ms`);
        }
        throw error;
      }
      return {
        text: json.choices?.[0]?.message?.content ?? '',
        usage: {
          prompt_tokens: json.usage?.prompt_tokens ?? 0,
          completion_tokens: json.usage?.completion_tokens ?? 0
        },
        model: json.model ?? req.model
      };
    }
  };
}
