/**
 * Migration script: Legacy PostgreSQL (Django) → Supabase
 *
 * Scope: Salsamenteria di Parma (user c.micheli@previ.it, 4 locations)
 *
 * Usage: SUPABASE_SERVICE_ROLE_KEY=<key> bun run scripts/migrate.ts
 *
 * Requires:
 *   SUPABASE_URL (default: http://127.0.0.1:54321)
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Reads legacy data from PIANO/old_dump/tables_split/*.sql
 * Idempotent: uses UPSERT where possible.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// --- Configuration ---
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!SERVICE_KEY) {
  console.error("ERROR: Set SUPABASE_SERVICE_ROLE_KEY env var");
  process.exit(1);
}

const DUMP_DIR = resolve(import.meta.dir, "../PIANO/old_dump/tables_split");
const BATCH_SIZE = 500;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// --- Target: Salsamenteria di Parma ---
const TARGET = {
  userUuid: "23726c68-a570-4179-aa41-2f2053df4e23",
  userEmail: "c.micheli@previ.it",
  userFirstName: "Cesare",
  userLastName: "Micheli",
  businessIntId: "4",
  businessUuid: "bc06f468-4cc1-4d9b-a117-caf49ce51879",
  businessName: "Salsamenteria di Parma",
  locationIntIds: new Set(["5", "6", "7", "8"]),
} as const;

// --- Sector UUID mapping (from migration 006) ---
const SECTOR_UUID: Record<string, string> = {
  "1": "00000000-0000-0000-0000-000000000001", // Food & Beverage
  "2": "00000000-0000-0000-0000-000000000002", // Hospitality
  "3": "00000000-0000-0000-0000-000000000003", // Healthy and Care
  "4": "00000000-0000-0000-0000-000000000004", // Retail
  "5": "00000000-0000-0000-0000-000000000005", // Dealer
  "6": "00000000-0000-0000-0000-000000000006", // Pharmacy
};

// --- Enum mappings (legacy int → new enum string) ---
const SOURCE_MAP: Record<string, string> = {
  "1": "google_maps",
  "2": "tripadvisor",
  "4": "booking",
};

const REVIEW_STATUS_MAP: Record<string, string> = {
  "0": "pending",
  "1": "analyzing",
  "2": "completed",
  "3": "failed",
};

const SCRAPING_STATUS_MAP: Record<string, string> = {
  "0": "idle",
  "1": "elaborating",
  "2": "completed",
  "3": "checking",
  "4": "failed",
};

const BATCH_STATUS_MAP: Record<string, string> = {
  "0": "validating",
  "1": "failed",
  "2": "in_progress",
  "3": "finalizing",
  "4": "completed",
  "5": "expired",
  "6": "cancelling",
  "7": "cancelled",
};

const BATCH_TYPE_MAP: Record<string, string> = {
  "0": "reviews",
  "1": "swot",
};

// --- COPY format parser ---

function unescapeCopyValue(val: string): string {
  let result = "";
  for (let i = 0; i < val.length; i++) {
    if (val[i] === "\\" && i + 1 < val.length) {
      const next = val[i + 1];
      if (next === "n") { result += "\n"; i++; }
      else if (next === "t") { result += "\t"; i++; }
      else if (next === "r") { result += "\r"; i++; }
      else if (next === "\\") { result += "\\"; i++; }
      else { result += val[i]; }
    } else {
      result += val[i];
    }
  }
  return result;
}

type Row = Record<string, string | null>;

function parseDumpFile(filename: string): { columns: string[]; rows: Row[] } {
  const path = resolve(DUMP_DIR, filename);
  const sql = readFileSync(path, "utf-8");

  const copyMatch = sql.match(/COPY\s+\S+\s+\(([^)]+)\)\s+FROM\s+stdin;/);
  if (!copyMatch) return { columns: [], rows: [] };

  const columns = copyMatch[1].split(",").map((c) => c.trim());

  const marker = "FROM stdin;\n";
  const dataStart = sql.indexOf(marker);
  if (dataStart === -1) return { columns, rows: [] };

  const start = dataStart + marker.length;
  const end = sql.indexOf("\n\\.", start);
  if (end === -1) return { columns, rows: [] };

  const dataBlock = sql.substring(start, end);
  const lines = dataBlock.split("\n");

  const rows: Row[] = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    const values = line.split("\t");
    const row: Row = {};
    for (let i = 0; i < columns.length; i++) {
      const raw = values[i];
      row[columns[i]] = raw === undefined || raw === "\\N" ? null : unescapeCopyValue(raw);
    }
    rows.push(row);
  }

  return { columns, rows };
}

// --- Helpers ---

function byteaToHex(val: string | null): string | null {
  if (!val) return null;
  if (val.startsWith("\\x")) return val.slice(2);
  return val;
}

function parseJsonb(val: string | null): unknown {
  if (!val) return null;
  try {
    let parsed: unknown = JSON.parse(val);
    // Unwrap double-encoded JSON strings (e.g. '"{\\"key\\":1}"' → {key:1})
    while (typeof parsed === "string") {
      parsed = JSON.parse(parsed);
    }
    return parsed;
  } catch {
    return null;
  }
}

function ts(val: string | null): string | null {
  return val ?? null;
}

async function batchUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) {
      console.error(`  ERROR ${table} [${i}..${i + batch.length}]: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }
  return inserted;
}

// --- GoTrue admin: create user preserving UUID ---

async function createAuthUser(): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: TARGET.userUuid,
      email: TARGET.userEmail,
      password: crypto.randomUUID(),
      email_confirm: true,
      user_metadata: {
        full_name: `${TARGET.userFirstName} ${TARGET.userLastName}`,
      },
    }),
  });

  if (res.ok) return true;

  const body = await res.json();
  // If user already exists, that's fine (idempotent)
  if (body?.msg?.includes("already been registered") || body?.message?.includes("already been registered")) {
    console.log("  User already exists, skipping creation");
    return true;
  }
  if (res.status === 422) {
    console.log("  User already exists (422), skipping");
    return true;
  }

  console.error("  Failed to create auth user:", body);
  return false;
}

// ============================================================================
// MIGRATION STEPS
// ============================================================================

async function main() {
  console.log("=== Salsamenteria di Parma — Legacy Migration ===\n");

  // ------------------------------------------------------------------
  // Parse dump files
  // ------------------------------------------------------------------
  console.log("Parsing dump files...");
  const businessRows = parseDumpFile("public__business_business.sql").rows;
  const locationRows = parseDumpFile("public__business_location.sql").rows;
  const reviewRows = parseDumpFile("public__reviews_review.sql").rows;
  const reviewCatRows = parseDumpFile("public__reviews_review_categories.sql").rows;
  const topicRows = parseDumpFile("public__topics_topic.sql").rows;
  const topicScoreRows = parseDumpFile("public__topics_topicscore.sql").rows;
  const swotRows = parseDumpFile("public__reviews_swot.sql").rows;
  const batchRows = parseDumpFile("public__reviews_batch.sql").rows;
  const googleRows = parseDumpFile("public__botster_googlemapslocation.sql").rows;
  const tripRows = parseDumpFile("public__botster_tripadvisorlocation.sql").rows;
  const bookingRows = parseDumpFile("public__botster_bookinglocation.sql").rows;

  console.log(`  Total reviews in dump: ${reviewRows.length}`);
  console.log(`  Total topics: ${topicRows.length}`);
  console.log(`  Total topic scores: ${topicScoreRows.length}`);

  // ------------------------------------------------------------------
  // Build lookup maps
  // ------------------------------------------------------------------
  // business int id → UUID uid
  const bizIntToUuid = new Map<string, string>();
  for (const r of businessRows) bizIntToUuid.set(r.id!, r.uid!);

  // location int id → UUID uid
  const locIntToUuid = new Map<string, string>();
  for (const r of locationRows) locIntToUuid.set(r.id!, r.uid!);

  // review int id → UUID uid
  const reviewIntToUuid = new Map<string, string>();
  for (const r of reviewRows) reviewIntToUuid.set(r.id!, r.uid!);

  // Filter data for target business
  const targetLocations = locationRows.filter((r) => r.business_id === TARGET.businessIntId);
  const targetLocIntIds = new Set(targetLocations.map((r) => r.id!));
  const targetReviews = reviewRows.filter((r) => r.business_id === TARGET.businessIntId);
  const targetReviewIntIds = new Set(targetReviews.map((r) => r.id!));

  console.log(`\n  Target locations: ${targetLocations.length}`);
  console.log(`  Target reviews: ${targetReviews.length}`);

  // ------------------------------------------------------------------
  // Step 1: Create auth user
  // ------------------------------------------------------------------
  console.log("\n--- Step 1: Create user ---");
  const userOk = await createAuthUser();
  if (!userOk) {
    console.error("Cannot continue without user. Aborting.");
    process.exit(1);
  }
  console.log(`  User ${TARGET.userEmail} ready`);

  // Update profile with legacy flags
  const { error: profileErr } = await supabase
    .from("profiles")
    .update({
      role: "business",
      full_name: `${TARGET.userFirstName} ${TARGET.userLastName}`,
      account_enabled: true,
      active_subscription: true,
    })
    .eq("id", TARGET.userUuid);
  if (profileErr) console.error("  Profile update error:", profileErr.message);

  // ------------------------------------------------------------------
  // Step 2: Create business
  // ------------------------------------------------------------------
  console.log("\n--- Step 2: Create business ---");
  const bizRow = businessRows.find((r) => r.id === TARGET.businessIntId)!;
  const { error: bizErr } = await supabase.from("businesses").upsert(
    {
      id: TARGET.businessUuid,
      name: bizRow.business_name,
      type: "organization",
      logo_url: bizRow.business_logo || null,
    },
    { onConflict: "id" },
  );
  if (bizErr) console.error("  Business error:", bizErr.message);
  else console.log(`  Business "${bizRow.business_name}" created`);

  // Link profile → business
  const { error: linkErr } = await supabase
    .from("profiles")
    .update({ business_id: TARGET.businessUuid })
    .eq("id", TARGET.userUuid);
  if (linkErr) console.error("  Profile→Business link error:", linkErr.message);

  // ------------------------------------------------------------------
  // Step 3: Create locations
  // ------------------------------------------------------------------
  console.log("\n--- Step 3: Create locations ---");
  const locInserts = targetLocations.map((r) => ({
    id: r.uid!,
    name: r.name!,
    business_id: TARGET.businessUuid,
    business_sector_id: SECTOR_UUID[r.business_sector_id!] ?? SECTOR_UUID["1"],
    is_competitor: r.is_competitor === "t",
    report_sent: r.report_sent === "t",
  }));
  const locCount = await batchUpsert("locations", locInserts, "id");
  console.log(`  Locations: ${locCount}/${targetLocations.length}`);

  // ------------------------------------------------------------------
  // Step 4: Create scraping configs
  // ------------------------------------------------------------------
  console.log("\n--- Step 4: Scraping configs ---");
  const scrapingInserts: Record<string, unknown>[] = [];

  for (const r of googleRows) {
    if (!targetLocIntIds.has(r.location_id!)) continue;
    scrapingInserts.push({
      location_id: locIntToUuid.get(r.location_id!)!,
      platform: "google_maps",
      platform_config: { place_id: r.place_id ?? "" },
      status: SCRAPING_STATUS_MAP[r.status!] ?? "idle",
      bot_id: r.bot_id ?? null,
      last_scraped_at: ts(r.last_ran),
    });
  }
  for (const r of tripRows) {
    if (!targetLocIntIds.has(r.location_id!)) continue;
    scrapingInserts.push({
      location_id: locIntToUuid.get(r.location_id!)!,
      platform: "tripadvisor",
      platform_config: { location_url: r.location_url ?? "" },
      status: SCRAPING_STATUS_MAP[r.status!] ?? "idle",
      bot_id: r.bot_id ?? null,
      last_scraped_at: ts(r.last_ran),
    });
  }
  for (const r of bookingRows) {
    if (!targetLocIntIds.has(r.location_id!)) continue;
    scrapingInserts.push({
      location_id: locIntToUuid.get(r.location_id!)!,
      platform: "booking",
      platform_config: { location_url: r.location_url ?? "" },
      status: SCRAPING_STATUS_MAP[r.status!] ?? "idle",
      bot_id: r.bot_id ?? null,
      last_scraped_at: ts(r.last_ran),
    });
  }

  const scrapCount = await batchUpsert("scraping_configs", scrapingInserts, "location_id,platform");
  console.log(`  Scraping configs: ${scrapCount}/${scrapingInserts.length}`);

  // ------------------------------------------------------------------
  // Step 5: Migrate reviews
  // ------------------------------------------------------------------
  console.log("\n--- Step 5: Reviews ---");
  const reviewInserts = targetReviews.map((r) => ({
    id: r.uid!,
    location_id: locIntToUuid.get(r.location_id!) ?? null,
    business_id: TARGET.businessUuid,
    source: SOURCE_MAP[r.source!] ?? "google_maps",
    title: r.title ?? null,
    text: r.text ?? null,
    url: r.url || null,
    rating: r.rating ? parseInt(r.rating) : null,
    author: r.author || null,
    review_date: r.review_date ?? null,
    review_hash: byteaToHex(r.review_hash),
    raw_data: parseJsonb(r.raw_data),
    ai_result: parseJsonb(r.ai_result),
    status: REVIEW_STATUS_MAP[r.status!] ?? "pending",
    batched_at: ts(r.batched_at),
    created_at: ts(r.created_at),
  }));

  const revCount = await batchUpsert("reviews", reviewInserts, "id");
  console.log(`  Reviews: ${revCount}/${targetReviews.length}`);

  // ------------------------------------------------------------------
  // Step 6: Review categories
  // ------------------------------------------------------------------
  console.log("\n--- Step 6: Review categories ---");
  const targetRevCats = reviewCatRows.filter((r) => targetReviewIntIds.has(r.review_id!));
  const revCatInserts = targetRevCats
    .map((r) => {
      const reviewUuid = reviewIntToUuid.get(r.review_id!);
      if (!reviewUuid) return null;
      return {
        review_id: reviewUuid,
        category_id: r.category_id!, // already a UUID in legacy
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  const rcCount = await batchUpsert("review_categories", revCatInserts, "review_id,category_id");
  console.log(`  Review categories: ${rcCount}/${revCatInserts.length}`);

  // ------------------------------------------------------------------
  // Step 7: Topics (shared — migrate all)
  // ------------------------------------------------------------------
  console.log("\n--- Step 7: Topics ---");
  const topicInserts = topicRows.map((r) => ({
    id: r.uid!,
    name: r.name!,
  }));
  const topCount = await batchUpsert("topics", topicInserts, "id");
  console.log(`  Topics: ${topCount}/${topicRows.length}`);

  // ------------------------------------------------------------------
  // Step 8: Topic scores (filtered by target business)
  // ------------------------------------------------------------------
  console.log("\n--- Step 8: Topic scores ---");
  const targetScores = topicScoreRows.filter((r) => r.business_id === TARGET.businessIntId);
  const scoreInserts = targetScores
    .map((r) => {
      const reviewUuid = reviewIntToUuid.get(r.review_id!);
      const locationUuid = locIntToUuid.get(r.location_id!);
      if (!reviewUuid || !locationUuid) return null;
      return {
        id: r.uid!,
        review_id: reviewUuid,
        topic_id: r.topic_id!, // already UUID
        score: r.score ? parseInt(r.score) : null,
        business_id: TARGET.businessUuid,
        location_id: locationUuid,
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  const tsCount = await batchUpsert("topic_scores", scoreInserts, "id");
  console.log(`  Topic scores: ${tsCount}/${scoreInserts.length}`);

  // ------------------------------------------------------------------
  // Step 9: SWOT analyses
  // ------------------------------------------------------------------
  console.log("\n--- Step 9: SWOT analyses ---");
  const targetSwots = swotRows.filter((r) => r.business_id === TARGET.businessIntId);
  const swotInserts = targetSwots.map((r) => ({
    id: r.uid!,
    location_id: locIntToUuid.get(r.location_id!) ?? null,
    business_id: TARGET.businessUuid,
    period: String(r.period!), // enum: '3', '6', '12', etc.
    statistics: parseJsonb(r.statistics),
    results: parseJsonb(r.results),
    status: REVIEW_STATUS_MAP[r.status!] ?? "pending",
    batched_at: ts(r.batched_at),
    created_at: ts(r.created_at),
  }));

  const swotCount = await batchUpsert("swot_analyses", swotInserts, "id");
  console.log(`  SWOT analyses: ${swotCount}/${swotInserts.length}`);

  // ------------------------------------------------------------------
  // Step 10: AI batches (shared)
  // ------------------------------------------------------------------
  console.log("\n--- Step 10: AI batches ---");
  const batchInserts = batchRows.map((r) => ({
    external_batch_id: r.batch_id!,
    provider: "openai",
    batch_type: BATCH_TYPE_MAP[r.batch_type!] ?? "reviews",
    status: BATCH_STATUS_MAP[r.status!] ?? "in_progress",
    created_at: ts(r.created_at),
  }));

  // AI batches don't have a natural key for upsert — use insert and ignore conflicts
  let batchCount = 0;
  for (let i = 0; i < batchInserts.length; i += BATCH_SIZE) {
    const batch = batchInserts.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("ai_batches").upsert(batch, {
      onConflict: "external_batch_id",
      ignoreDuplicates: true,
    });
    if (error) {
      // external_batch_id might not be unique — fall back to insert
      for (const row of batch) {
        const { error: singleErr } = await supabase.from("ai_batches").insert(row);
        if (!singleErr) batchCount++;
      }
    } else {
      batchCount += batch.length;
    }
  }
  console.log(`  AI batches: ${batchCount}/${batchInserts.length}`);

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log("\n=== Migration complete ===");
  console.log(`  User: ${TARGET.userEmail}`);
  console.log(`  Business: ${TARGET.businessName}`);
  console.log(`  Locations: ${locCount}`);
  console.log(`  Reviews: ${revCount}`);
  console.log(`  Topics: ${topCount}`);
  console.log(`  Topic scores: ${tsCount}`);
  console.log(`  SWOT analyses: ${swotCount}`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
