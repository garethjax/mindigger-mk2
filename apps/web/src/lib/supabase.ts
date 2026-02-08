import { createBrowserClient, createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { AstroCookies } from "astro";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

/**
 * Browser client — used in Preact islands (client-side).
 */
export function createSupabaseBrowser() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

/**
 * Server client — used in Astro pages and middleware (SSR).
 * Reads auth tokens from the request cookie header,
 * writes refreshed tokens via Astro's cookies API.
 */
export function createSupabaseServer(cookies: AstroCookies, request?: Request) {
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        // Parse cookies from the raw Cookie header
        const cookieHeader = request?.headers.get("cookie") ?? "";
        return parseCookieHeader(cookieHeader).map((c) => ({
          name: c.name,
          value: c.value ?? "",
        }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookies.set(name, value, {
            path: "/",
            httpOnly: true,
            secure: import.meta.env.PROD,
            sameSite: "lax",
            maxAge: 60 * 60 * 24 * 7, // 7 days
            ...options,
          });
        }
      },
    },
  });
}
