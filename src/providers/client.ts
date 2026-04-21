import { Client } from "@langchain/langgraph-sdk";

export function resolveApiUrl(apiUrl: string): string {
  if (/^https?:\/\//i.test(apiUrl)) {
    return apiUrl.replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    return new URL(apiUrl, window.location.origin)
      .toString()
      .replace(/\/$/, "");
  }

  return apiUrl;
}

export function createClient(
  apiUrl: string,
  apiKey?: string,
  authScheme?: string,
  defaultHeaders?: Record<string, string>,
) {
  return new Client({
    apiUrl: resolveApiUrl(apiUrl),
    apiKey,
    defaultHeaders: {
      ...(defaultHeaders ?? {}),
      ...(authScheme ? { "X-Auth-Scheme": authScheme } : {}),
    },
  });
}
