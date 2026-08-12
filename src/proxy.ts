import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const demoMode = process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
  if (!url || !key) {
    if (demoMode) return NextResponse.next({ request });
    const pathname = request.nextUrl.pathname;
    const protectedRoute = ["/tasks", "/feed", "/activity", "/companions", "/settings", "/onboarding", "/u"]
      .some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    if (!protectedRoute) return NextResponse.next({ request });
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("error", "configuration");
    return NextResponse.redirect(loginUrl);
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const pathname = request.nextUrl.pathname;
  const protectedRoute = [
    "/tasks",
    "/feed",
    "/activity",
    "/companions",
    "/settings",
    "/onboarding",
    "/u",
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  if (protectedRoute && !signedIn) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
