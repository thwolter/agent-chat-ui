import { type NextRequest, NextResponse } from "next/server";
import {
  appendGatewayRefreshCookies,
  clearAuthCookies,
  clearGatewayRefreshCookie,
  getAuthBackendUrl,
  withDirectPrefix,
} from "@/lib/auth";

export async function POST(req: NextRequest) {
  let logoutHeaders: Headers | null = null;
  try {
    const cookieHeader = req.headers.get("cookie");
    const authorizationHeader = req.headers.get("authorization");
    const headers: Record<string, string> = {};
    if (cookieHeader) headers.cookie = cookieHeader;
    if (authorizationHeader) headers.authorization = authorizationHeader;

    const logoutResponse = await fetch(
      withDirectPrefix(getAuthBackendUrl(), "/auth/logout"),
      {
        method: "POST",
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        credentials: "include",
        cache: "no-store",
      },
    );
    logoutHeaders = logoutResponse.headers;
  } catch {
    // Frontend auth state should be cleared even if the gateway is unreachable.
  }

  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response);
  clearGatewayRefreshCookie(response);
  if (logoutHeaders) {
    appendGatewayRefreshCookies(response.headers, logoutHeaders);
  }
  return response;
}
