import { NextRequest, NextResponse } from "next/server";
import { ACCESS_SESSION_COOKIE, verifyAccessSession } from "@/lib/auth/session";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="PAChecker", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

function hasValidBasicAuthorization(
  request: NextRequest,
  username: string,
  password: string,
) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) return false;

  try {
    const decoded = atob(authorization.slice(6));
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) return false;
    return (
      decoded.slice(0, separatorIndex) === username &&
      decoded.slice(separatorIndex + 1) === password
    );
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/login") return NextResponse.next();

  const username = process.env.PACHECKER_ACCESS_USER;
  const password = process.env.PACHECKER_ACCESS_PASSWORD;

  if (!username || !password) {
    if (process.env.VERCEL === "1") {
      return new NextResponse("PAChecker access credentials are not configured", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }

    return NextResponse.next();
  }

  if (
    hasValidBasicAuthorization(request, username, password) ||
    (await verifyAccessSession(
      request.cookies.get(ACCESS_SESSION_COOKIE)?.value,
      username,
      password,
    ))
  ) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) return unauthorized();
  return NextResponse.redirect(new URL("/login", request.url), 303);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icons/|favicon.ico|sw.js).*)"],
};
