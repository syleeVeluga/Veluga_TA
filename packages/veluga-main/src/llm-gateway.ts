export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: MessageContent;
}

export type MessageContent = string | LlmContentBlock[];

export type LlmContentBlock = TextContentBlock | ImageContentBlock;

export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ImageContentBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: ImageMediaType;
    data: string;
  };
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

export const ALLOWED_IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export type ImageMediaType = (typeof ALLOWED_IMAGE_MEDIA_TYPES)[number];

type OpenAICompatibleMessage = {
  role: Message['role'];
  content: string | OpenAICompatibleContentPart[];
};

type OpenAICompatibleContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const allowedImageMediaTypes = new Set<string>(ALLOWED_IMAGE_MEDIA_TYPES);

function positiveIntFromEnv(value: string | undefined, fallback: number): number {
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

function normalizeBase64ImageData(value: string): { data: string; byteLength: number } {
  const normalized = value.replace(/\s+/g, '');
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error('LLM gateway image content must be valid base64');
  }
  return {
    data: normalized,
    byteLength: Buffer.from(normalized, 'base64').length
  };
}

function toOpenAICompatibleMessages(messages: Message[], maxImageBytes: number): OpenAICompatibleMessage[] {
  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return { role: message.role, content: message.content };
    }

    const parts: OpenAICompatibleContentPart[] = [];
    for (const block of message.content) {
      if (block.type === 'text') {
        if (block.text) parts.push({ type: 'text', text: block.text });
        continue;
      }

      if (!allowedImageMediaTypes.has(block.source.media_type)) {
        throw new Error(`LLM gateway image content type is not allowed: ${block.source.media_type}`);
      }
      const { data, byteLength } = normalizeBase64ImageData(block.source.data);
      if (byteLength > maxImageBytes) {
        throw new Error(`LLM gateway image content exceeds ${maxImageBytes} bytes`);
      }
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${block.source.media_type};base64,${data}`
        }
      });
    }

    return {
      role: message.role,
      content: parts.length > 0 ? parts : ''
    };
  });
}

export function createOpenAICompatibleGateway(env: NodeJS.ProcessEnv = process.env): LlmGateway {
  const baseURL = env.VELUGA_LLM_GATEWAY_URL;
  if (!baseURL) {
    throw new Error('VELUGA_LLM_GATEWAY_URL is required; closed-network builds forbid public fallback endpoints');
  }
  const apiKey = env.VELUGA_LLM_API_KEY ?? '';
  const timeoutMs = positiveIntFromEnv(env.VELUGA_LLM_GATEWAY_TIMEOUT_MS, 120000);
  const maxImageBytes = positiveIntFromEnv(env.VELUGA_LLM_IMAGE_MAX_BYTES, DEFAULT_MAX_IMAGE_BYTES);
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
            messages: toOpenAICompatibleMessages(req.messages, maxImageBytes),
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
