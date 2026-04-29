import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_EXPIRES_AT_COOKIE,
  AUTH_TOKEN_COOKIE,
  AUTH_TOKEN_TYPE_COOKIE,
  clearAuthCookies,
  clearGatewayRefreshCookie,
  getAuthBackendUrl,
  type TokenResponse,
  withDirectPrefix,
} from "@/lib/auth";
import { applyRefreshResult, refreshAccessToken } from "@/lib/auth-server";

async function fetchGatewaySession(
  backendUrl: string,
  token: string,
  tokenType: string,
) {
  return fetch(withDirectPrefix(backendUrl, "/auth/session"), {
    headers: {
      authorization: `${tokenType} ${token}`,
    },
    cache: "no-store",
  });
}

function unauthenticatedResponse(expiresAt?: string | null) {
  const response = NextResponse.json({
    authenticated: false,
    expiresAt: expiresAt ? Number(expiresAt) : null,
    agents: [],
  });
  clearAuthCookies(response);
  clearGatewayRefreshCookie(response);
  return response;
}

export async function GET(req: NextRequest) {
  const backendUrl = getAuthBackendUrl();
  let token = req.cookies.get(AUTH_TOKEN_COOKIE)?.value;
  let tokenType = req.cookies.get(AUTH_TOKEN_TYPE_COOKIE)?.value || "bearer";
  const expiresAt = req.cookies.get(AUTH_EXPIRES_AT_COOKIE)?.value;
  let refreshResult: Awaited<ReturnType<typeof refreshAccessToken>> | undefined;

  if (!token) {
    try {
      refreshResult = await refreshAccessToken(req);
      token = refreshResult.payload.access_token;
      tokenType = (refreshResult.payload.token_type || "bearer").toLowerCase();
    } catch {
      return unauthenticatedResponse(expiresAt);
    }
  }

  try {
    let sessionResponse = await fetchGatewaySession(
      backendUrl,
      token,
      tokenType,
    );

    if (!sessionResponse.ok) {
      try {
        refreshResult = await refreshAccessToken(req);
        const refreshedPayload = refreshResult.payload as TokenResponse;
        token = refreshedPayload.access_token;
        tokenType = (refreshedPayload.token_type || "bearer").toLowerCase();
        sessionResponse = await fetchGatewaySession(
          backendUrl,
          token,
          tokenType,
        );
      } catch {
        return unauthenticatedResponse(expiresAt);
      }
      if (!sessionResponse.ok) return unauthenticatedResponse(expiresAt);
    }

    const session = (await sessionResponse.json()) as {
      user: {
        id: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
        is_admin: boolean;
      };
      agents: {
        id: string;
        key: string;
        name: string;
        description: string | null;
        url: string;
        assistant_id: string | null;
        graph_id: string | null;
      }[];
    };

    const response = NextResponse.json({
      authenticated: true,
      expiresAt: refreshResult
        ? Date.now() + refreshResult.payload.expires_in * 1000
        : expiresAt
          ? Number(expiresAt)
          : null,
      user: session.user,
      agents: session.agents,
    });
    if (refreshResult) applyRefreshResult(response, refreshResult);
    return response;
  } catch {
    try {
      const meResponse = await fetch(withDirectPrefix(backendUrl, "/auth/me"), {
        headers: {
          authorization: `${tokenType} ${token}`,
        },
        cache: "no-store",
      });

      if (!meResponse.ok) {
        return unauthenticatedResponse(expiresAt);
      }

      const me = (await meResponse.json()) as {
        user_id: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
        is_admin: boolean;
      };

      const response = NextResponse.json({
        authenticated: true,
        expiresAt: refreshResult
          ? Date.now() + refreshResult.payload.expires_in * 1000
          : expiresAt
            ? Number(expiresAt)
            : null,
        user: {
          id: me.user_id,
          email: me.email,
          first_name: me.first_name,
          last_name: me.last_name,
          is_admin: me.is_admin,
        },
        agents: [],
      });
      if (refreshResult) applyRefreshResult(response, refreshResult);
      return response;
    } catch {
      return unauthenticatedResponse(expiresAt);
    }
  }
}
