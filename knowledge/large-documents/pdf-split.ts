/**
 * PDF splitting + parallel AI extraction (Phase 4)
 *
 * Groups consecutive low-quality / failed pages into ranges of ≤5 pages,
 * builds a sub-PDF for each range with `pdf-lib`, and POSTs them to
 * `/api/parse-pdf` in parallel (bounded concurrency, default 4).
 *
 * No external concurrency lib — small inline semaphore, consistent with
 * the rest of the codebase. No base64 round-trip — sub-PDFs travel as
 * `File` parts.
 */

import { PDFDocument } from "pdf-lib";
import type { PageExtraction } from "./page-extraction";

export interface PageRange {
  /** 0-based, inclusive */
  startIndex: number;
  /** 0-based, inclusive */
  endIndex: number;
}

export interface AiPageResult {
  range: PageRange;
  /**
   * One entry per page in the range, in document order.
   * The current implementation returns the joined text on the FIRST page
   * and empty strings for the rest, since Gemini doesn't surface clean
   * page boundaries — but the slot-per-page shape lets us tighten this
   * later without reshaping callers.
   */
  pages: Array<{ pageIndex: number; text: string }>;
  error?: string;
}

const MAX_RANGE_LEN = 5;
const DEFAULT_CONCURRENCY = 4;
const PER_REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;

/**
 * Group consecutive pages flagged as "low" or "failed" into ranges of ≤5.
 */
export function groupPagesForAi(pages: PageExtraction[]): PageRange[] {
  const ranges: PageRange[] = [];
  let current: PageRange | null = null;

  for (const p of pages) {
    if (p.quality === "good") {
      if (current) {
        ranges.push(current);
        current = null;
      }
      continue;
    }
    if (!current) {
      current = { startIndex: p.pageIndex, endIndex: p.pageIndex };
      continue;
    }
    if (p.pageIndex === current.endIndex + 1 && current.endIndex - current.startIndex + 1 < MAX_RANGE_LEN) {
      current.endIndex = p.pageIndex;
    } else {
      ranges.push(current);
      current = { startIndex: p.pageIndex, endIndex: p.pageIndex };
    }
  }
  if (current) ranges.push(current);

  return ranges;
}

/**
 * Build a sub-PDF containing only the pages in `range` (0-based, inclusive).
 */
export async function buildSubPdf(
  sourceBytes: ArrayBuffer | Uint8Array,
  range: PageRange,
): Promise<Uint8Array> {
  const src = await PDFDocument.load(sourceBytes);
  const out = await PDFDocument.create();
  const indices: number[] = [];
  for (let i = range.startIndex; i <= range.endIndex; i++) indices.push(i);
  const copied = await out.copyPages(src, indices);
  copied.forEach((p) => out.addPage(p));
  return out.save();
}

async function fetchWithTimeout(input: RequestInfo, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function consumeTextStream(response: Response): Promise<string> {
  // The /api/parse-pdf route returns a plain text stream
  // (AI SDK's `result.toTextStreamResponse()`).
  if (!response.body) return await response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

async function callParsePdf(
  subPdfBytes: Uint8Array,
  range: PageRange,
  signal?: AbortSignal,
  onDelta?: (text: string) => void,
): Promise<string> {
  const blob = new Blob([new Uint8Array(subPdfBytes)], { type: "application/pdf" });
  const file = new File([blob], `range-${range.startIndex + 1}-${range.endIndex + 1}.pdf`, {
    type: "application/pdf",
  });
  const formData = new FormData();
  formData.append("file", file);
  formData.append("useFreeTrial", "true");
  formData.append("pageStart", String(range.startIndex + 1));
  formData.append("pageEnd", String(range.endIndex + 1));

  const init: RequestInit = { method: "POST", body: formData };
  if (signal) init.signal = signal;

  const response = await fetchWithTimeout("/api/parse-pdf", init, PER_REQUEST_TIMEOUT_MS);
  if (!response.ok) {
    let code = "UPSTREAM_ERROR";
    let message = `HTTP ${response.status}`;
    try {
      const j = await response.json();
      code = j.code ?? code;
      message = j.error ?? message;
    } catch {
      // non-JSON body; keep defaults
    }
    const err = new Error(`${code}: ${message}`);
    (err as Error & { status?: number }).status = response.status;
    throw err;
  }

  if (!onDelta) {
    return consumeTextStream(response);
  }

  // Streaming variant — surface deltas to the caller for progress UX.
  if (!response.body) return await response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const piece = decoder.decode(value, { stream: true });
    out += piece;
    if (piece) onDelta(piece);
  }
  out += decoder.decode();
  return out;
}

async function callWithRetry(
  subPdfBytes: Uint8Array,
  range: PageRange,
  onDelta?: (text: string) => void,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callParsePdf(subPdfBytes, range, undefined, onDelta);
    } catch (err) {
      lastErr = err;
      const status = (err as Error & { status?: number }).status ?? 0;
      const retryable = status === 429 || status >= 500 || status === 0;
      if (attempt === MAX_ATTEMPTS || !retryable) break;
      const backoff = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      console.warn(
        `[PDF] range ${range.startIndex + 1}-${range.endIndex + 1} attempt ${attempt} failed (${status}); retrying in ${backoff}ms`,
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface ExtractRangesOptions {
  concurrency?: number;
  onRangeStart?: (range: PageRange) => void;
  onRangeProgress?: (range: PageRange, totalChars: number) => void;
  onRangeDone?: (result: AiPageResult) => void;
}

/**
 * Run AI extraction across many page ranges in parallel.
 * Per-range failures are isolated — one bad range doesn't fail the document.
 */
export async function extractRangesViaAi(
  sourceBytes: ArrayBuffer | Uint8Array,
  ranges: PageRange[],
  opts: ExtractRangesOptions = {},
): Promise<AiPageResult[]> {
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const results: AiPageResult[] = new Array(ranges.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= ranges.length) return;
      const range = ranges[i];
      opts.onRangeStart?.(range);
      try {
        const subPdf = await buildSubPdf(sourceBytes, range);
        let charsSoFar = 0;
        const text = await callWithRetry(subPdf, range, (delta) => {
          charsSoFar += delta.length;
          opts.onRangeProgress?.(range, charsSoFar);
        });
        const pages = [];
        for (let p = range.startIndex; p <= range.endIndex; p++) {
          pages.push({ pageIndex: p, text: p === range.startIndex ? text : "" });
        }
        results[i] = { range, pages };
        opts.onRangeDone?.(results[i]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const pages = [];
        for (let p = range.startIndex; p <= range.endIndex; p++) {
          pages.push({ pageIndex: p, text: "" });
        }
        results[i] = { range, pages, error: message };
        opts.onRangeDone?.(results[i]);
        console.error(
          `[PDF] range ${range.startIndex + 1}-${range.endIndex + 1} failed after retries: ${message}`,
        );
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}
