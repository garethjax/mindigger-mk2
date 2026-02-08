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

/**
 * Verify that the calling user is an admin.
 * Returns the user object or throws.
 */
export async function requireAdmin(
  authHeader: string | null,
): Promise<{ id: string }> {
  if (!authHeader) throw new Error("Missing authorization header");

  const client = createUserClient(authHeader);
  const {
    data: { user },
    error,
  } = await client.auth.getUser();

  if (error || !user) throw new Error("Invalid token");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") throw new Error("Admin access required");

  return { id: user.id };
}
