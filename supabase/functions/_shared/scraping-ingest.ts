interface ScrapingConfigForIngest {
  id: string;
  location_id: string;
  platform: string;
  locations: { business_id: string };
}

type FieldMap = Record<string, string[]>;

const FIELD_MAPS: Record<string, FieldMap> = {
  google_maps: {
    title: ["title", "review_title"],
    rating: ["rating"],
    author_name: ["profile_name", "author_name", "name"],
    review_text: ["text", "review_text", "content"],
    review_date: ["time", "reviewed_at", "review_date", "date"],
    review_url: ["review_url", "url"],
  },
  tripadvisor: {
    title: ["title"],
    rating: ["rating"],
    author_name: ["author_name"],
    review_text: ["review_text", "text"],
    review_date: ["review_date", "date", "reviewed_at"],
    review_url: ["url", "review_url"],
  },
  booking: {
    title: ["review_title", "title"],
    rating: ["review_score", "rating", "score"],
    author_name: ["guest_name", "author_title", "author_name", "name"],
    review_text: ["review_text", "text"],
    review_date: ["review_date", "date", "reviewed_at", "review_timestamp"],
    review_url: ["hotel_url", "review_url", "url", "query"],
  },
};

function getField(
  raw: Record<string, unknown>,
  platform: string,
  field: string,
  fallback: unknown = "",
): unknown {
  const candidates = FIELD_MAPS[platform]?.[field];
  if (!candidates) return fallback;
  for (const key of candidates) {
    const val = raw[key];
    if (val != null && val !== "") return val;
  }
  return fallback;
}

function sanitize(value: unknown): string {
  if (value == null) return "";
  return (typeof value === "string" ? value : String(value)).replace(/\0/g, "");
}

function parseDate(raw: string | null, bookingFmt = false): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  if (bookingFmt) {
    const dmy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  }

  const months: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
    // Italian
    gennaio: "01", febbraio: "02", marzo: "03", aprile: "04",
    maggio: "05", giugno: "06", luglio: "07", agosto: "08",
    settembre: "09", ottobre: "10", novembre: "11", dicembre: "12",
  };
  // "January 15, 2026"
  const enMatch = s.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (enMatch) {
    const mm = months[enMatch[1].toLowerCase()];
    if (mm) return `${enMatch[3]}-${mm}-${enMatch[2].padStart(2, "0")}`;
  }
  // "15 febbraio 2026"
  const itMatch = s.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/i);
  if (itMatch) {
    const mm = months[itMatch[2].toLowerCase()];
    if (mm) return `${itMatch[3]}-${mm}-${itMatch[1].padStart(2, "0")}`;
  }

  const num = Number(s);
  if (!isNaN(num) && num > 1e9 && num < 1e11) {
    return new Date(num * 1000).toISOString().slice(0, 10);
  }

  return null;
}

function alignRating(rating: number): number {
  if (rating <= 1) return Math.floor(rating);
  return Math.floor(rating / 2);
}

async function hashHex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function ingestRawReviews(
  db: {
    from: (table: string) => {
      select: (columns: string) => { in: (column: string, values: string[]) => Promise<{ data: unknown[] | null }> };
      insert: (payload: Record<string, unknown>[]) => Promise<{ error: { message: string } | null }>;
    };
  },
  config: ScrapingConfigForIngest,
  rawResults: Record<string, unknown>[],
): Promise<{ parsed_count: number; inserted_count: number }> {
  const platform = config.platform as string;
  const businessId = config.locations.business_id;
  const isBooking = platform === "booking";

  const parsed: {
    title: string;
    rating: number;
    author: string;
    text: string;
    review_date: string | null;
    url: string;
    raw_data: Record<string, unknown>;
    hash: string;
  }[] = [];

  for (const raw of rawResults) {
    if (!raw || Object.keys(raw).length === 0) continue;

    const title = sanitize(getField(raw, platform, "title", ""));
    let rating = Number(getField(raw, platform, "rating", 1)) || 1;
    const author = sanitize(getField(raw, platform, "author_name", "")).slice(0, 50);
    let text = sanitize(getField(raw, platform, "review_text", ""));
    const dateRaw = String(getField(raw, platform, "review_date", "") ?? "");
    const url = sanitize(getField(raw, platform, "review_url", "")).slice(0, 255);

    if (isBooking) {
      // Botster format: review_positives / review_negatives
      // Outscraper format: review_liked_text / review_disliked_text
      const pos = sanitize(raw.review_positives ?? raw.review_liked_text);
      const neg = sanitize(raw.review_negatives ?? raw.review_disliked_text);
      if (pos || neg) {
        text = pos && neg ? `${pos} ${neg}` : pos || neg;
      }
      rating = alignRating(rating);
    }

    if (rating < 1) rating = 1;
    const reviewDate = parseDate(dateRaw, isBooking);

    const sanitizedRaw: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      sanitizedRaw[k] = typeof v === "string" ? sanitize(v) : v;
    }

    const hashInput = JSON.stringify(
      {
        author_name: author,
        business_id: businessId,
        location_id: config.location_id,
        rating,
        review_date: reviewDate,
        review_text: text,
        review_url: url,
        source: platform,
        title,
      },
      [
        "author_name", "business_id", "location_id", "rating",
        "review_date", "review_text", "review_url", "source", "title",
      ],
    );
    const hash = await hashHex(hashInput);

    parsed.push({
      title,
      rating,
      author,
      text,
      review_date: reviewDate,
      url,
      raw_data: sanitizedRaw,
      hash,
    });
  }

  const allHashes = parsed.map((r) => r.hash);

  let existingHashes = new Set<string>();
  if (allHashes.length > 0) {
    const { data: existingRows } = await db
      .from("reviews")
      .select("review_hash")
      .in("review_hash", allHashes);

    existingHashes = new Set(
      (existingRows ?? []).map((r) => (r as { review_hash: string }).review_hash),
    );
  }

  const seenInBatch = new Set<string>();
  const toInsert: Record<string, unknown>[] = [];

  for (const r of parsed) {
    if (existingHashes.has(r.hash) || seenInBatch.has(r.hash)) continue;
    seenInBatch.add(r.hash);

    toInsert.push({
      location_id: config.location_id,
      business_id: businessId,
      source: platform,
      title: r.title,
      text: r.text,
      url: r.url || null,
      rating: r.rating,
      author: r.author,
      review_date: r.review_date || new Date().toISOString().slice(0, 10),
      review_hash: r.hash,
      raw_data: r.raw_data,
      status: "pending",
    });
  }

  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500);
      const { error: insertErr } = await db.from("reviews").insert(chunk);
      if (insertErr) throw new Error(insertErr.message);
    }
  }

  return {
    parsed_count: parsed.length,
    inserted_count: toInsert.length,
  };
}
