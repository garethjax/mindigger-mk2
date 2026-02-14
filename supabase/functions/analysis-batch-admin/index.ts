import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient, requireAdmin } from "../_shared/supabase.ts";

const OPENAI_API = "https://api.openai.com/v1";

type ActionBody = {
  batch_id?: string;
  action?: "stop" | "restart" | "reprocess";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    await requireAdmin(req.headers.get("authorization"));

    const body = (await req.json().catch(() => ({}))) as ActionBody;
    if (!body.batch_id || !body.action) {
      return new Response(
        JSON.stringify({ error: "batch_id and action are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const db = createAdminClient();

    const { data: batch, error: batchErr } = await db
      .from("ai_batches")
      .select("id, external_batch_id, provider, status")
      .eq("id", body.batch_id)
      .single();

    if (batchErr || !batch) {
      return new Response(
        JSON.stringify({ error: "Batch not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (body.action === "stop") {
      if (batch.provider === "openai") {
        const apiKey = Deno.env.get("OPENAI_API_KEY");
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "Missing OPENAI_API_KEY" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        await fetch(`${OPENAI_API}/batches/${batch.external_batch_id}/cancel`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
        });
      }

      await db.from("ai_batches").update({ status: "cancelled" }).eq("id", batch.id);

      return new Response(
        JSON.stringify({ ok: true, action: "stop", batch_id: batch.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (body.action === "restart") {
      await db.from("ai_batches").update({ status: "in_progress" }).eq("id", batch.id);

      return new Response(
        JSON.stringify({ ok: true, action: "restart", batch_id: batch.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // reprocess: put back in progress, then run one-shot poll for this batch
    await db.from("ai_batches").update({ status: "in_progress" }).eq("id", batch.id);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const pollRes = await fetch(`${supabaseUrl}/functions/v1/analysis-poll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
      },
      body: JSON.stringify({ batch_id: batch.id }),
    });

    const pollData = await pollRes.json().catch(() => null);

    return new Response(
      JSON.stringify({
        ok: pollRes.ok,
        action: "reprocess",
        batch_id: batch.id,
        poll_result: pollData,
      }),
      {
        status: pollRes.ok ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = message.includes("Admin access") || message.includes("token") ? 403 : 500;
    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
