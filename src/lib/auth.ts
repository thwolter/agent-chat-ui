export const AUTH_TOKEN_COOKIE = "lg:auth:token";
export const AUTH_TOKEN_TYPE_COOKIE = "lg:auth:token_type";
export const AUTH_EXPIRES_AT_COOKIE = "lg:auth:expires_at";
export const AUTH_USER_ID_COOKIE = "lg:auth:user_id";
export const AUTH_USERNAME_COOKIE = "lg:auth:username";
export const AUTH_EMAIL_COOKIE = "lg:auth:email";
export const REMEMBERED_USERNAME_KEY = "lg:auth:remembered_username";
export const REMEMBERED_EMAIL_KEY = "lg:auth:remembered_email";
export const SELECTED_AGENT_ID_KEY = "lg:chat:selected_agent_id";

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
