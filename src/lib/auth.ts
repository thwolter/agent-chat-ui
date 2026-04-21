export const AUTH_TOKEN_COOKIE = "lg:auth:token";
export const AUTH_TOKEN_TYPE_COOKIE = "lg:auth:token_type";
export const AUTH_BACKEND_URL_COOKIE = "lg:auth:backend_url";
export const AUTH_EXPIRES_AT_COOKIE = "lg:auth:expires_at";
export const AUTH_USER_ID_COOKIE = "lg:auth:user_id";
export const AUTH_USERNAME_COOKIE = "lg:auth:username";
export const AUTH_EMAIL_COOKIE = "lg:auth:email";
export const REMEMBERED_BACKEND_URL_KEY = "lg:auth:remembered_backend_url";
export const REMEMBERED_USERNAME_KEY = "lg:auth:remembered_username";
export const REMEMBERED_EMAIL_KEY = "lg:auth:remembered_email";

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
