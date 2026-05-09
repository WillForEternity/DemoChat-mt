/**
 * Per-page PDF extraction (Phase 3 + Phase 7)
 *
 * - Configures the pdf.js worker locally (no unpkg/CDN dependency in
 *   Turbopack mode; webpack-mode users fall back to the CDN below).
 * - Extracts each page individually and scores it for quality so the
 *   indexing pipeline can decide per-page whether the AI fallback is
 *   needed (Phase 4) instead of routing the whole document.
 *
 * NOTE: `dev:webpack` is not supported for the local worker — Turbopack
 *   handles `new URL(..., import.meta.url)` natively, but webpack would
 *   need an explicit asset rule we deliberately don't add. We fall back
 *   to the CDN there.
 */

// pdf.js's legacy build is what the rest of the codebase already uses.
// We import dynamically so the worker URL is only resolved client-side.

export type PageQuality = "good" | "low" | "failed";

export interface PageExtraction {
  /** 0-based index into the document */
  pageIndex: number;
  /** Extracted text (may be empty for `failed` pages) */
  text: string;
  /** Quality classification — drives the AI-fallback decision */
  quality: PageQuality;
  /** Numeric quality score (0..1), exposed for debugging/observability */
  score: number;
}

interface PageScore {
  score: number;
  classification: PageQuality;
}

/**
 * Per-page heuristics. Defaults tuned against typical academic PDFs.
 *
 * - chars-per-page threshold: at least 500 chars expected on a non-empty page
 * - word density: ≥5 alphabetic words per 100 chars
 * - space ratio band: 0.10–0.30 (gibberish OCR fragments fall outside)
 * - CJK escape: skip the space-ratio check when >20% of codepoints are CJK,
 *   because CJK text legitimately runs without ASCII spaces.
 */
function isCjkHeavy(text: string): boolean {
  if (!text) return false;
  let cjk = 0;
  let total = 0;
  for (const ch of text) {
    total++;
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x3000 && code <= 0x303f) || // CJK punctuation
      (code >= 0x3040 && code <= 0x30ff) || // Hiragana + Katakana
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0xac00 && code <= 0xd7af)    // Hangul Syllables
    ) {
      cjk++;
    }
  }
  return total > 0 && cjk / total > 0.2;
}

export function scorePage(text: string): PageScore {
  const trimmed = text.trim();
  if (trimmed.length < 50) {
    // An almost-empty page is probably scanned and needs the AI.
    return { score: 0, classification: "low" };
  }

  // chars-per-page check
  if (trimmed.length < 500) {
    return { score: 0.2, classification: "low" };
  }

  // word density
  const words = trimmed.match(/[a-zA-Z]{3,}/g) ?? [];
  const wordDensity = words.length / (trimmed.length / 100);
  if (wordDensity < 5 && !isCjkHeavy(trimmed)) {
    return { score: 0.3, classification: "low" };
  }

  // space-ratio band (skipped for CJK-heavy pages)
  if (!isCjkHeavy(trimmed)) {
    const spaceRatio = (trimmed.match(/ /g) ?? []).length / trimmed.length;
    if (spaceRatio < 0.1 || spaceRatio > 0.3) {
      return { score: 0.4, classification: "low" };
    }
  }

  return { score: 1, classification: "good" };
}

/**
 * Configure the pdf.js worker. Local in Turbopack/Next dev+prod;
 * CDN fallback for webpack mode (the project ships a `dev:webpack`
 * escape hatch). Idempotent.
 */
async function configureWorker(
  pdfjs: typeof import("pdfjs-dist/legacy/build/pdf"),
): Promise<void> {
  if (pdfjs.GlobalWorkerOptions.workerSrc) return;

  // Turbopack/webpack 5 both understand `new URL(..., import.meta.url)`
  // for asset resolution. If bundling fails (unlikely), we fall back to
  // the CDN — same behaviour as the previous implementation.
  try {
    const workerUrl = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    );
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.toString();
    return;
  } catch {
    const version = (pdfjs as unknown as { version: string }).version || "4.9.155";
    pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
  }
}

/**
 * Extract every page of a PDF independently and classify each.
 * Pages that throw return `quality: "failed"` (logged separately so the
 * UI can surface "extraction-failed" without taking the whole document down).
 */
export async function extractPdfPages(
  file: File,
): Promise<{ pages: PageExtraction[]; numPages: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf");
  await configureWorker(pdfjs);

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const pages: PageExtraction[] = [];

  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: { str?: string }) => item.str || "")
        .join(" ");
      const { score, classification } = scorePage(text);
      pages.push({ pageIndex: i - 1, text, quality: classification, score });
    } catch (err) {
      console.error(`[PDF] page ${i} extraction crashed:`, err);
      pages.push({ pageIndex: i - 1, text: "", quality: "failed", score: 0 });
    }
  }

  const lowCount = pages.filter((p) => p.quality === "low").length;
  const failedCount = pages.filter((p) => p.quality === "failed").length;
  console.log(
    `[PDF] extracted ${numPages} pages — good=${numPages - lowCount - failedCount} low=${lowCount} failed=${failedCount}`,
  );

  return { pages, numPages };
}

/**
 * Legacy thin wrapper retained for one release so the old
 * `uploadLargeDocument` / `uploadLargeDocumentFromText` paths keep
 * working without a flag day. Matches the original signature: returns
 * concatenated text or `null` if quality is too poor overall.
 */
export async function extractPdfText(
  file: File,
): Promise<{ text: string; numPages: number } | null> {
  try {
    const { pages, numPages } = await extractPdfPages(file);
    const goodPages = pages.filter((p) => p.quality === "good").length;
    // If less than half the pages are good, signal AI fallback.
    if (goodPages < Math.ceil(numPages / 2)) {
      console.log(
        `[PDF] only ${goodPages}/${numPages} good pages — fallback to AI OCR needed`,
      );
      return null;
    }
    const text = pages.map((p) => p.text).join("\n\n");
    return { text, numPages };
  } catch (err) {
    console.error("[PDF] extractPdfText failed:", err);
    return null;
  }
}
