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

export async function GET(req: NextRequest) {
  const backendUrl = getAuthBackendUrl();
  const token = req.cookies.get(AUTH_TOKEN_COOKIE)?.value;
  const tokenType = req.cookies.get(AUTH_TOKEN_TYPE_COOKIE)?.value || "bearer";
  const expiresAt = req.cookies.get(AUTH_EXPIRES_AT_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({
      authenticated: false,
      expiresAt: expiresAt ? Number(expiresAt) : null,
      agents: [],
    });
  }

  try {
    const sessionResponse = await fetch(
      withDirectPrefix(backendUrl, "/auth/session"),
      {
        headers: {
          authorization: `${tokenType} ${token}`,
        },
        cache: "no-store",
      },
    );

    if (!sessionResponse.ok) {
      const response = NextResponse.json({
        authenticated: false,
        expiresAt: expiresAt ? Number(expiresAt) : null,
        agents: [],
      });
      response.cookies.delete(AUTH_TOKEN_COOKIE);
      response.cookies.delete(AUTH_TOKEN_TYPE_COOKIE);
      response.cookies.delete(AUTH_EXPIRES_AT_COOKIE);
      response.cookies.delete(AUTH_USER_ID_COOKIE);
      response.cookies.delete(AUTH_USERNAME_COOKIE);
      response.cookies.delete(AUTH_EMAIL_COOKIE);
      return response;
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

    return NextResponse.json({
      authenticated: true,
      expiresAt: expiresAt ? Number(expiresAt) : null,
      user: session.user,
      agents: session.agents,
    });
  } catch {
    try {
      const meResponse = await fetch(withDirectPrefix(backendUrl, "/auth/me"), {
        headers: {
          authorization: `${tokenType} ${token}`,
        },
        cache: "no-store",
      });

      if (!meResponse.ok) {
        return NextResponse.json({
          authenticated: false,
          expiresAt: expiresAt ? Number(expiresAt) : null,
          agents: [],
        });
      }

      const me = (await meResponse.json()) as {
        user_id: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
        is_admin: boolean;
      };

      return NextResponse.json({
        authenticated: true,
        expiresAt: expiresAt ? Number(expiresAt) : null,
        user: {
          id: me.user_id,
          email: me.email,
          first_name: me.first_name,
          last_name: me.last_name,
          is_admin: me.is_admin,
        },
        agents: [],
      });
    } catch {
      return NextResponse.json({
        authenticated: false,
        expiresAt: expiresAt ? Number(expiresAt) : null,
        agents: [],
      });
    }
  }
}
