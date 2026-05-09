# PDF Transcription Pipeline — Action Plan

A staged refactor of the large-document upload + transcription system. Each phase is independently shippable and ordered by ROI. Target end state: per-page extraction, parallel page-range AI fallback via **Gemini 2.5 Flash**, streaming progress, durable status, page-accurate citations, no silent truncation, and predictable cost.

---

## Conventions inherited from this codebase (do not break)

These exist today, work well, and the plan preserves them:

- **Package manager: pnpm.** `npm install` errors on this layout. All `pnpm-lock.yaml` only.
- **Direct provider factories** (`createAnthropic`, `createOpenAI`, and now `createGoogleGenerativeAI`). No Vercel AI Gateway, no wrapper "AI client" abstraction. New routes must follow this exact shape.
- **`resolveApiKey(isOwner, userKey, envKey, useFreeTrial)`** in `lib/auth-helper.ts` is the single source of truth for key selection. Stays pure — rate-limit/budget concerns go in a *separate* helper, not bolted onto this one.
- **IndexedDB versioning** in `knowledge/large-documents/idb.ts` (currently v4) is disciplined: documented version-history comment, explicit `upgrade` callback per bump, indexes maintained inside the upgrade. **This plan does not migrate v4 — it ships a clean v2 schema under a new database name (`large_documents_v2`) and orphans the old DB.** The version-history comment convention is preserved going forward.
- **Per-document chunk loading** via the `by-document` index in `searchLargeDocuments` (bounded memory). Untouched.
- **SHA-256 content-hash embedding reuse** (`[LargeDocs] Reused X/Y embeddings`). Untouched — extends naturally once AI extraction is deterministic.
- **`storeLargeDocument` (fast) → `indexLargeDocumentInBackground` (slow)** split. Architecture stays; only the *status string* it writes changes.
- **`IndexingProgress` callback pattern.** Just extend the union, no event-emitter machinery.
- **`OWNER_EMAILS` + `useFreeTrial` form field** for billing. Mechanism stays; Phase 2 changes its semantics from "always free" to "subject to quota."

## Quality gates (apply to every phase)

`next.config.mjs` has `typescript.ignoreBuildErrors: true`, so type breakage will not fail `next build`. Every phase that mutates exported shapes (Phases 3, 5, 6, 9) must additionally pass:

```
pnpm tsc --noEmit
pnpm lint
```

before being considered done. Fixing `ignoreBuildErrors` is out of scope for this plan.

---

## Guiding Principles

1. **Decide per page, not per document.** A PDF is a list of pages; treat each independently.
2. **Short, parallel AI calls beat long sequential ones.** 5-page chunks × N parallel > one 60-page mega-call.
3. **Stream everything user-facing.** No 60-second silent spinners.
4. **Status reflects reality.** No `"uploading"` lies, no zombie `"indexing"` rows on app boot.
5. **Server-side guards mirror client-side ones.** Size and rate limits are enforced where they actually matter.
6. **Free trial is a quota, not a flag.** Track tokens per user, not a global "always-on" boolean.

---

## Target Architecture

```
Upload (client, main thread)
  ├─ validate (mime, size)              ← also enforced server-side
  ├─ storeLargeDocument → IndexedDB     ← status: "stored"
  └─ indexLargeDocumentInBackground
       │
       └─ Per-page extraction
            ├─ pdfjs-dist (locally bundled worker)
            ├─ Per-page quality score
            ├─ Group low-quality pages into 5-page sub-PDFs (pdf-lib)
            ├─ Inline semaphore (concurrency=4) → POST /api/parse-pdf
            │       └─ streamText({ model: gemini-2.5-flash,
            │                       temperature: 0, maxRetries: 3 })
            │         → text deltas streamed back for progress
            ├─ Reassemble in page order; attach { pageStart, pageEnd } to each segment
            ├─ chunkPaged with page metadata propagated
            ├─ embedTexts (existing batch-of-20, hash-dedupe)
            └─ commit IndexedDB; status: "ready"

App boot recovery (inside large-document-browser.tsx mount effect)
  └─ scan documents; any status ∈ {"extracting","embedding"} older than 5 min → "error"
     surface a "Retry" button that resumes from the last successful page
```

Web Workers, Vercel Workflow, and structured-output dedupe are intentionally **not** in this architecture — see "Explicitly out of scope."

---

## Phase 0 — Pre-work (≤30 min)

- [x] Add dependency: `@ai-sdk/google` (installed `3.0.71` via `pnpm add @ai-sdk/google`)
- [x] Add dependency: `pdf-lib` (installed `1.17.1` via `pnpm add pdf-lib`)
- [ ] Add env var `GOOGLE_GENERATIVE_AI_API_KEY` to `.env.local` and Vercel project (mirrors how `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are wired through `lib/auth-helper.ts`)
- [ ] Decide on free-trial budget: e.g. `FREE_TRIAL_DAILY_TOKEN_BUDGET=500_000`

**Notes from install:**
- `@ai-sdk/google@3.0.71` emits an `unmet peer zod@^4.0.0` warning against the project's `zod@3.25.76`. Benign; identical to the existing `@ai-sdk/anthropic` peer situation.
- `pdf-lib` is isomorphic — used client-side in Phase 4 for sub-PDF construction, no server work.

---

## Phase 1 — Provider swap to Gemini 2.5 Flash + provider-agnostic naming (1–2 h)

**Goal:** drop-in replacement of Haiku 4.5 with Gemini Flash, plus name cleanup so the swap doesn't leave Anthropic-flavored crumbs everywhere. Output cap rises 16,384 → 65,536, eliminating most silent truncation immediately.

### Files

- `app/api/parse-pdf/route.ts`
- `knowledge/large-documents/operations.ts` (rename only)

### Changes

1. Replace `createAnthropic` with `createGoogleGenerativeAI`. Same direct-provider pattern as `app/api/embed/route.ts`, `app/api/generate-title/route.ts`.
2. Switch model id to `gemini-2.5-flash`.
3. Pass the PDF as `Uint8Array` (skip the base64 round-trip; the AI SDK handles encoding).
4. Set `temperature: 0`, `maxRetries: 3`, `maxOutputTokens: 65536`.
5. Reuse `resolveApiKey` as-is, passing `process.env.GOOGLE_GENERATIVE_AI_API_KEY`.
6. Return `{ text, usage }`; log `usage.totalTokens` server-side.
7. **Rename in the same commit** (do not leave a dual-name period):
   - Function `parsePdfWithClaude` → `parsePdfWithAi`.
   - Form field `anthropicApiKey` → `apiKey` on both client and route.
8. Keep `maxDuration = 60`. Phase 4 makes single-call duration moot anyway.

### Acceptance

- A scanned PDF that previously truncated at ~25 pages now extracts in full.
- `usage.totalTokens` is logged server-side per request.
- Cost per scanned 50-page PDF drops materially vs. Haiku (sanity-check via Vercel logs).
- No reference to `Claude` or `anthropicApiKey` remains in the PDF code path (`rg -i 'claude|anthropic' app/api/parse-pdf knowledge/large-documents/operations.ts` returns nothing).

---

## Phase 2 — Server-side hardening + per-user quota (2 h)

**Goal:** the route refuses unsafe work regardless of what the client sends. The free-trial flag stops being a money leak.

### Prework

```
pnpm add @upstash/ratelimit @upstash/redis
```

Picked over `@vercel/kv` because it doesn't require a Vercel Pro plan, has `@upstash/ratelimit` ready-made, and matches the de-facto Vercel pattern.

### Files

- `app/api/parse-pdf/route.ts`
- `lib/rate-limit.ts` (new — small helper, **not** added to `auth-helper.ts`)
- `lib/budget.ts` (new — `checkBudget(userEmail)` + `recordUsage(userEmail, tokens)`)

### Changes

1. **Size guard:** reject `file.size > 50 * 1024 * 1024` with `413 Payload Too Large`. Exit before reading bytes into memory.
2. **MIME guard:** require `application/pdf`; respond `415 Unsupported Media Type`.
3. **Per-user rate limit:** Upstash token-bucket keyed on `userEmail || ip`. Reject with `429` and `Retry-After`.
4. **Free-trial budget:** before invoking the model, call `checkBudget` against `FREE_TRIAL_DAILY_TOKEN_BUDGET` (24h TTL). After the call, `recordUsage(userEmail, result.usage.totalTokens)`. `useFreeTrial=true` now means *"subject to quota"*, not *"always free."*
5. **Structured error responses:** consistent `{ error, code }` shape. Codes: `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_TYPE`, `RATE_LIMITED`, `BUDGET_EXCEEDED`, `UPSTREAM_ERROR`.

### Acceptance

- `curl -F file=@huge.pdf /api/parse-pdf` with a 100 MB file returns 413 in <1s.
- Burst of 50 requests from one user returns 429 with `Retry-After`.
- A user who exhausts the daily budget gets `BUDGET_EXCEEDED` and the route does not call Gemini.
- `lib/auth-helper.ts` is unchanged.

---

## Phase 3 — Per-page quality scoring (2–3 h)

**Goal:** stop sending the entire PDF to the AI when only a few pages need it.

### Files

- `knowledge/large-documents/operations.ts` (callers of `extractPdfText`)
- New helper module `knowledge/large-documents/page-extraction.ts`

### Changes

1. **Add a new function `extractPdfPages(file)` returning `Array<{ pageIndex, text, quality: "good" | "low" | "failed" }>`** in `page-extraction.ts`. Leave the legacy `extractPdfText` in place for one release as a thin wrapper that concatenates the array — keeps the legacy `uploadLargeDocument` / `uploadLargeDocumentFromText` paths working without a flag day.
2. **Per-page heuristics in `scorePage(text)`** (returns `{ score: 0..1, classification }`):
   - chars-per-page threshold (default 500)
   - word density threshold (default 5/100)
   - space-ratio band (default 0.10–0.30)
   - **CJK escape:** if `text` contains >20% CJK codepoints, skip the space-ratio check.
3. **Distinguish "needs OCR" from "extraction crashed"**: pages that throw inside pdf.js return `quality: "failed"` and are routed to AI just like `"low"`, but logged separately for observability.
4. Update `indexLargeDocumentInBackground` to consume the new array shape; legacy callers continue to work via the wrapper.

### Caller list (must update or wrap)

- `indexLargeDocumentInBackground` — switch to `extractPdfPages`.
- `uploadLargeDocument` — keeps using the wrapper.
- `uploadLargeDocumentFromText` — unaffected (text path).

### Acceptance

- A mixed PDF (10 text pages, 3 scanned pages) reports `[{good × 10}, {low × 3}]`.
- Only the 3 "low" pages are routed to the AI fallback (verified via logs in Phase 4).
- A corrupt page surfaces a clear "extraction-failed" message in the UI without taking the whole document down.

---

## Phase 4 — Page-range chunking + parallel AI calls + streaming (3–4 h)

**Goal:** the single biggest engineering improvement. Split the PDF, parallelize, stream progress.

### Files

- `knowledge/large-documents/operations.ts` (`indexLargeDocumentInBackground`)
- `app/api/parse-pdf/route.ts`
- New helper `knowledge/large-documents/pdf-split.ts`

### Changes

1. **Group consecutive low-quality pages into ranges of ≤5.** A run of pages 14–22 becomes `[14..18]` and `[19..22]`. Use `pdf-lib` client-side:
   ```ts
   const src = await PDFDocument.load(arrayBuffer);
   const subset = await PDFDocument.create();
   const copied = await subset.copyPages(src, range);
   copied.forEach((p) => subset.addPage(p));
   const subBytes = await subset.save();
   ```
2. **Parallelize with bounded concurrency (default 4)** via a small inline semaphore — no `p-limit` dep, consistent with the rest of the codebase. Each request POSTs one sub-PDF + the page range to `/api/parse-pdf`.
3. **Server route accepts `pageStart`, `pageEnd`** as form fields; uses them only for logging — the model still just sees the sub-PDF.
4. **Switch the route to `streamText`** and return via `result.toTextStreamResponse()` (AI SDK v6 helper). Client consumes the stream to tick `IndexingProgress` per chunk.
5. **Reassemble** on the client into a `Map<pageIndex, { text, source: "pdfjs" | "ai" }>`, then a single ordered array.
6. **No base64 round-trip** anywhere; the sub-PDF travels as a `File` part.
7. **Per-request timeout 60 s** — comfortably within `maxDuration = 60`. If a sub-range fails after retries, mark just those pages as failed; don't fail the whole document.
8. **Retry per range** with exponential backoff (3 attempts) on 429 / 5xx.

### Acceptance

- 60-page scanned PDF: 12 sub-requests, 4 in flight, total wall time ≈ 3× single-range latency, not 12×.
- One sub-range failing leaves the rest of the doc indexed and surfaces an inline "Pages 23–27 could not be extracted — retry" affordance.
- Progress in the UI ticks per chunk (e.g. "Extracting 17 of 40 pages…"), not a 60s silent spinner.
- `maxDuration` in the route is still `60`.

---

## Phase 5 — Clean v2 schema + page-aware chunking + citations (2 h)

**Goal:** ship the final IndexedDB schema in one shot — page-aware chunks, the new status enum (Phase 6), and the extraction cache (Phase 7) all baked in. Existing v4 data is intentionally discarded; no migration code.

### Files

- `knowledge/embeddings/chunker.ts` (add `chunkPaged`; leave `chunkMarkdown` alone)
- `knowledge/large-documents/types.ts` (final `LargeDocumentChunk` shape with **required** `pageStart` / `pageEnd`; final status enum)
- `knowledge/large-documents/idb.ts` — **rename DB to `large_documents_v2`, version 1**, document the rename in the version-history comment, add a one-shot `indexedDB.deleteDatabase("large_documents_v1")` at module load to clean up orphans
- `knowledge/large-documents/operations.ts` (passes paged input to `chunkPaged`)
- `components/document-viewer/pdf-viewer.tsx` (jump-to-page on result click — mostly already wired)
- `components/large-document-browser.tsx` (display "p. N" in result snippets)

### v2 schema (final shape — Phases 5/6/7 land together here)

```ts
// large_documents_v2, version 1
documents:          keyPath "id",          indexes: by-filename, by-status   // status enum: stored | extracting | embedding | ready | error
chunks:             keyPath "id",          indexes: by-document, by-hash     // chunkText, embedding, contentHash, pageStart, pageEnd (required)
files:              keyPath "documentId"
umap_projections:   keyPath "documentId"
extractionCache:    keyPath ["documentId", "pageIndex", "source"], index: by-document   // populated by Phase 7
```

### Changes

1. New entry `chunkPaged(pages: Array<{ pageIndex, text }>, opts)` runs the existing markdown chunker per page and tags each chunk with `pageStart` / `pageEnd`. **Definition pinned:** `pageStart` is the page of the chunk's first character; `pageEnd` is set to a different value only when ≥30% of the chunk's characters come from a subsequent page (overlap pulling in two sentences from the next page does not flip `pageEnd`).
2. `pageStart` / `pageEnd` are **required** on `LargeDocumentChunk` — no `undefined` branch, no "page unknown" rendering path. Old data is gone, so the type can be tight.
3. Search results carry the page range to the UI; click jumps to that page.
4. The DB rename means existing users see an empty document list on first load after this ships. That is the explicit cost; the upside is no migration code in the repo.

### Acceptance

- Fresh load opens `large_documents_v2`; `large_documents_v1` is deleted from the user's browser on first run.
- Search result UI shows "p. 47" next to the snippet.
- Clicking the result scrolls the embedded PDF to page 47.
- `LargeDocumentChunk["pageStart"]` is non-optional in the type; no `?? "p. ?"` fallbacks anywhere.
- `idb.ts` version-history comment notes the v1→v2 rename and lists the v2 stores.

---

## Phase 6 — Status truth + boot recovery (1 h)

**Goal:** statuses match ground truth; no zombie documents; the UI stops lying. Schema work for the new enum already landed in Phase 5 — this phase is purely write-site + read-site updates.

### Files

- `knowledge/large-documents/operations.ts` (write the new enum values)
- `components/large-document-browser.tsx` — both the rendering sites (status === "uploading" / "indexing" comparisons around lines 542, 547, 548) **and** the existing mount `useEffect` (boot recovery lives here, colocated with the document loader — not in `app/page.tsx`)

### Changes

1. Status enum (`stored | extracting | embedding | ready | error`) is already in `types.ts` from Phase 5. The `"uploading"` lie is gone — the file is on disk by the time we have a row.
2. `storeLargeDocument` writes `stored`. `indexLargeDocumentInBackground` flips through `extracting → embedding → ready`.
3. **Boot recovery** in `large-document-browser.tsx`'s existing load-effect: any document with `status ∈ {"extracting","embedding"}` AND `Date.now() - uploadedAt > 5 * 60_000` → flip to `error` with `errorMessage: "Indexing was interrupted"`. One source of truth, no race with the loader.
4. Surface a **"Retry indexing"** button per errored document → re-runs `indexLargeDocumentInBackground`. With Phase 4's per-range retries + Phase 7's cache, this is cheap.
5. Update every `status === "uploading" | "indexing"` site in `large-document-browser.tsx` to the new enum.
6. Drop the misleading "uploading" comment in `handleUpload`.

### Acceptance

- Closing the tab mid-extraction and reopening shows the document in `error` state with a Retry button.
- Clicking Retry resumes; pages already extracted (Phase 7's cache) are not re-OCR'd.
- `rg '"uploading"|"indexing"' components/ knowledge/` returns nothing.

---

## Phase 7 — Local PDF.js worker + idempotent extraction cache (30 min)

**Goal:** kill the unpkg dependency; make Retry cheap. The `extractionCache` store already exists from Phase 5's v2 schema — this phase only writes to it.

### Files

- `knowledge/large-documents/page-extraction.ts` (worker config — moved here in Phase 3; cache read/write helpers)
- `knowledge/large-documents/operations.ts` (cache lookup before AI call, cache write after success)

### Changes

1. **Bundle the worker locally:**
   ```ts
   pdfjs.GlobalWorkerOptions.workerSrc = new URL(
     "pdfjs-dist/build/pdf.worker.min.mjs",
     import.meta.url,
   ).toString();
   ```
   No more CDN runtime fetch, no privacy leak, works offline. Turbopack handles `new URL(..., import.meta.url)` natively. The `dev:webpack` escape script in `package.json` is **not supported** for the local worker — webpack-mode users fall back to the CDN. Add a one-line comment near the worker config noting this; do not invent an asset rule.
2. **Per-page extraction cache** keyed by `[documentId, pageIndex, source]`. Before calling the AI for a page range, check the cache; reuse if present. Retry resumes from the last successful page for free.
3. Cache invalidates when the document file's content hash changes (cheap insurance — currently impossible to re-upload under the same id, but easy to wire now).

### Acceptance

- Disconnecting from the internet still lets PDF.js extract local PDFs.
- Retry after a partial failure only re-OCRs the failed pages (verify via logs).

---

## Phase 8 — Streaming progress UI polish (1–2 h)

**Goal:** real-time feedback throughout extraction.

### Files

- `components/large-document-browser.tsx` (consumes per-page progress)
- `knowledge/large-documents/types.ts` (richer `IndexingProgress` shape)

### Changes

1. Extend `IndexingProgress` with `pagesProcessed?: number`, `pagesTotal?: number`, `currentSource?: "pdfjs" | "ai"`. Optional fields so existing consumers don't break.
2. Update the existing progress bar to show "Extracting 17 of 40 pages (AI: 3 / 5)".
3. Per-page timeline (collapsed by default) for power users / debugging.

### Acceptance

- No more 60-second silent spinners. Worst case the user sees pages tick over every couple seconds.
- `IndexingProgress.status` union additions don't break the existing `large-document-browser.tsx` switch (defaults handled).

---

## File-by-file Summary

| File | Phase touches |
|---|---|
| `app/api/parse-pdf/route.ts` | 1, 2, 4 |
| `knowledge/large-documents/operations.ts` | 1 (rename), 3, 4, 6 |
| `knowledge/large-documents/types.ts` | 5, 6, 8 |
| `knowledge/large-documents/page-extraction.ts` (new) | 3, 7 |
| `knowledge/large-documents/pdf-split.ts` (new) | 4 |
| `knowledge/large-documents/idb.ts` | 5 (one-shot rename to `large_documents_v2` with final schema; no later bumps) |
| `knowledge/embeddings/chunker.ts` | 5 |
| `lib/rate-limit.ts` (new) | 2 |
| `lib/budget.ts` (new) | 2 |
| `components/large-document-browser.tsx` | 5, 6, 8 |
| `components/document-viewer/pdf-viewer.tsx` | 5 (jump-to-page wiring; mostly already there) |

`lib/auth-helper.ts` is **not** in this table — Phase 2's billing/limit logic is a separate module.

---

## Suggested Rollout

1. **Day 1 (4–6 h):** Phases 0–2. Provider swapped, route hardened, `maxOutputTokens` raised, per-user quota live, billing leak closed. Truncation bug effectively gone for documents up to ~100 pages.
2. **Day 2 (5–7 h):** Phases 3–4. Per-page routing + parallel AI calls + streaming. Biggest cost + latency win.
3. **Day 3 (3 h):** Phases 5–6. Single DB rename to `large_documents_v2` carrying the final schema (page-aware chunks + new status enum + extractionCache store), plus boot recovery. No staged migrations.
4. **Day 4 (1.5–2.5 h):** Phases 7–8. Local worker + extraction-cache read/write (store already exists), UI polish.

---

## What this fixes, mapped to original concerns

| Concern | Fixed in |
|---|---|
| Trigger is binary across whole document | Phase 3 |
| All pages sent to AI even when only a few need it | Phases 3 + 4 |
| Whole PDF as one base64 blob, three memory copies | Phase 4 (no base64; sub-PDFs) |
| `generateText` instead of streaming | Phase 4 |
| `maxOutputTokens: 16384` silent truncation | Phase 1 |
| "Background" indexing dies on tab close | Phase 6 (recovery) + Phase 7 (resumable cache) |
| Status `"uploading"` is a UI lie | Phase 6 |
| `useFreeTrial=true` hardcoded; no per-user accounting | Phase 2 |
| Page numbers thrown away → no citations | Phase 5 |
| `pdf.worker` from unpkg = SPOF + privacy leak | Phase 7 |
| No retries; one 429 kills everything | Phases 2 + 4 |
| Heuristics undocumented; CJK misclassified | Phase 3 |
| Anthropic-flavored function/field names after provider swap | Phase 1 |

---

## Explicitly out of scope

These were considered and **deliberately deferred** to keep the plan ROI-positive and consistent with the codebase's existing simplicity:

- **Web Workers via `comlink`.** Not used anywhere today; main-thread pdf.js is fine for the document sizes in scope. Would add architecture without solving a real user-visible problem.
- **`generateObject` / `streamObject` for deterministic output and SHA-256-cached re-uploads.** No evidence users re-upload identical PDFs. `temperature: 0` (Phase 1) is sufficient until a metric proves otherwise. Adopting it now would also conflict with Phase 4's `streamText` plumbing.
- **Vercel Workflow / WDK durable extraction.** Zero workflow infra in the repo. Phases 6 (recovery) + 7 (extraction cache) cover ~95% of the reliability gap at ~5% of the cost. Revisit only if a real reliability complaint surfaces.
- **`p-limit` dependency.** Codebase uses no external concurrency libs. A 10-line inline semaphore stays consistent.
- **`maxDuration = 300` bump.** Only meaningful on Vercel Pro, and once Phase 4 chunks work into ≤60 s sub-requests it's moot. Keeping `maxDuration = 60` lets the plan ship on Hobby unchanged.
- **Configurable secondary OCR provider (`OCR_PROVIDER=gemini|anthropic`).** YAGNI until the primary provider has a real outage.
- **Fixing `next.config.mjs` `ignoreBuildErrors: true`.** Repo-wide concern, not a PDF concern.

---

## Open Questions

- **Embedding provider isn't on the chopping block here.** This plan assumes `embedTexts` stays as-is. If embedding cost dominates, that's a separate investigation.
- **Page count ceiling?** With Phase 4 (5 pages × 4 parallel × 60 s) we comfortably handle 200+ page PDFs in a couple minutes. Past ~500 pages, revisit the "out of scope" WDK decision.
