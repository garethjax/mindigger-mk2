import { corsHeaders } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/supabase.ts";

/**
 * Brave Search proxy — admin-only Edge Function.
 * Forwards search queries to Brave Search API, filters results by regex pattern.
 * Keeps API key server-side (BRAVE_API_KEY env var).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    await requireAdmin(req.headers.get("Authorization"));

    const { query, filter_regex } = await req.json();
    if (!query) {
      return Response.json(
        { error: "Query is required" },
        { status: 400, headers: corsHeaders },
      );
    }

    const braveApiKey = Deno.env.get("BRAVE_API_KEY");
    if (!braveApiKey) {
      return Response.json(
        { error: "BRAVE_API_KEY not configured" },
        { status: 500, headers: corsHeaders },
      );
    }

    const params = new URLSearchParams({
      q: query,
      country: "IT",
      search_lang: "it",
      safesearch: "off",
    });

    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
      {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": braveApiKey,
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return Response.json(
        { error: `Brave API error: ${response.status} ${errorText}`.trim() },
        { status: response.status, headers: corsHeaders },
      );
    }

    const data = await response.json();
    const rawResults =
      data?.web?.results ?? [];

    // Filter by regex if provided
    let results = rawResults.map((r: { title: string; url: string }) => ({
      title: r.title ?? "",
      url: sanitizeUrl(r.url ?? ""),
    }));

    if (filter_regex) {
      try {
        const regex = new RegExp(filter_regex, "i");
        results = results.filter((r: { url: string }) => regex.test(r.url));
      } catch {
        // Invalid regex, return unfiltered
      }
    }

    return Response.json(
      { results: results.slice(0, 10) },
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

/** Remove query params and hash from URL for clean display */
function sanitizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return rawUrl;
  }
}
