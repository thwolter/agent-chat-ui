import { type NextRequest, NextResponse } from "next/server";
import {
  AUTH_EMAIL_COOKIE,
  AUTH_TOKEN_COOKIE,
  AUTH_TOKEN_TYPE_COOKIE,
  AUTH_USER_ID_COOKIE,
  AUTH_USERNAME_COOKIE,
  getAuthBackendUrl,
  normalizeBackendUrl,
  type SessionAgent,
  type TokenResponse,
  withDirectPrefix,
} from "@/lib/auth";
import {
  applyRefreshResult,
  clearAuthStateResponse,
  refreshAccessToken,
} from "@/lib/auth-server";

export const runtime = "edge";

const LANGGRAPH_API_URL = process.env.LANGGRAPH_API_URL;
const LANGGRAPH_BEARER_TOKEN =
  process.env.LANGGRAPH_BEARER_TOKEN ?? process.env.LANGSMITH_API_KEY;

type RefreshResult = Awaited<ReturnType<typeof refreshAccessToken>>;

type AuthOverride = {
  token: string;
  tokenType: string;
};

async function fetchAuthorizedAgents(
  token: string,
  tokenType: string,
): Promise<SessionAgent[]> {
  const response = await fetch(
    withDirectPrefix(getAuthBackendUrl(), "/auth/session"),
    {
      headers: {
        authorization: `${tokenType} ${token}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) return [];

  const session = (await response.json()) as { agents?: SessionAgent[] };
  return session.agents ?? [];
}

async function getAuthorizedAgents(
  req: NextRequest,
): Promise<{ agents: SessionAgent[]; refreshResult?: RefreshResult }> {
  let cookieToken = req.cookies.get(AUTH_TOKEN_COOKIE)?.value;
  let cookieTokenType =
    req.cookies.get(AUTH_TOKEN_TYPE_COOKIE)?.value || "bearer";
  let refreshResult: RefreshResult | undefined;

  if (!cookieToken) {
    try {
      refreshResult = await refreshAccessToken(req);
      cookieToken = refreshResult.payload.access_token;
      cookieTokenType = (
        refreshResult.payload.token_type || "bearer"
      ).toLowerCase();
    } catch {
      return { agents: [] };
    }
  }

  let agents = await fetchAuthorizedAgents(cookieToken, cookieTokenType);
  if (agents.length > 0) return { agents, refreshResult };

  try {
    refreshResult = await refreshAccessToken(req);
    agents = await fetchAuthorizedAgents(
      refreshResult.payload.access_token,
      (refreshResult.payload.token_type || "bearer").toLowerCase(),
    );
    return { agents, refreshResult };
  } catch {
    return { agents: [] };
  }
}

async function resolveBaseUrl(
  req: NextRequest,
): Promise<{ baseUrl: string; refreshResult?: RefreshResult }> {
  const agentId = req.headers.get("x-agent-id");
  if (agentId) {
    const { agents, refreshResult } = await getAuthorizedAgents(req);
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) {
      throw new Error("Selected agent is not available for this user.");
    }
    return { baseUrl: normalizeBackendUrl(agent.url), refreshResult };
  }

  if (LANGGRAPH_API_URL) {
    return { baseUrl: LANGGRAPH_API_URL.replace(/\/$/, "") };
  }
  throw new Error("No agent selected. Please choose an agent first.");
}

async function buildTargetUrl(
  req: NextRequest,
  pathSegments: string[] | undefined,
  requestUrl: URL,
): Promise<{ targetUrl: URL; refreshResult?: RefreshResult }> {
  const { baseUrl, refreshResult } = await resolveBaseUrl(req);
  const path = (pathSegments ?? []).join("/");
  const target = new URL(withDirectPrefix(baseUrl, path));
  target.search = requestUrl.search;
  return { targetUrl: target, refreshResult };
}

function buildProxyHeaders(
  req: NextRequest,
  isAuthRoute: boolean,
  authOverride?: AuthOverride,
): Headers {
  const headers = new Headers(req.headers);

  headers.delete("host");
  headers.delete("content-length");
  headers.delete("connection");
  headers.delete("cookie");
  headers.delete("x-agent-id");

  if (isAuthRoute) {
    return headers;
  }

  const cookieToken =
    authOverride?.token ?? req.cookies.get(AUTH_TOKEN_COOKIE)?.value;
  const cookieTokenType =
    authOverride?.tokenType ??
    req.cookies.get(AUTH_TOKEN_TYPE_COOKIE)?.value ??
    "bearer";
  const cookieUserId = req.cookies.get(AUTH_USER_ID_COOKIE)?.value;
  const cookieUsername = req.cookies.get(AUTH_USERNAME_COOKIE)?.value;
  const cookieEmail = req.cookies.get(AUTH_EMAIL_COOKIE)?.value;

  if (cookieToken) {
    headers.set("authorization", `${cookieTokenType} ${cookieToken}`);
    if (cookieUserId) headers.set("x-auth-user-id", cookieUserId);
    if (cookieUsername) headers.set("x-auth-username", cookieUsername);
    if (cookieEmail) headers.set("x-auth-email", cookieEmail);
    return headers;
  }

  if (!LANGGRAPH_BEARER_TOKEN) {
    throw new Error(
      "No authentication token configured. Please sign in first.",
    );
  }

  headers.set("authorization", `Bearer ${LANGGRAPH_BEARER_TOKEN}`);

  return headers;
}

function authOverrideFromPayload(payload: TokenResponse): AuthOverride {
  return {
    token: payload.access_token,
    tokenType: (payload.token_type || "bearer").toLowerCase(),
  };
}

async function proxy(
  req: NextRequest,
  { params }: { params: Promise<{ _path?: string[] }> },
): Promise<Response> {
  try {
    const resolvedParams = await params;
    const path = (resolvedParams._path ?? []).join("/");
    const isAuthRoute = path.startsWith("auth/");
    const { targetUrl, refreshResult: routeRefreshResult } =
      await buildTargetUrl(req, resolvedParams._path, req.nextUrl);
    const routeAuthOverride = routeRefreshResult
      ? authOverrideFromPayload(routeRefreshResult.payload)
      : undefined;

    const method = req.method.toUpperCase();
    const bodyBuffer =
      method !== "GET" && method !== "HEAD"
        ? await req.arrayBuffer()
        : undefined;
    const init: RequestInit = {
      method,
      headers: buildProxyHeaders(req, isAuthRoute, routeAuthOverride),
    };

    if (bodyBuffer && bodyBuffer.byteLength > 0) {
      init.body = bodyBuffer;
    }

    let upstreamResponse = await fetch(targetUrl, init);
    let retryRefreshResult: RefreshResult | undefined;

    if (!isAuthRoute && upstreamResponse.status === 401) {
      try {
        retryRefreshResult = await refreshAccessToken(req);
        upstreamResponse = await fetch(targetUrl, {
          ...init,
          headers: buildProxyHeaders(
            req,
            isAuthRoute,
            authOverrideFromPayload(retryRefreshResult.payload),
          ),
          body:
            bodyBuffer && bodyBuffer.byteLength > 0
              ? bodyBuffer.slice(0)
              : undefined,
        });
      } catch {
        return clearAuthStateResponse({
          error: "Authentication refresh failed.",
        });
      }
    }

    const headers = new Headers(upstreamResponse.headers);
    headers.delete("set-cookie");

    const response = new NextResponse(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
    if (routeRefreshResult) applyRefreshResult(response, routeRefreshResult);
    if (retryRefreshResult) applyRefreshResult(response, retryRefreshResult);
    return response;
  } catch (error) {
    console.error("LangGraph proxy error:", error);

    const message =
      error instanceof Error ? error.message : "Unexpected proxy error.";

    return NextResponse.json(
      {
        error: "LangGraph proxy configuration error",
        message,
      },
      { status: 500 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
