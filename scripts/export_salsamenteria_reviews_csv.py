#!/usr/bin/env python3
"""
Export legacy reviews (title/text) for Salsamenteria locations from the split SQL dump.

Input files (COPY format):
  - PIANO/old_dump/tables_split/public__business_business.sql
  - PIANO/old_dump/tables_split/public__business_location.sql
  - PIANO/old_dump/tables_split/public__reviews_review.sql

Output:
  - One CSV per location (by default under /tmp/dm_salsamenteria_reviews_csv)
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Iterable


ROOT = Path(__file__).resolve().parents[1]
TABLES_SPLIT = ROOT / "PIANO" / "old_dump" / "tables_split"

BUSINESS_SQL = TABLES_SPLIT / "public__business_business.sql"
LOCATION_SQL = TABLES_SPLIT / "public__business_location.sql"
REVIEWS_SQL = TABLES_SPLIT / "public__reviews_review.sql"


COPY_START_RE = re.compile(r"^COPY\s+public\.(?P<table>[a-z0-9_]+)\s+\((?P<cols>.+)\)\s+FROM\s+stdin;\s*$")


@dataclass(frozen=True)
class Business:
    id: int
    name: str


@dataclass(frozen=True)
class Location:
    id: int
    name: str
    business_id: int


def die(msg: str, code: int = 2) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(code)


def slugify(s: str) -> str:
    s = s.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = re.sub(r"_+", "_", s)
    return s.strip("_") or "location"


def decode_copy_text(s: str) -> str:
    # PostgreSQL COPY text format uses backslash escapes.
    # Keep it small: handle the ones we care about for readability.
    s = s.replace(r"\\", "\\")
    s = s.replace(r"\t", "\t")
    s = s.replace(r"\n", "\n")
    s = s.replace(r"\r", "\r")
    return s


def normalize_text(s: str, *, keep_newlines: bool) -> str:
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n+", "\n", s)
    s = s.strip()
    if not keep_newlines:
        # Avoid multi-line CSV cells; preserve intent via explicit "\n".
        s = s.replace("\n", r"\n")
    return s


def iter_copy_rows(path: Path, expected_table: str) -> Iterable[list[str]]:
    in_copy = False
    cols_count: int | None = None

    with path.open("r", encoding="utf-8", errors="replace") as f:
        for raw in f:
            line = raw.rstrip("\n")

            if not in_copy:
                m = COPY_START_RE.match(line)
                if not m:
                    continue
                table = m.group("table")
                if table != expected_table:
                    continue
                cols = [c.strip() for c in m.group("cols").split(",")]
                cols_count = len(cols)
                in_copy = True
                continue

            if line == r"\.":
                return

            parts = line.split("\t")
            if cols_count is not None and len(parts) != cols_count:
                # COPY rows should be single-line; if not, the dump is malformed.
                die(f"unexpected column count in {path.name}: got {len(parts)} expected {cols_count}")
            yield parts

    if not in_copy:
        die(f"COPY block not found in {path}")
    die(f"COPY block in {path} did not terminate with \\\\.")


def find_business_id_by_name(business_name: str) -> Business:
    matches: list[Business] = []
    for row in iter_copy_rows(BUSINESS_SQL, "business_business"):
        # (id, uid, business_name, is_assigned, user_id, business_type, business_logo)
        bid = int(row[0])
        name = decode_copy_text(row[2])
        if name == business_name:
            matches.append(Business(id=bid, name=name))

    if not matches:
        # Helpful fallback: show close matches.
        candidates: list[str] = []
        for row in iter_copy_rows(BUSINESS_SQL, "business_business"):
            name = decode_copy_text(row[2])
            if business_name.lower() in name.lower():
                candidates.append(name)
        hint = f" (candidates: {', '.join(candidates[:8])})" if candidates else ""
        die(f'business "{business_name}" not found{hint}')

    if len(matches) > 1:
        die(f'business "{business_name}" matched multiple rows: {[m.id for m in matches]}')

    return matches[0]


def load_locations_for_business(business_id: int) -> list[Location]:
    locs: list[Location] = []
    for row in iter_copy_rows(LOCATION_SQL, "business_location"):
        # (id, uid, name, business_id, business_sector_id, is_competitor, report_sent)
        lid = int(row[0])
        name = decode_copy_text(row[2])
        bid = int(row[3])
        if bid == business_id:
            locs.append(Location(id=lid, name=name, business_id=bid))
    return sorted(locs, key=lambda l: l.id)


def open_writers(out_dir: Path, locations: list[Location]) -> dict[int, tuple[IO[str], csv.DictWriter]]:
    out_dir.mkdir(parents=True, exist_ok=True)

    writers: dict[int, tuple[IO[str], csv.DictWriter]] = {}
    for loc in locations:
        filename = f"salsamenteria__loc_{loc.id}__{slugify(loc.name)}.csv"
        fp = out_dir / filename
        f = fp.open("w", encoding="utf-8", newline="")
        w = csv.DictWriter(
            f,
            fieldnames=[
                "location_id",
                "location_name",
                "review_uid",
                "review_date",
                "rating",
                "source",
                "author",
                "title",
                "text",
                "url",
            ],
        )
        w.writeheader()
        writers[loc.id] = (f, w)
    return writers


def export_reviews(
    business_id: int,
    locations: list[Location],
    out_dir: Path,
    normalize_whitespace: bool,
    keep_newlines: bool,
    progress_every: int,
) -> None:
    loc_by_id = {l.id: l for l in locations}
    loc_ids = set(loc_by_id.keys())

    writers = open_writers(out_dir, locations)
    counts = {lid: 0 for lid in loc_ids}

    try:
        in_copy = False
        line_no = 0

        with REVIEWS_SQL.open("r", encoding="utf-8", errors="replace") as f:
            for raw in f:
                line_no += 1
                line = raw.rstrip("\n")

                if not in_copy:
                    if line.startswith("COPY public.reviews_review "):
                        in_copy = True
                    continue

                if line == r"\.":
                    break

                parts = line.split("\t")
                if len(parts) != 17:
                    die(f"unexpected column count in reviews_review at line {line_no}: got {len(parts)} expected 17")

                # COPY public.reviews_review (id, uid, source, title, text, url, rating, author, review_date, status, created_at, business_id, location_id, batched_at, review_hash, ai_result, raw_data)
                if parts[11] == r"\N":
                    continue
                if int(parts[11]) != business_id:
                    continue

                if parts[12] == r"\N":
                    continue
                location_id = int(parts[12])
                if location_id not in loc_ids:
                    continue

                def field(i: int) -> str:
                    v = parts[i]
                    if v == r"\N":
                        return ""
                    v = decode_copy_text(v)
                    return normalize_text(v, keep_newlines=keep_newlines) if normalize_whitespace else v

                loc = loc_by_id[location_id]
                writers[location_id][1].writerow(
                    {
                        "location_id": location_id,
                        "location_name": loc.name,
                        "review_uid": field(1),
                        "source": field(2),
                        "title": field(3),
                        "text": field(4),
                        "url": field(5),
                        "rating": field(6),
                        "author": field(7),
                        "review_date": field(8),
                    }
                )
                counts[location_id] += 1

                if progress_every > 0 and (counts[location_id] % progress_every) == 0:
                    print(f"progress: loc {location_id} -> {counts[location_id]} reviews", file=sys.stderr)

    finally:
        for f, _ in writers.values():
            f.close()

    total = sum(counts.values())
    print(f"done: exported {total} reviews to {out_dir}")
    for loc in locations:
        print(f"- loc {loc.id} ({loc.name}): {counts[loc.id]}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Export Salsamenteria reviews from legacy tables_split dumps.")
    p.add_argument(
        "--business-name",
        default="Salsamenteria di Parma",
        help='Exact match on business_business.business_name (default: "Salsamenteria di Parma")',
    )
    p.add_argument(
        "--out",
        default="/tmp/dm_salsamenteria_reviews_csv",
        help="Output directory (default: /tmp/dm_salsamenteria_reviews_csv)",
    )
    p.add_argument(
        "--no-normalize-whitespace",
        action="store_true",
        help="Do not collapse whitespace/newlines in title/text fields",
    )
    p.add_argument(
        "--keep-newlines",
        action="store_true",
        help='Keep real newlines in CSV cells (default: convert newlines to literal "\\\\n")',
    )
    p.add_argument(
        "--progress-every",
        type=int,
        default=0,
        help="Print progress every N reviews per location (default: 0 = off)",
    )
    return p.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    for path in (BUSINESS_SQL, LOCATION_SQL, REVIEWS_SQL):
        if not path.exists():
            die(f"missing input file: {path}")

    biz = find_business_id_by_name(args.business_name)
    locs = load_locations_for_business(biz.id)
    if not locs:
        die(f'no locations found for business_id={biz.id} ("{biz.name}")')

    out_dir = Path(args.out).expanduser()
    normalize_whitespace = not args.no_normalize_whitespace
    keep_newlines = bool(args.keep_newlines)

    print(f'business: "{biz.name}" (id={biz.id})')
    print("locations:")
    for loc in locs:
        print(f"- {loc.id}: {loc.name}")

    export_reviews(
        business_id=biz.id,
        locations=locs,
        out_dir=out_dir,
        normalize_whitespace=normalize_whitespace,
        keep_newlines=keep_newlines,
        progress_every=args.progress_every,
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
