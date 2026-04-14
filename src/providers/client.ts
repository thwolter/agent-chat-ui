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
) {
  return new Client({
    apiUrl: resolveApiUrl(apiUrl),
    apiKey,
    ...(authScheme && {
      defaultHeaders: {
        "X-Auth-Scheme": authScheme,
      },
    }),
  });
}
