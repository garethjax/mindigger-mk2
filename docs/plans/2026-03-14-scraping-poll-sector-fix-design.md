# Scraping Poll And Sector Reclassification Design

## Context

The admin scraping dashboard currently exposes a manual "Controlla Stato" action that calls the `scraping-poll` edge function from the browser. When the edge function returns a non-2xx response, the UI collapses the failure into a generic message and does not surface the actual HTTP status or body.

The admin business detail page also does not allow editing the sector or competitor flag for an existing location. This blocks correction of real-world classification mistakes such as a hospitality setup that should instead be treated as a restaurant for analytics, AI categorization, and competitor comparison.

## Goals

- Make manual scraping polling diagnosable and reliable for admins.
- Allow admins to edit existing location classification data from Regia.
- Keep the change small and aligned with the current schema, where sector is stored on `locations` and not on `businesses`.

## Chosen Approach

1. Improve the scraping dashboard error handling so manual polling shows HTTP status and response body, matching the better diagnostics already used by other admin actions.
2. Add editing controls on the business detail view for existing locations, covering:
   - location name
   - sector
   - competitor flag
3. Keep `business.type` editable through the existing business form and use the location sector as the operational source of truth for categorization.

## Tradeoffs

- This does not redesign the business/location model. It fixes the current operational pain with minimal schema risk.
- Existing reviews remain associated with the same location and business. Reclassification changes how future analytics and category lookups operate, which is the intended behavior.
- Manual polling still relies on edge-function auth; the first step is to expose the real failure before making any deeper auth change.

## Validation

- Add a regression test for the polling error formatter.
- Add a regression test for updating a location from the admin detail view.
- Run targeted frontend checks after implementation.
