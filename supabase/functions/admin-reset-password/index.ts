import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient, requireAdmin } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    await requireAdmin(req.headers.get("Authorization"));
    const { user_id, password, email } = await req.json();

    if (!user_id) {
      return Response.json(
        { error: "user_id è obbligatorio" },
        { status: 400, headers: corsHeaders },
      );
    }

    if (!password && !email) {
      return Response.json(
        { error: "Almeno uno tra password ed email è obbligatorio" },
        { status: 400, headers: corsHeaders },
      );
    }

    if (password && String(password).length < 6) {
      return Response.json(
        { error: "La password deve avere almeno 6 caratteri" },
        { status: 400, headers: corsHeaders },
      );
    }

    const updates: Record<string, string> = {};
    if (password) updates.password = String(password);
    if (email) updates.email = String(email).trim().toLowerCase();

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(user_id, updates);

    if (error) {
      return Response.json(
        { error: error.message },
        { status: 400, headers: corsHeaders },
      );
    }

    return Response.json({ success: true }, { headers: corsHeaders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = message.includes("Admin access") ? 403 : 500;
    return Response.json({ error: message }, { status, headers: corsHeaders });
  }
});
