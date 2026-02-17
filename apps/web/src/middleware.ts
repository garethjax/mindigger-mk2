import { defineMiddleware } from "astro:middleware";
import { createSupabaseServer } from "@/lib/supabase";

const PUBLIC_ROUTES = ["/auth/login", "/auth/forgot-password", "/auth/callback"];
const BYPASS_AUTH_MIDDLEWARE = import.meta.env.DEV && import.meta.env.PUBLIC_BYPASS_AUTH === "true";
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "script-src 'self' 'unsafe-inline' https://maps.googleapis.com https://maps.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "connect-src 'self' https://*.supabase.co https://maps.googleapis.com https://maps.gstatic.com http://127.0.0.1:54321 ws://127.0.0.1:54321 http://localhost:54321 ws://localhost:54321",
].join("; ");

function applySecurityHeaders(response: Response): Response {
  response.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (import.meta.env.PROD) {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  return response;
}

export const onRequest = defineMiddleware(async (context, next) => {
  if (BYPASS_AUTH_MIDDLEWARE) {
    return applySecurityHeaders(await next());
  }

  const { pathname } = context.url;

  // Skip auth check for public routes and static assets
  if (
    PUBLIC_ROUTES.some((route) => pathname.startsWith(route)) ||
    pathname.startsWith("/_") ||
    pathname.includes(".")
  ) {
    return applySecurityHeaders(await next());
  }

  const supabase = createSupabaseServer(context.cookies, context.request);

  // Refresh session (important: this also refreshes expired tokens)
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return applySecurityHeaders(context.redirect("/auth/login"));
  }

  // Fetch profile for role info
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, business_id, account_enabled, account_locked")
    .eq("id", user.id)
    .single();

  // Block disabled/locked accounts
  if (profile && (!profile.account_enabled || profile.account_locked)) {
    await supabase.auth.signOut();
    return applySecurityHeaders(context.redirect("/auth/login?error=account_disabled"));
  }

  // Force password update for accounts created/reset with temporary passphrase
  const mustChangePassword = user.user_metadata?.must_change_password === true;
  if (mustChangePassword && !pathname.startsWith("/settings")) {
    return applySecurityHeaders(context.redirect("/settings?reset=true"));
  }

  // Admin routes: require admin role
  if (pathname.startsWith("/regia") && profile?.role !== "admin") {
    return applySecurityHeaders(context.redirect("/analytics"));
  }

  // Make user data available to all pages
  context.locals.user = user;
  context.locals.profile = profile;

  return applySecurityHeaders(await next());
});
