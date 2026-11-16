import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/register", "/api/health"];

/**
 * Optimistic check only: no cookie means straight to the login page. The
 * real session lookup happens in the (erp) layout via requireOrg().
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  const hasSession = request.cookies.has("kw_session");
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|ico)$).*)"],
};
