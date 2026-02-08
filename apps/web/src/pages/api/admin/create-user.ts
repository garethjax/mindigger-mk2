import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase";

export const POST: APIRoute = async ({ request, cookies }) => {
  // Verify caller is admin via session
  const supabase = createSupabaseServer(cookies, request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Non autenticato" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return Response.json({ error: "Accesso admin richiesto" }, { status: 403 });
  }

  // Parse request body
  const { email, password, full_name, role, business_id } = await request.json();

  if (!email || !password) {
    return Response.json({ error: "Email e password sono obbligatori" }, { status: 400 });
  }

  // Use service_role client for admin operations
  const admin = createClient(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // Create auth user
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: full_name || "" },
  });

  if (authError || !authData.user) {
    return Response.json(
      { error: authError?.message ?? "Errore creazione utente" },
      { status: 400 },
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

  // Assign to business if provided
  if (business_id) {
    await admin.from("profiles").update({ business_id }).eq("id", userId);
  }

  return Response.json({ user_id: userId });
};
