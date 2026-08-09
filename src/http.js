import { Agent } from "undici";

export const dispatcher = new Agent({
  connections: 64,
  pipelining: 1,
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 120_000,
  connect: { timeout: 5_000 },
});

export async function request(url, options = {}, timeoutMs = 10_000) {
  const response = await fetch(url, {
    ...options,
    dispatcher,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "Mozilla/5.0", ...options.headers },
  });
  return response;
}
