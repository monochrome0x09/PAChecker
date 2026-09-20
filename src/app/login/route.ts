import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_SESSION_COOKIE,
  ACCESS_SESSION_MAX_AGE_SECONDS,
  createAccessSession,
} from "@/lib/auth/session";

function page(hasError = false) {
  return new NextResponse(
    `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PAChecker 로그인</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f7fb;color:#172033;font-family:system-ui,sans-serif;padding:24px}.card{width:min(100%,400px);background:#fff;border:1px solid #dce3ee;border-radius:20px;padding:32px;box-shadow:0 18px 50px rgba(30,55,90,.1)}h1{margin:0 0 8px;font-size:28px}p{margin:0 0 24px;color:#5b677c}.error{padding:12px;border-radius:10px;background:#fff0f0;color:#a32626;margin-bottom:18px}label{display:block;font-weight:700;margin:14px 0 7px}input{width:100%;min-height:48px;border:1px solid #bdc8d8;border-radius:10px;padding:0 13px;font:inherit;font-size:16px}button{width:100%;min-height:48px;margin-top:22px;border:0;border-radius:10px;background:#175cd3;color:white;font:inherit;font-weight:800;cursor:pointer}button:hover{background:#124cad}
  </style>
</head>
<body><main class="card"><h1>PAChecker</h1><p>개인 수행평가 관리 서비스</p>${
      hasError ? '<div class="error" role="alert">아이디 또는 비밀번호를 확인해 주세요.</div>' : ""
    }<form method="post" action="/login"><label for="username">아이디</label><input id="username" name="username" autocomplete="username" required autofocus><label for="password">비밀번호</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">로그인</button></form></main></body></html>`,
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export function GET(request: NextRequest) {
  return page(request.nextUrl.searchParams.get("error") === "1");
}

export async function POST(request: NextRequest) {
  const expectedUsername = process.env.PACHECKER_ACCESS_USER;
  const expectedPassword = process.env.PACHECKER_ACCESS_PASSWORD;
  if (!expectedUsername || !expectedPassword) {
    return new NextResponse("PAChecker access credentials are not configured", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }

  const form = await request.formData();
  const username = form.get("username");
  const password = form.get("password");
  if (username !== expectedUsername || password !== expectedPassword) {
    return NextResponse.redirect(new URL("/login?error=1", request.url), 303);
  }

  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(
    ACCESS_SESSION_COOKIE,
    await createAccessSession(expectedUsername, expectedPassword),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: ACCESS_SESSION_MAX_AGE_SECONDS,
    },
  );
  response.headers.set("cache-control", "no-store");
  return response;
}
