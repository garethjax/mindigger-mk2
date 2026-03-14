# Scraping Poll And Sector Reclassification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make manual scraping polling diagnosable for admins and add Regia controls to reclassify existing locations.

**Architecture:** Keep the existing schema intact. Improve the admin dashboard's function error reporting, then extend the business detail island to edit existing `locations` records in place so sector and competitor state can be corrected without SQL. Use small UI-state helpers and targeted tests.

**Tech Stack:** Astro, Preact, TypeScript, Supabase browser client, Vitest

---

### Task 1: Add a regression test for scraping poll error formatting

**Files:**
- Create: `apps/web/src/components/admin/__tests__/scraping-dashboard.test.tsx`
- Modify: `apps/web/package.json`

**Step 1: Write the failing test**

Write a test that renders `ScrapingDashboard`, mocks `supabase.functions.invoke("scraping-poll")` to return an error with `context.status` and body text, clicks `Controlla Stato`, and expects the rendered message to include the HTTP details instead of only the generic SDK string.

**Step 2: Run test to verify it fails**

Run: `bun test apps/web/src/components/admin/__tests__/scraping-dashboard.test.tsx`
Expected: FAIL because the component currently only uses `error.message`.

**Step 3: Write minimal implementation**

Update the component to reuse the same HTTP detail extraction pattern already used in other admin actions.

**Step 4: Run test to verify it passes**

Run: `bun test apps/web/src/components/admin/__tests__/scraping-dashboard.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/components/admin/__tests__/scraping-dashboard.test.tsx apps/web/src/components/admin/ScrapingDashboard.tsx apps/web/package.json
git commit -m "fix: surface scraping poll http errors"
```

### Task 2: Add a regression test for editing an existing location

**Files:**
- Create: `apps/web/src/components/admin/__tests__/business-detail-view.test.tsx`
- Modify: `apps/web/package.json`

**Step 1: Write the failing test**

Write a test that renders `BusinessDetailView`, enters edit mode for an existing location, changes the sector and competitor flag, saves, and asserts that the Supabase update payload contains the selected values and that the UI reflects the updated sector label.

**Step 2: Run test to verify it fails**

Run: `bun test apps/web/src/components/admin/__tests__/business-detail-view.test.tsx`
Expected: FAIL because there is currently no edit flow for existing locations.

**Step 3: Write minimal implementation**

Add an edit button, local form state, and a `locations.update(...)` save path for existing rows.

**Step 4: Run test to verify it passes**

Run: `bun test apps/web/src/components/admin/__tests__/business-detail-view.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/components/admin/__tests__/business-detail-view.test.tsx apps/web/src/components/admin/BusinessDetailView.tsx apps/web/package.json
git commit -m "feat: edit location classification from regia"
```

### Task 3: Verify the integrated admin flow

**Files:**
- Modify: `apps/web/src/components/admin/ScrapingDashboard.tsx`
- Modify: `apps/web/src/components/admin/BusinessDetailView.tsx`

**Step 1: Run targeted tests**

Run: `bun test apps/web/src/components/admin/__tests__/scraping-dashboard.test.tsx apps/web/src/components/admin/__tests__/business-detail-view.test.tsx`
Expected: PASS

**Step 2: Run Astro checks**

Run: `bun --filter web check`
Expected: PASS or actionable output to fix immediately.

**Step 3: Review git diff**

Run: `git diff -- apps/web/src/components/admin/ScrapingDashboard.tsx apps/web/src/components/admin/BusinessDetailView.tsx apps/web/src/components/admin/__tests__/scraping-dashboard.test.tsx apps/web/src/components/admin/__tests__/business-detail-view.test.tsx apps/web/package.json`
Expected: Only the intended UI and test changes.

**Step 4: Commit**

```bash
git add apps/web/src/components/admin/ScrapingDashboard.tsx apps/web/src/components/admin/BusinessDetailView.tsx apps/web/src/components/admin/__tests__/scraping-dashboard.test.tsx apps/web/src/components/admin/__tests__/business-detail-view.test.tsx apps/web/package.json
git commit -m "fix: improve scraping admin diagnostics and reclassification"
```
