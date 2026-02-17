import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase";
import { generatePassphrase } from "@/lib/passphrase";

const MIN_PASSPHRASE_LENGTH = 10;

function getAuthRedirectBase(request: Request): string {
  const configured = (
    import.meta.env.PUBLIC_SITE_URL
    || import.meta.env.PUBLIC_APP_URL
    || ""
  ).trim();

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

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
  const {
    email: rawEmail,
    password: rawPassphrase,
    full_name,
    role,
    business_id,
    send_recovery_email,
  } = await request.json();

  const email = String(rawEmail ?? "").trim().toLowerCase();
  let passphrase = String(rawPassphrase ?? "").trim();
  let generated = false;

  if (!passphrase) {
    passphrase = generatePassphrase();
    generated = true;
  }

  if (!email || !email.includes("@")) {
    return Response.json({ error: "Email non valida" }, { status: 400 });
  }
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return Response.json(
      { error: `La passphrase deve avere almeno ${MIN_PASSPHRASE_LENGTH} caratteri` },
      { status: 400 },
    );
  }
  if (role && role !== "admin" && role !== "business") {
    return Response.json({ error: "Ruolo non valido" }, { status: 400 });
  }

  // Use service_role client for admin operations
  const admin = createClient(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // Create auth user
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password: passphrase,
    email_confirm: true,
    user_metadata: {
      full_name: full_name || "",
      must_change_password: true,
    },
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

  let recoveryEmailSent = false;
  let warning: string | null = null;

  if (send_recovery_email !== false) {
    const redirectTo = `${getAuthRedirectBase(request)}/auth/callback`;
    const { error: recoveryErr } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
    if (recoveryErr) {
      warning = "Utente creato ma invio email di recupero non riuscito";
    } else {
      recoveryEmailSent = true;
    }
  }

  return Response.json({
    user_id: userId,
    recovery_email_sent: recoveryEmailSent,
    generated_passphrase: generated ? passphrase : null,
    must_change_password: true,
    warning,
  });
};
