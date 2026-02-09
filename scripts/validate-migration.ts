/**
 * Post-migration validation: Salsamenteria di Parma
 *
 * Usage: SUPABASE_SERVICE_ROLE_KEY=<key> bun run scripts/validate-migration.ts
 *
 * Checks row counts and basic integrity for the migrated data.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!SERVICE_KEY) {
  console.error("ERROR: Set SUPABASE_SERVICE_ROLE_KEY env var");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BIZ_UUID = "bc06f468-4cc1-4d9b-a117-caf49ce51879";
const USER_UUID = "23726c68-a570-4179-aa41-2f2053df4e23";

async function count(table: string, filter?: Record<string, string>): Promise<number> {
  let query = supabase.from(table).select("*", { count: "exact", head: true });
  if (filter) {
    for (const [col, val] of Object.entries(filter)) {
      query = query.eq(col, val);
    }
  }
  const { count: n, error } = await query;
  if (error) {
    console.error(`  Error counting ${table}:`, error.message);
    return -1;
  }
  return n ?? 0;
}

async function main() {
  console.log("=== Migration Validation ===\n");

  let ok = true;
  function check(label: string, value: number, min: number) {
    const status = value >= min ? "OK" : "FAIL";
    if (value < min) ok = false;
    console.log(`  [${status}] ${label}: ${value} (expected >= ${min})`);
  }

  // User exists
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, business_id, full_name")
    .eq("id", USER_UUID)
    .single();

  if (profile) {
    console.log(`  [OK] User: ${profile.full_name} (${profile.role})`);
    if (profile.business_id === BIZ_UUID) {
      console.log(`  [OK] Profile linked to business`);
    } else {
      console.log(`  [FAIL] Profile not linked to business`);
      ok = false;
    }
  } else {
    console.log("  [FAIL] User not found");
    ok = false;
  }

  // Business
  check("Business sectors", await count("business_sectors"), 6);
  check("Categories", await count("categories"), 61);
  check("Businesses (target)", await count("businesses", { id: BIZ_UUID }), 1);

  // Locations
  const locs = await count("locations", { business_id: BIZ_UUID });
  check("Locations", locs, 4);

  // Reviews
  const revs = await count("reviews", { business_id: BIZ_UUID });
  check("Reviews", revs, 1);

  // Review categories (can't filter by business directly)
  const totalRevCats = await count("review_categories");
  check("Review categories (total)", totalRevCats, 1);

  // Topics
  check("Topics", await count("topics"), 1);

  // Topic scores
  const scores = await count("topic_scores", { business_id: BIZ_UUID });
  check("Topic scores", scores, 1);

  // SWOT analyses
  const swots = await count("swot_analyses", { business_id: BIZ_UUID });
  check("SWOT analyses", swots, 0);

  // Scraping configs
  const { data: locData } = await supabase
    .from("locations")
    .select("id")
    .eq("business_id", BIZ_UUID);
  if (locData && locData.length > 0) {
    const locIds = locData.map((l) => l.id);
    const { count: scrapCount } = await supabase
      .from("scraping_configs")
      .select("*", { count: "exact", head: true })
      .in("location_id", locIds);
    check("Scraping configs", scrapCount ?? 0, 1);
  }

  // Spot check: review has ai_result
  const { data: sampleReview } = await supabase
    .from("reviews")
    .select("id, source, rating, ai_result, status")
    .eq("business_id", BIZ_UUID)
    .eq("status", "completed")
    .limit(1)
    .single();

  if (sampleReview) {
    console.log(`\n  Sample review: source=${sampleReview.source}, rating=${sampleReview.rating}, has_ai=${!!sampleReview.ai_result}`);
  }

  console.log(`\n=== Validation ${ok ? "PASSED" : "FAILED"} ===`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("Validation failed:", err);
  process.exit(1);
});
