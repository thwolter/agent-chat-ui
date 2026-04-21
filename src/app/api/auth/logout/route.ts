import { type NextRequest, NextResponse } from "next/server";
import {
  appendGatewayRefreshCookies,
  clearAuthCookies,
  getAuthBackendUrl,
  withDirectPrefix,
} from "@/lib/auth";

export async function POST(req: NextRequest) {
  let logoutHeaders: Headers | null = null;
  try {
    const cookieHeader = req.headers.get("cookie");
    const logoutResponse = await fetch(
      withDirectPrefix(getAuthBackendUrl(), "/auth/logout"),
      {
        method: "POST",
        headers: cookieHeader ? { cookie: cookieHeader } : undefined,
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
  if (logoutHeaders) {
    appendGatewayRefreshCookies(response.headers, logoutHeaders);
  }
  return response;
}
