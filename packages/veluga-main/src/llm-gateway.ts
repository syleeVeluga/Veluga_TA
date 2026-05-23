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

export function createOpenAICompatibleGateway(env: NodeJS.ProcessEnv = process.env): LlmGateway {
  const baseURL = env.VELUGA_LLM_GATEWAY_URL;
  if (!baseURL) {
    throw new Error('VELUGA_LLM_GATEWAY_URL is required; closed-network builds forbid public fallback endpoints');
  }
  const apiKey = env.VELUGA_LLM_API_KEY ?? '';
  return {
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const response = await fetch(new URL('/v1/chat/completions', baseURL), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`
        },
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
      if (!response.ok) {
        throw new Error(`LLM gateway failed: ${response.status} ${response.statusText}`);
      }
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };
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
