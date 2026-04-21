export const AUTH_TOKEN_COOKIE = "lg:auth:token";
export const AUTH_TOKEN_TYPE_COOKIE = "lg:auth:token_type";
export const AUTH_EXPIRES_AT_COOKIE = "lg:auth:expires_at";
export const AUTH_USER_ID_COOKIE = "lg:auth:user_id";
export const AUTH_USERNAME_COOKIE = "lg:auth:username";
export const AUTH_EMAIL_COOKIE = "lg:auth:email";
export const REMEMBERED_USERNAME_KEY = "lg:auth:remembered_username";
export const REMEMBERED_EMAIL_KEY = "lg:auth:remembered_email";
export const SELECTED_AGENT_ID_KEY = "lg:chat:selected_agent_id";

const FRONTEND_REFRESH_COOKIE_PATH = "/api";

type AuthCookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
  maxAge?: number;
};

export type TokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in: number;
};

export type SessionAgent = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  url: string;
  assistant_id: string | null;
  graph_id: string | null;
};

export type SessionUser = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  is_admin: boolean;
};

export type AuthSession = {
  authenticated: boolean;
  expiresAt?: number | null;
  user?: SessionUser;
  agents: SessionAgent[];
};

export function getAuthBackendUrl(): string {
  const backendUrl =
    process.env.AUTH_BACKEND_URL ||
    process.env.NEXT_PUBLIC_AUTH_BACKEND_URL ||
    "http://localhost:8000";

  return normalizeBackendUrl(backendUrl);
}

export function getAgentAssistantId(agent: SessionAgent): string {
  return agent.assistant_id || agent.graph_id || agent.key || agent.name;
}

export function normalizeBackendUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("Backend URL is required.");
  }

  const url = new URL(trimmed);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Backend URL must start with http:// or https://.");
  }

  const gatewayMatch = url.pathname.match(/^(.*)\/gateway(?:\/.*)?$/);
  if (gatewayMatch) {
    url.pathname = gatewayMatch[1] || "/";
  } else if (url.pathname === "/docs") {
    url.pathname = "/";
  }

  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/$/, "");
}

export function withGatewayPrefix(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}/gateway${normalizedPath}`;
}

export function withDirectPrefix(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

export function buildAuthCookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    ...(maxAge ? { maxAge } : {}),
  };
}

export function applyAccessTokenCookies(
  response: {
    cookies: {
      set: (name: string, value: string, options?: AuthCookieOptions) => void;
    };
  },
  payload: TokenResponse,
): { tokenType: string; expiresAt: number } {
  const tokenType = (payload.token_type || "bearer").toLowerCase();
  const expiresAt = Date.now() + payload.expires_in * 1000;

  response.cookies.set(
    AUTH_TOKEN_COOKIE,
    payload.access_token,
    buildAuthCookieOptions(payload.expires_in),
  );
  response.cookies.set(
    AUTH_TOKEN_TYPE_COOKIE,
    tokenType,
    buildAuthCookieOptions(payload.expires_in),
  );
  response.cookies.set(AUTH_EXPIRES_AT_COOKIE, String(expiresAt), {
    ...buildAuthCookieOptions(payload.expires_in),
    httpOnly: false,
  });

  return { tokenType, expiresAt };
}

export function clearAuthCookies(response: {
  cookies: { delete: (name: string) => void };
}) {
  response.cookies.delete(AUTH_TOKEN_COOKIE);
  response.cookies.delete(AUTH_TOKEN_TYPE_COOKIE);
  response.cookies.delete(AUTH_EXPIRES_AT_COOKIE);
  response.cookies.delete(AUTH_USER_ID_COOKIE);
  response.cookies.delete(AUTH_USERNAME_COOKIE);
  response.cookies.delete(AUTH_EMAIL_COOKIE);
}

function splitSetCookieHeader(header: string): string[] {
  const cookies: string[] = [];
  let start = 0;
  let inExpires = false;

  for (let index = 0; index < header.length; index += 1) {
    const char = header[index];
    const rest = header.slice(index, index + 8).toLowerCase();

    if (rest === "expires=") {
      inExpires = true;
      index += 7;
      continue;
    }

    if (inExpires && char === ";") {
      inExpires = false;
      continue;
    }

    if (!inExpires && char === ",") {
      const next = header.slice(index + 1);
      if (/^\s*[^=;,]+=/u.test(next)) {
        cookies.push(header.slice(start, index).trim());
        start = index + 1;
      }
    }
  }

  const last = header.slice(start).trim();
  if (last) cookies.push(last);
  return cookies;
}

export function getSetCookieHeaders(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = withGetSetCookie.getSetCookie?.();
  if (setCookies?.length) return setCookies;

  const header = headers.get("set-cookie");
  return header ? splitSetCookieHeader(header) : [];
}

export function appendGatewayRefreshCookies(
  targetHeaders: Headers,
  sourceHeaders: Headers,
) {
  for (const cookie of getSetCookieHeaders(sourceHeaders)) {
    const parts = cookie
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) continue;

    const rewritten = [parts[0]];
    let hasPath = false;

    for (const attribute of parts.slice(1)) {
      const [rawName] = attribute.split("=", 1);
      const name = rawName.toLowerCase();

      if (name === "domain") continue;
      if (name === "path") {
        rewritten.push(`Path=${FRONTEND_REFRESH_COOKIE_PATH}`);
        hasPath = true;
        continue;
      }

      rewritten.push(attribute);
    }

    if (!hasPath) rewritten.push(`Path=${FRONTEND_REFRESH_COOKIE_PATH}`);
    targetHeaders.append("set-cookie", rewritten.join("; "));
  }
}
