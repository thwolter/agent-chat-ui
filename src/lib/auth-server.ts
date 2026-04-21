import { type NextRequest, NextResponse } from "next/server";
import {
  appendGatewayRefreshCookies,
  applyAccessTokenCookies,
  clearAuthCookies,
  getAuthBackendUrl,
  type TokenResponse,
  withDirectPrefix,
} from "@/lib/auth";

type RefreshResult = {
  payload: TokenResponse;
  headers: Headers;
};

const refreshPromises = new Map<string, Promise<RefreshResult>>();

function getCookieHeader(req: NextRequest): string {
  return req.headers.get("cookie") ?? "";
}

async function callRefresh(cookieHeader: string): Promise<RefreshResult> {
  const response = await fetch(
    withDirectPrefix(getAuthBackendUrl(), "/auth/refresh"),
    {
      method: "POST",
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      credentials: "include",
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error("Refresh failed");
  }

  const payload = (await response.json()) as TokenResponse;
  if (!payload.access_token || !payload.expires_in) {
    throw new Error("Gateway returned an invalid refresh response.");
  }

  return {
    payload,
    headers: response.headers,
  };
}

export async function refreshAccessToken(
  req: NextRequest,
): Promise<RefreshResult> {
  const cookieHeader = getCookieHeader(req);
  const key = cookieHeader || "__anonymous__";
  const existing = refreshPromises.get(key);
  if (existing) return existing;

  const promise = callRefresh(cookieHeader).finally(() => {
    refreshPromises.delete(key);
  });
  refreshPromises.set(key, promise);
  return promise;
}

export function applyRefreshResult(
  response: NextResponse,
  refreshResult: RefreshResult,
) {
  applyAccessTokenCookies(response, refreshResult.payload);
  appendGatewayRefreshCookies(response.headers, refreshResult.headers);
}

export function clearAuthStateResponse(
  body: Record<string, unknown>,
  status = 401,
) {
  const response = NextResponse.json(body, { status });
  clearAuthCookies(response);
  return response;
}
