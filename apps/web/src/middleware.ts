import { defineMiddleware } from "astro:middleware";
import { createSupabaseServer } from "@/lib/supabase";

const PUBLIC_ROUTES = ["/auth/login", "/auth/forgot-password", "/auth/callback"];
const BYPASS_AUTH_MIDDLEWARE = import.meta.env.DEV && import.meta.env.PUBLIC_BYPASS_AUTH === "true";

export const onRequest = defineMiddleware(async (context, next) => {
  if (BYPASS_AUTH_MIDDLEWARE) {
    return next();
  }

  const { pathname } = context.url;

  // Skip auth check for public routes and static assets
  if (
    PUBLIC_ROUTES.some((route) => pathname.startsWith(route)) ||
    pathname.startsWith("/_") ||
    pathname.includes(".")
  ) {
    return next();
  }

  const supabase = createSupabaseServer(context.cookies, context.request);

  // Refresh session (important: this also refreshes expired tokens)
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return context.redirect("/auth/login");
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
    return context.redirect("/auth/login?error=account_disabled");
  }

  // Admin routes: require admin role
  if (pathname.startsWith("/regia") && profile?.role !== "admin") {
    return context.redirect("/analytics");
  }

  // Make user data available to all pages
  context.locals.user = user;
  context.locals.profile = profile;

  return next();
});
