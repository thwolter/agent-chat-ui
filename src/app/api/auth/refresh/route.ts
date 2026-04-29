import { type NextRequest, NextResponse } from "next/server";
import {
  applyRefreshResult,
  clearAuthStateResponse,
  RefreshAccessTokenError,
  refreshAccessToken,
} from "@/lib/auth-server";

export async function POST(req: NextRequest) {
  try {
    const refreshResult = await refreshAccessToken(req);
    const response = NextResponse.json({
      ok: true,
      expiresIn: refreshResult.payload.expires_in,
    });
    applyRefreshResult(response, refreshResult);
    return response;
  } catch (error) {
    return clearAuthStateResponse(
      { error: "Authentication refresh failed." },
      401,
      error instanceof RefreshAccessTokenError ? error.headers : undefined,
    );
  }
}
