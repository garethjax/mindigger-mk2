import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient, requireAdmin } from "../_shared/supabase.ts";

const MIN_PASSPHRASE_LENGTH = 10;

function randomInt(max: number): number {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] % max;
}

function generatePassphrase(): string {
  const adjectives = ["calmo", "rapido", "forte", "chiaro", "saldo", "fresco", "agile", "sereno"];
  const nouns = ["sole", "luna", "vento", "mare", "fiore", "ponte", "cielo", "bosco"];
  const parts = [
    adjectives[randomInt(adjectives.length)],
    nouns[randomInt(nouns.length)],
    adjectives[randomInt(adjectives.length)],
    nouns[randomInt(nouns.length)],
  ];
  const suffix = String(randomInt(1000)).padStart(3, "0");
  return `${parts.join("-")}-${suffix}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    await requireAdmin(req.headers.get("Authorization"));
    const {
      email: rawEmail,
      password: rawPassphrase,
      full_name,
      role,
      business_id,
      send_recovery_email,
    } = await req.json();

    const email = String(rawEmail ?? "").trim().toLowerCase();
    let passphrase = String(rawPassphrase ?? "").trim();
    let generated = false;

    if (!passphrase) {
      passphrase = generatePassphrase();
      generated = true;
    }

    if (!email || !email.includes("@")) {
      return Response.json(
        { error: "Email non valida" },
        { status: 400, headers: corsHeaders },
      );
    }

    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      return Response.json(
        { error: `La passphrase deve avere almeno ${MIN_PASSPHRASE_LENGTH} caratteri` },
        { status: 400, headers: corsHeaders },
      );
    }

    const admin = createAdminClient();

    // Create auth user via admin API
    const { data: authData, error: authError } =
      await admin.auth.admin.createUser({
        email,
        password: passphrase,
        email_confirm: true,
        user_metadata: { full_name: full_name || "", must_change_password: true },
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

    // Assign user to business if provided
    if (business_id) {
      await admin
        .from("profiles")
        .update({ business_id })
        .eq("id", userId);
    }

    let recoveryEmailSent = false;
    let warning: string | null = null;
    if (send_recovery_email !== false) {
      const origin = req.headers.get("origin") ?? new URL(req.url).origin;
      const redirectTo = `${origin}/auth/callback`;
      const { error: recoveryErr } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
      if (recoveryErr) {
        warning = "Utente creato ma invio email di recupero non riuscito";
      } else {
        recoveryEmailSent = true;
      }
    }

    return Response.json(
      {
        user_id: userId,
        recovery_email_sent: recoveryEmailSent,
        generated_passphrase: generated ? passphrase : null,
        must_change_password: true,
        warning,
      },
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
