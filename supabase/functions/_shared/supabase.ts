import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Admin client — bypasses RLS via service_role key.
 * Used by all Edge Functions for DB operations.
 */
export function createAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/**
 * User client — uses the request's JWT to respect RLS.
 * Used for user-facing operations where we need auth context.
 */
export function createUserClient(authHeader: string): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authHeader } },
    },
  );
}

type AuthenticatedUser = { id: string };

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const value = authHeader.trim();
  if (!value.toLowerCase().startsWith("bearer ")) return null;
  const token = value.slice(7).trim();
  return token || null;
}

/**
 * Internal invocations are allowed when using:
 * - SUPABASE_SERVICE_ROLE_KEY as Bearer token (used by pg_cron)
 * - INTERNAL_FUNCTION_SECRET via x-internal-secret header (optional hardening)
 */
export function isInternalRequest(
  authHeader: string | null,
  internalSecretHeader: string | null = null,
): boolean {
  const bearerToken = extractBearerToken(authHeader);
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (bearerToken && serviceRoleKey && bearerToken === serviceRoleKey) {
    return true;
  }

  const internalSecret = Deno.env.get("INTERNAL_FUNCTION_SECRET");
  return Boolean(internalSecret && internalSecretHeader && internalSecretHeader === internalSecret);
}

/**
 * Verify that the caller is authenticated with a valid user JWT.
 */
export async function requireAuthenticated(
  authHeader: string | null,
): Promise<AuthenticatedUser> {
  if (!authHeader) throw new Error("Missing authorization header");

  const client = createUserClient(authHeader);
  const {
    data: { user },
    error,
  } = await client.auth.getUser();

  if (error || !user) throw new Error("Invalid token");

  return { id: user.id };
}

/**
 * Verify that the calling user is an admin.
 * Returns the user object or throws.
 */
export async function requireAdmin(
  authHeader: string | null,
): Promise<AuthenticatedUser> {
  const user = await requireAuthenticated(authHeader);

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") throw new Error("Admin access required");

  return { id: user.id };
}

/**
 * Allow invocations from internal schedulers OR authenticated admins.
 */
export async function requireInternalOrAdmin(
  authHeader: string | null,
  internalSecretHeader: string | null = null,
): Promise<{ id: string; via: "internal" | "admin" }> {
  if (isInternalRequest(authHeader, internalSecretHeader)) {
    return { id: "internal", via: "internal" };
  }

  const admin = await requireAdmin(authHeader);
  return { id: admin.id, via: "admin" };
}
