/**
 * Recovery: re-import Botster job results into Supabase.
 *
 * Use when scraping-poll marked a config "completed" but runs were not yet
 * indexed by Botster (race condition) → 0 reviews ingested despite the bot
 * having a successful run with data.
 *
 * Usage:
 *   bun run scripts/recover-scraping.ts                    # list candidates
 *   bun run scripts/recover-scraping.ts <config_id>        # recover that config
 *   bun run scripts/recover-scraping.ts --all              # recover every candidate
 *
 * Env:
 *   SUPABASE_URL              (default: http://127.0.0.1:54321)
 *   SUPABASE_ANON_KEY         (default: local publishable key)
 *   ADMIN_EMAIL               (default: admin@mindigger.it)
 *   ADMIN_PASSWORD            (default: admin123)
 *   BOTSTER_API_KEY           (read from supabase/.env if missing)
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@mindigger.it";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";

let BOTSTER_API_KEY = process.env.BOTSTER_API_KEY ?? "";
if (!BOTSTER_API_KEY) {
  try {
    const envFile = readFileSync(resolve(import.meta.dir, "../supabase/.env"), "utf8");
    const m = envFile.match(/^BOTSTER_API_KEY\s*=\s*"?([^"\n]+)"?/m);
    if (m) BOTSTER_API_KEY = m[1];
  } catch { /* ignore */ }
}

const BOTSTER_BASE = "https://botster.io/api/v2";

async function getAdminToken(): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

type Candidate = {
  config_id: string;
  location_name: string;
  platform: string;
  bot_id: string | null;
  status: string;
  reviews_in_db: number;
  botster_state: string | null;
  botster_runs: number;
};

async function listCandidates(token: string): Promise<Candidate[]> {
  // Pull all configs + DB review counts via PostgREST
  const cfgRes = await fetch(
    `${SUPABASE_URL}/rest/v1/scraping_configs?select=id,bot_id,platform,status,locations(name)&bot_id=not.is.null`,
    { headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY } },
  );
  if (!cfgRes.ok) throw new Error(`List configs: ${cfgRes.status} ${await cfgRes.text()}`);
  const configs = await cfgRes.json() as Array<{
    id: string;
    bot_id: string | null;
    platform: string;
    status: string;
    locations: { name: string };
  }>;

  const candidates: Candidate[] = [];

  for (const c of configs) {
    if (!c.bot_id) continue;

    // Count reviews already in DB for this config's location
    const cntRes = await fetch(
      `${SUPABASE_URL}/rest/v1/reviews?select=id&source=eq.${c.platform}&location_id=eq.(select id from scraping_configs where id='${c.id}')`,
      { headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY, Prefer: "count=exact" } },
    );
    // Simpler: use a HEAD call counting via separate query on location_id
    // Fallback: fetch the config's location_id
    const locRes = await fetch(
      `${SUPABASE_URL}/rest/v1/scraping_configs?id=eq.${c.id}&select=location_id`,
      { headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY } },
    );
    const [{ location_id }] = await locRes.json();
    const cnt2 = await fetch(
      `${SUPABASE_URL}/rest/v1/reviews?select=id&location_id=eq.${location_id}&source=eq.${c.platform}`,
      { method: "HEAD", headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY, Prefer: "count=exact" } },
    );
    const reviewsInDb = parseInt(cnt2.headers.get("content-range")?.split("/")[1] ?? "0", 10);

    // Hit Botster
    let botsterState: string | null = null;
    let botsterRuns = 0;
    try {
      const jRes = await fetch(`${BOTSTER_BASE}/jobs/${c.bot_id}`, {
        headers: { Authorization: `Bearer ${BOTSTER_API_KEY}` },
      });
      if (jRes.ok) {
        const jd = await jRes.json();
        botsterState = jd.job?.state ?? null;
        botsterRuns = (jd.job?.runs ?? []).length;
      }
    } catch { /* ignore */ }

    // Candidate = local DB shows 0 reviews but Botster has a completed run
    if (reviewsInDb === 0 && botsterState === "completed" && botsterRuns > 0) {
      candidates.push({
        config_id: c.id,
        location_name: c.locations.name,
        platform: c.platform,
        bot_id: c.bot_id,
        status: c.status,
        reviews_in_db: reviewsInDb,
        botster_state: botsterState,
        botster_runs: botsterRuns,
      });
    }

    void cntRes;
  }

  return candidates;
}

async function recover(token: string, configId: string, jobId: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/scraping-import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ config_id: configId, job_id: jobId, trigger_analysis: true }),
  });
  const body = await res.json();
  return { ok: res.ok, body };
}

async function main() {
  if (!BOTSTER_API_KEY) {
    console.error("ERROR: BOTSTER_API_KEY not set and not found in supabase/.env");
    process.exit(1);
  }

  const arg = process.argv[2];
  const token = await getAdminToken();

  if (!arg) {
    console.log("Scanning for recovery candidates...\n");
    const candidates = await listCandidates(token);
    if (candidates.length === 0) {
      console.log("No candidates found. Everything looks ingested.");
      return;
    }
    console.log(`Found ${candidates.length} candidate(s):\n`);
    for (const c of candidates) {
      console.log(`  config_id  : ${c.config_id}`);
      console.log(`  location   : ${c.location_name}`);
      console.log(`  platform   : ${c.platform}`);
      console.log(`  bot_id     : ${c.bot_id}`);
      console.log(`  db_reviews : ${c.reviews_in_db}  |  botster_runs: ${c.botster_runs} (${c.botster_state})`);
      console.log("");
    }
    console.log("Recover one:    bun run scripts/recover-scraping.ts <config_id>");
    console.log("Recover all:    bun run scripts/recover-scraping.ts --all");
    return;
  }

  if (arg === "--all") {
    const candidates = await listCandidates(token);
    for (const c of candidates) {
      console.log(`Recovering ${c.location_name} (${c.platform}) ...`);
      const r = await recover(token, c.config_id, c.bot_id!);
      console.log(`  ${r.ok ? "OK" : "ERROR"}: inserted=${r.body.inserted_reviews ?? "?"}  parsed=${r.body.parsed_reviews ?? "?"}  analysis=${r.body.analysis_triggered ?? "?"}`);
    }
    return;
  }

  // Recover specific config_id — fetch its bot_id
  const cfgRes = await fetch(
    `${SUPABASE_URL}/rest/v1/scraping_configs?id=eq.${arg}&select=bot_id,platform,locations(name)`,
    { headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY } },
  );
  const cfgs = await cfgRes.json();
  if (!Array.isArray(cfgs) || cfgs.length === 0) {
    console.error(`Config ${arg} not found`);
    process.exit(1);
  }
  const cfg = cfgs[0];
  if (!cfg.bot_id) {
    console.error(`Config has no bot_id`);
    process.exit(1);
  }
  console.log(`Recovering ${cfg.locations?.name} (${cfg.platform})  job=${cfg.bot_id}`);
  const r = await recover(token, arg, cfg.bot_id);
  console.log(JSON.stringify(r.body, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
