import Redis from "ioredis";
import { REDIS_URL, REDIS_COMMAND_TIMEOUT_MS } from "./env";

const g = globalThis as typeof globalThis & { _nexradRedis?: Redis };

export function getRedis(): Redis {
  if (!g._nexradRedis) {
    g._nexradRedis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
      lazyConnect: true,
    });
    g._nexradRedis.on("error", (err) => console.error("[redis] connection error", err));
  }
  return g._nexradRedis;
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
