import { env } from "../../config/env.js";

const USER_AGENT = "AegisCyberAudit-OSINT/1.0";
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const MAX_RETRY_AFTER_MS = 30_000;

export interface OsintFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Reintentos después del primer intento. */
  retries?: number;
  baseDelayMs?: number;
  maxBytes?: number;
}

export interface OsintResponse {
  status: number;
  body: string;
}

export class OsintHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OsintHttpError";
  }
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelayMs(attempt: number, baseDelayMs: number, retryAfter: string | null): number {
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  // Backoff exponencial con jitter: varias corridas no reintentan a la vez.
  return baseDelayMs * 2 ** attempt * (0.5 + Math.random() / 2);
}

/** Corta la lectura al superar el tope: una fuente no controla cuánta memoria se usa. */
async function readBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new OsintHttpError(`Respuesta mayor a ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * GET con timeout, reintentos y tope de tamaño. Reintenta ante 429, 5xx y fallos
 * de red; otra respuesta, como un 404, vuelve tal cual para que la fuente decida.
 * Si se agotan los intentos, lanza `OsintHttpError`.
 */
export async function osintFetch(url: string, options: OsintFetchOptions = {}): Promise<OsintResponse> {
  const {
    headers = {},
    timeoutMs = env.OSINT_HTTP_TIMEOUT_MS,
    retries = 2,
    baseDelayMs = 500,
    maxBytes = DEFAULT_MAX_BYTES,
  } = options;

  let lastError = "sin respuesta";
  for (let attempt = 0; attempt <= retries; attempt++) {
    let retryAfter: string | null = null;
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!isRetryable(response.status)) {
        return { status: response.status, body: await readBody(response, maxBytes) };
      }
      retryAfter = response.headers.get("retry-after");
      await response.body?.cancel();
      lastError = `HTTP ${response.status}`;
    } catch (err) {
      if (err instanceof OsintHttpError) throw err;
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt, baseDelayMs, retryAfter)));
    }
  }
  throw new OsintHttpError(lastError);
}
