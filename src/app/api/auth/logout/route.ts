import { NextResponse } from "next/server";
import {
  AUTH_EMAIL_COOKIE,
  AUTH_EXPIRES_AT_COOKIE,
  AUTH_TOKEN_COOKIE,
  AUTH_TOKEN_TYPE_COOKIE,
  AUTH_USER_ID_COOKIE,
  AUTH_USERNAME_COOKIE,
} from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(AUTH_TOKEN_COOKIE);
  response.cookies.delete(AUTH_TOKEN_TYPE_COOKIE);
  response.cookies.delete(AUTH_EXPIRES_AT_COOKIE);
  response.cookies.delete(AUTH_USER_ID_COOKIE);
  response.cookies.delete(AUTH_USERNAME_COOKIE);
  response.cookies.delete(AUTH_EMAIL_COOKIE);
  return response;
}
