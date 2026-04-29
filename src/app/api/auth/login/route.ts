import { NextRequest, NextResponse } from "next/server";
import {
  appendGatewayRefreshCookies,
  applyAccessTokenCookies,
  buildAuthCookieOptions,
  AUTH_EMAIL_COOKIE,
  AUTH_USER_ID_COOKIE,
  AUTH_USERNAME_COOKIE,
  getAuthBackendUrl,
  type TokenResponse,
  withDirectPrefix,
} from "@/lib/auth";

type LoginBody = {
  email?: string;
  username?: string;
  password?: string;
};

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
        credentials: "include",
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

    const payload = (await loginResponse.json()) as TokenResponse;

    if (!payload.access_token || !payload.expires_in) {
      return NextResponse.json(
        { error: "Gateway returned an invalid token response." },
        { status: 502 },
      );
    }

    const tokenType = (payload.token_type || "bearer").toLowerCase();

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

    applyAccessTokenCookies(response, payload);
    if (userIdForCookie) {
      response.cookies.set(
        AUTH_USER_ID_COOKIE,
        userIdForCookie,
        buildAuthCookieOptions(payload.expires_in),
      );
    }
    response.cookies.set(
      AUTH_EMAIL_COOKIE,
      emailForCookie,
      buildAuthCookieOptions(payload.expires_in),
    );
    if (usernameForCookie) {
      response.cookies.set(
        AUTH_USERNAME_COOKIE,
        usernameForCookie,
        buildAuthCookieOptions(payload.expires_in),
      );
    }
    appendGatewayRefreshCookies(response.headers, loginResponse.headers);

    return response;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected authentication error.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
