import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_BACKEND_URL_COOKIE,
  AUTH_EXPIRES_AT_COOKIE,
  AUTH_TOKEN_COOKIE,
  AUTH_TOKEN_TYPE_COOKIE,
  AUTH_USER_ID_COOKIE,
  AUTH_USERNAME_COOKIE,
  normalizeBackendUrl,
  withDirectPrefix,
} from "@/lib/auth";

type LoginBody = {
  backendUrl?: string;
  username?: string;
  password?: string;
};

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function buildCookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    ...(maxAge ? { maxAge } : {}),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as LoginBody;
    const backendUrl = normalizeBackendUrl(body.backendUrl ?? "");
    const username = (body.username ?? "").trim();
    const password = body.password ?? "";

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required." },
        { status: 400 },
      );
    }

    const loginResponse = await fetch(withDirectPrefix(backendUrl, "/auth/login"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!loginResponse.ok) {
      let detail = "Authentication failed.";
      try {
        const payload = (await loginResponse.json()) as { detail?: string };
        if (payload.detail) detail = payload.detail;
      } catch {
        // no-op
      }
      return NextResponse.json({ error: detail }, { status: loginResponse.status });
    }

    const payload = (await loginResponse.json()) as {
      access_token: string;
      token_type?: string;
      expires_in: number;
    };

    if (!payload.access_token || !payload.expires_in) {
      return NextResponse.json(
        { error: "Gateway returned an invalid token response." },
        { status: 502 },
      );
    }

    const tokenType = (payload.token_type || "bearer").toLowerCase();
    const expiresAt = Date.now() + payload.expires_in * 1000;

    let usernameForCookie = username;
    let userIdForCookie: string | undefined;
    try {
      const meResponse = await fetch(withDirectPrefix(backendUrl, "/auth/me"), {
        headers: {
          authorization: `${tokenType} ${payload.access_token}`,
        },
      });

      if (meResponse.ok) {
        const me = (await meResponse.json()) as {
          user_id?: number;
          username?: string;
        };
        if (typeof me.user_id === "number") {
          userIdForCookie = String(me.user_id);
        }
        if (typeof me.username === "string" && me.username.trim()) {
          usernameForCookie = me.username;
        }
      }
    } catch {
      // no-op
    }

    const response = NextResponse.json({
      ok: true,
      expiresIn: payload.expires_in,
      backendUrl,
    });

    response.cookies.set(
      AUTH_TOKEN_COOKIE,
      payload.access_token,
      buildCookieOptions(payload.expires_in),
    );
    response.cookies.set(
      AUTH_TOKEN_TYPE_COOKIE,
      tokenType,
      buildCookieOptions(payload.expires_in),
    );
    response.cookies.set(AUTH_EXPIRES_AT_COOKIE, String(expiresAt), {
      ...buildCookieOptions(payload.expires_in),
      httpOnly: false,
    });
    response.cookies.set(
      AUTH_BACKEND_URL_COOKIE,
      backendUrl,
      buildCookieOptions(ONE_YEAR_SECONDS),
    );
    if (userIdForCookie) {
      response.cookies.set(
        AUTH_USER_ID_COOKIE,
        userIdForCookie,
        buildCookieOptions(payload.expires_in),
      );
    }
    response.cookies.set(
      AUTH_USERNAME_COOKIE,
      usernameForCookie,
      buildCookieOptions(payload.expires_in),
    );

    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected authentication error.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
