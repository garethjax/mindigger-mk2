import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient, requireAdmin } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    await requireAdmin(req.headers.get("Authorization"));
    const { email, password, full_name, role, business_id } = await req.json();

    if (!email || !password) {
      return Response.json(
        { error: "Email e password sono obbligatori" },
        { status: 400, headers: corsHeaders },
      );
    }

    const admin = createAdminClient();

    // Create auth user via admin API
    const { data: authData, error: authError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: full_name || "" },
      });

    if (authError || !authData.user) {
      return Response.json(
        { error: authError?.message ?? "Errore creazione utente" },
        { status: 400, headers: corsHeaders },
      );
    }

    const userId = authData.user.id;

    // Update profile (trigger already created the row)
    if (role || full_name) {
      await admin
        .from("profiles")
        .update({
          ...(role ? { role } : {}),
          ...(full_name ? { full_name } : {}),
        })
        .eq("id", userId);
    }

    // Assign business ownership if provided
    if (business_id) {
      await admin
        .from("businesses")
        .update({ user_id: userId })
        .eq("id", business_id);
    }

    return Response.json(
      { user_id: userId },
      { headers: corsHeaders },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = message.includes("Admin access") ? 403 : 500;
    return Response.json(
      { error: message },
      { status, headers: corsHeaders },
    );
  }
});
