import { type NextRequest, NextResponse } from "next/server";
import {
  AUTH_BACKEND_URL_COOKIE,
  AUTH_TOKEN_COOKIE,
  AUTH_TOKEN_TYPE_COOKIE,
  AUTH_USER_ID_COOKIE,
  AUTH_USERNAME_COOKIE,
  withDirectPrefix,
} from "@/lib/auth";

export const runtime = "edge";

const LANGGRAPH_API_URL = process.env.LANGGRAPH_API_URL;
const LANGGRAPH_BEARER_TOKEN =
  process.env.LANGGRAPH_BEARER_TOKEN ?? process.env.LANGSMITH_API_KEY;

function resolveBaseUrl(req: NextRequest): string {
  const cookieBase = req.cookies.get(AUTH_BACKEND_URL_COOKIE)?.value;
  if (cookieBase) return cookieBase.replace(/\/$/, "");
  if (LANGGRAPH_API_URL) return LANGGRAPH_API_URL.replace(/\/$/, "");
  throw new Error("No backend URL configured. Please sign in first.");
}

function buildTargetUrl(
  req: NextRequest,
  pathSegments: string[] | undefined,
  requestUrl: URL,
): URL {
  const base = resolveBaseUrl(req);
  const path = (pathSegments ?? []).join("/");
  const target = new URL(withDirectPrefix(base, path));
  target.search = requestUrl.search;
  return target;
}

function buildProxyHeaders(req: NextRequest, isAuthRoute: boolean): Headers {
  const headers = new Headers(req.headers);

  headers.delete("host");
  headers.delete("content-length");
  headers.delete("connection");
  headers.delete("cookie");

  if (isAuthRoute) {
    return headers;
  }

  const cookieToken = req.cookies.get(AUTH_TOKEN_COOKIE)?.value;
  const cookieTokenType = req.cookies.get(AUTH_TOKEN_TYPE_COOKIE)?.value || "bearer";
  const cookieUserId = req.cookies.get(AUTH_USER_ID_COOKIE)?.value;
  const cookieUsername = req.cookies.get(AUTH_USERNAME_COOKIE)?.value;

  if (cookieToken) {
    headers.set("authorization", `${cookieTokenType} ${cookieToken}`);
    if (cookieUserId) headers.set("x-auth-user-id", cookieUserId);
    if (cookieUsername) headers.set("x-auth-username", cookieUsername);
    return headers;
  }

  if (!LANGGRAPH_BEARER_TOKEN) {
    throw new Error("No authentication token configured. Please sign in first.");
  }

  headers.set("authorization", `Bearer ${LANGGRAPH_BEARER_TOKEN}`);

  return headers;
}

async function proxy(
  req: NextRequest,
  { params }: { params: Promise<{ _path?: string[] }> },
): Promise<Response> {
  try {
    const resolvedParams = await params;
    const path = (resolvedParams._path ?? []).join("/");
    const isAuthRoute = path.startsWith("auth/");
    const targetUrl = buildTargetUrl(req, resolvedParams._path, req.nextUrl);

    const method = req.method.toUpperCase();
    const init: RequestInit = {
      method,
      headers: buildProxyHeaders(req, isAuthRoute),
    };

    if (method !== "GET" && method !== "HEAD") {
      const bodyBuffer = await req.arrayBuffer();
      if (bodyBuffer.byteLength > 0) {
        init.body = bodyBuffer;
      }
    }

    const upstreamResponse = await fetch(targetUrl, init);
    const headers = new Headers(upstreamResponse.headers);
    headers.delete("set-cookie");

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
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
