import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_EMAIL_COOKIE,
  AUTH_EXPIRES_AT_COOKIE,
  AUTH_TOKEN_COOKIE,
  AUTH_TOKEN_TYPE_COOKIE,
  AUTH_USER_ID_COOKIE,
  AUTH_USERNAME_COOKIE,
  getAuthBackendUrl,
  withDirectPrefix,
} from "@/lib/auth";

type LoginBody = {
  email?: string;
  username?: string;
  password?: string;
};

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
    const backendUrl = getAuthBackendUrl();
    const email = (body.email ?? body.username ?? "").trim();
    const password = body.password ?? "";

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 },
      );
    }

    const loginResponse = await fetch(
      withDirectPrefix(backendUrl, "/auth/login"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      },
    );

    if (!loginResponse.ok) {
      let detail = "Authentication failed.";
      try {
        const payload = (await loginResponse.json()) as { detail?: string };
        if (payload.detail) detail = payload.detail;
      } catch {
        // no-op
      }
      return NextResponse.json(
        { error: detail },
        { status: loginResponse.status },
      );
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

    let emailForCookie = email;
    let usernameForCookie = "";
    let userIdForCookie: string | undefined;
    try {
      const meResponse = await fetch(withDirectPrefix(backendUrl, "/auth/me"), {
        headers: {
          authorization: `${tokenType} ${payload.access_token}`,
        },
      });

      if (meResponse.ok) {
        const me = (await meResponse.json()) as {
          user_id?: string;
          email?: string;
          first_name?: string | null;
          last_name?: string | null;
        };
        if (typeof me.user_id === "string" && me.user_id.trim()) {
          userIdForCookie = me.user_id;
        }
        if (typeof me.email === "string" && me.email.trim()) {
          emailForCookie = me.email;
        }
        const fullName = [me.first_name, me.last_name]
          .filter((part): part is string => Boolean(part?.trim()))
          .join(" ");
        if (fullName) {
          usernameForCookie = fullName;
        }
      }
    } catch {
      // no-op
    }

    const response = NextResponse.json({
      ok: true,
      expiresIn: payload.expires_in,
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
    if (userIdForCookie) {
      response.cookies.set(
        AUTH_USER_ID_COOKIE,
        userIdForCookie,
        buildCookieOptions(payload.expires_in),
      );
    }
    response.cookies.set(
      AUTH_EMAIL_COOKIE,
      emailForCookie,
      buildCookieOptions(payload.expires_in),
    );
    if (usernameForCookie) {
      response.cookies.set(
        AUTH_USERNAME_COOKIE,
        usernameForCookie,
        buildCookieOptions(payload.expires_in),
      );
    }

    return response;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected authentication error.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
