import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_BACKEND_URL_COOKIE,
  AUTH_EMAIL_COOKIE,
  AUTH_EXPIRES_AT_COOKIE,
  AUTH_TOKEN_COOKIE,
  AUTH_TOKEN_TYPE_COOKIE,
  AUTH_USER_ID_COOKIE,
  AUTH_USERNAME_COOKIE,
  withDirectPrefix,
} from "@/lib/auth";

export async function GET(req: NextRequest) {
  const backendUrl = req.cookies.get(AUTH_BACKEND_URL_COOKIE)?.value;
  const token = req.cookies.get(AUTH_TOKEN_COOKIE)?.value;
  const tokenType = req.cookies.get(AUTH_TOKEN_TYPE_COOKIE)?.value || "bearer";
  const expiresAt = req.cookies.get(AUTH_EXPIRES_AT_COOKIE)?.value;

  if (!backendUrl || !token) {
    return NextResponse.json({
      authenticated: false,
      backendUrl: backendUrl ?? null,
      expiresAt: expiresAt ? Number(expiresAt) : null,
    });
  }

  try {
    const meResponse = await fetch(withDirectPrefix(backendUrl, "/auth/me"), {
      headers: {
        authorization: `${tokenType} ${token}`,
      },
      cache: "no-store",
    });

    if (!meResponse.ok) {
      const response = NextResponse.json({
        authenticated: false,
        backendUrl,
        expiresAt: expiresAt ? Number(expiresAt) : null,
      });
      response.cookies.delete(AUTH_TOKEN_COOKIE);
      response.cookies.delete(AUTH_TOKEN_TYPE_COOKIE);
      response.cookies.delete(AUTH_EXPIRES_AT_COOKIE);
      response.cookies.delete(AUTH_USER_ID_COOKIE);
      response.cookies.delete(AUTH_USERNAME_COOKIE);
      response.cookies.delete(AUTH_EMAIL_COOKIE);
      return response;
    }

    const me = (await meResponse.json()) as {
      user_id: number;
      email?: string;
      username: string;
      is_admin: boolean;
      panels: string[];
    };

    return NextResponse.json({
      authenticated: true,
      backendUrl,
      expiresAt: expiresAt ? Number(expiresAt) : null,
      user: me,
    });
  } catch {
    return NextResponse.json({
      authenticated: false,
      backendUrl,
      expiresAt: expiresAt ? Number(expiresAt) : null,
    });
  }
}
