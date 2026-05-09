/**
 * Markdown Chunker
 *
 * Heading-aware chunking for Markdown content.
 * Splits content by headings, with fallback to paragraphs for long sections.
 * 
 * 2025 Best Practices:
 * - Supports configurable chunk overlap (10-20% recommended) to prevent context loss at boundaries
 * - Default chunk size of 512 tokens optimized for fact-focused retrieval
 * - Preserves heading context in each chunk for better embedding quality
 */

import type { Chunk } from "./types";

/**
 * A single page of text (1-based, externally) used by `chunkPaged`.
 * `pageIndex` is the 0-based index, matching `PageExtraction.pageIndex`.
 */
export interface PagedInput {
  pageIndex: number;
  text: string;
}

/**
 * A chunk that knows which page range it came from.
 * Used by the large-document v2 schema for citation-accurate search.
 */
export interface PagedChunk extends Chunk {
  pageStart: number;
  pageEnd: number;
}

/**
 * Configuration options for chunking.
 */
export interface ChunkOptions {
  /** Maximum tokens per chunk (default: 512) */
  maxTokens?: number;
  /** Overlap tokens between chunks (default: 75, ~15% of 512) */
  overlapTokens?: number;
  /** Minimum chunk size in tokens (default: 50) */
  minTokens?: number;
}

const DEFAULT_OPTIONS: Required<ChunkOptions> = {
  maxTokens: 512,
  overlapTokens: 75, // ~15% overlap - NVIDIA benchmarks found this optimal
  minTokens: 50,
};

/**
 * Estimate token count (rough: 1 token ≈ 4 chars for English).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate character count from tokens.
 */
function tokensToChars(tokens: number): number {
  return tokens * 4;
}

/**
 * Build heading breadcrumb from the heading stack.
 */
function buildHeadingPath(headingStack: Array<{ level: number; text: string }>): string {
  return headingStack.map((h) => h.text).join(" > ");
}

/**
 * Split text by paragraphs (double newlines).
 */
function splitByParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Split text by sentences (rough approximation).
 */
function splitBySentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Hard-split a text that exceeds maxTokens with no sentence/paragraph breaks
 * we can use. Prefers whitespace boundaries; falls back to a hard char cut so
 * we never emit a chunk larger than `maxTokens`. This is the last line of
 * defense before embedding (OpenAI rejects inputs > 8192 tokens).
 */
function hardSplitBySize(text: string, maxTokens: number): string[] {
  const maxChars = tokensToChars(maxTokens);
  if (text.length <= maxChars) return [text];
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + maxChars);
    if (end < text.length) {
      const slice = text.slice(i, end);
      const ws = Math.max(
        slice.lastIndexOf(" "),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf("\t"),
      );
      if (ws > maxChars * 0.5) {
        end = i + ws;
      }
    }
    out.push(text.slice(i, end).trim());
    i = end;
  }
  return out.filter((s) => s.length > 0);
}

/**
 * Chunks Markdown content by headings first, then paragraphs for long sections.
 *
 * Algorithm:
 * 1. Parse document into heading-delimited sections
 * 2. For each section:
 *    - If under maxTokens, keep as single chunk
 *    - If over, split on paragraph boundaries (\n\n)
 *    - If still over, split on sentence boundaries
 * 3. Prepend heading context to each chunk for better embedding
 * 4. Apply overlap between chunks to prevent context loss at boundaries
 *
 * @param content - The markdown content to chunk
 * @param maxTokensOrOptions - Either max tokens (legacy) or ChunkOptions object
 */
export function chunkMarkdown(
  content: string,
  maxTokensOrOptions: number | ChunkOptions = DEFAULT_OPTIONS
): Chunk[] {
  // Support legacy signature (just maxTokens number)
  const options: Required<ChunkOptions> =
    typeof maxTokensOrOptions === "number"
      ? { ...DEFAULT_OPTIONS, maxTokens: maxTokensOrOptions }
      : { ...DEFAULT_OPTIONS, ...maxTokensOrOptions };

  const { maxTokens, overlapTokens, minTokens } = options;

  const rawChunks: Chunk[] = [];
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;

  // Find all headings with their positions
  const headings: Array<{
    level: number;
    text: string;
    index: number;
    endIndex: number;
  }> = [];

  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push({
      level: match[1].length,
      text: match[2].trim(),
      index: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  // If no headings, treat entire content as one section
  if (headings.length === 0) {
    const text = content.trim();
    if (text.length > 0) {
      addChunksFromSection(text, "", 0, rawChunks, maxTokens);
    }
  } else {
    // Process content before first heading (if any)
    if (headings[0].index > 0) {
      const preContent = content.slice(0, headings[0].index).trim();
      if (preContent.length > 0) {
        addChunksFromSection(preContent, "", 0, rawChunks, maxTokens);
      }
    }

    // Process each heading section
    const headingStack: Array<{ level: number; text: string }> = [];

    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      const nextHeading = headings[i + 1];
      const sectionStart = heading.endIndex;
      const sectionEnd = nextHeading?.index ?? content.length;

      // Update heading stack (pop higher or equal levels, push current)
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].level >= heading.level
      ) {
        headingStack.pop();
      }
      headingStack.push({ level: heading.level, text: heading.text });

      const headingPath = buildHeadingPath(headingStack);
      const sectionContent = content.slice(sectionStart, sectionEnd).trim();

      // Include heading text in the chunk for better context
      const fullSectionText = `${heading.text}\n\n${sectionContent}`.trim();

      if (fullSectionText.length > 0) {
        addChunksFromSection(
          fullSectionText,
          headingPath,
          heading.index,
          rawChunks,
          maxTokens
        );
      }
    }
  }

  // Apply overlap between chunks
  const chunks = applyChunkOverlap(rawChunks, overlapTokens, minTokens);

  // Re-index chunks sequentially
  chunks.forEach((chunk, i) => {
    chunk.index = i;
  });

  return chunks;
}

/**
 * Page-aware chunker for large documents (v2 schema).
 *
 * Joins pages with a sentinel `\n\n` separator, runs the existing
 * markdown chunker over the result, then attaches `pageStart` /
 * `pageEnd` to each chunk based on the source pages its characters
 * came from.
 *
 * Definition (matches PDF_TRANSCRIPTION_ACTION_PLAN.md):
 *   - `pageStart` = page of the chunk's FIRST character.
 *   - `pageEnd` differs from `pageStart` only when ≥30% of the chunk's
 *     characters come from a subsequent page (overlap pulling in two
 *     sentences from the next page does NOT flip `pageEnd`).
 */
export function chunkPaged(
  pages: PagedInput[],
  options: ChunkOptions = DEFAULT_OPTIONS,
): PagedChunk[] {
  if (pages.length === 0) return [];

  // Build joined content + a parallel page-index lookup.
  // `pageOfOffset[i]` is the 0-based page that character `i` of the
  // joined string belongs to.
  const SEP = "\n\n";
  const parts: string[] = [];
  const pageOfOffset: Uint32Array[] = []; // we'll concat into one Uint32Array below

  let total = 0;
  for (let i = 0; i < pages.length; i++) {
    const text = pages[i].text;
    parts.push(text);
    total += text.length;
    if (i < pages.length - 1) total += SEP.length;
  }

  const offsetMap = new Uint32Array(total);
  let cursor = 0;
  for (let i = 0; i < pages.length; i++) {
    const text = pages[i].text;
    const pageIdx = pages[i].pageIndex;
    for (let k = 0; k < text.length; k++) {
      offsetMap[cursor + k] = pageIdx;
    }
    cursor += text.length;
    if (i < pages.length - 1) {
      // Separator characters belong to the page that just ended.
      for (let k = 0; k < SEP.length; k++) {
        offsetMap[cursor + k] = pageIdx;
      }
      cursor += SEP.length;
    }
  }
  // Note: `offsetMap` is the SAME holder we'll reference later.
  pageOfOffset.push(offsetMap);

  const joined = parts.join(SEP);
  const chunks = chunkMarkdown(joined, options);

  // Map each chunk back to a page range. `chunkMarkdown` may reflow
  // text via overlap/splitting, so we locate each chunk's text by
  // searching `joined` from a cursor that advances monotonically.
  const out: PagedChunk[] = [];
  let searchFrom = 0;

  for (const c of chunks) {
    let charStart = joined.indexOf(c.text, searchFrom);
    if (charStart === -1) {
      // Overlap may have prefixed sentences from the previous chunk; fall back
      // to locating the trailing portion (last 80 chars) which is unaltered.
      const tail = c.text.slice(Math.max(0, c.text.length - 80));
      const tailIdx = joined.indexOf(tail, searchFrom);
      charStart = tailIdx === -1 ? searchFrom : tailIdx - (c.text.length - tail.length);
      if (charStart < 0) charStart = 0;
    }
    const charEnd = Math.min(joined.length, charStart + c.text.length);
    searchFrom = Math.max(searchFrom, charStart);

    // Tally chars per page covered by this chunk.
    const perPage = new Map<number, number>();
    for (let k = charStart; k < charEnd; k++) {
      const p = offsetMap[k];
      perPage.set(p, (perPage.get(p) ?? 0) + 1);
    }

    const startPage0 = offsetMap[charStart] ?? pages[0].pageIndex;
    const totalChars = Math.max(1, charEnd - charStart);

    // pageEnd: only flip when a later page contributes ≥30% of the chunk.
    let endPage0 = startPage0;
    for (const [page, count] of perPage) {
      if (page > endPage0 && count / totalChars >= 0.3) {
        endPage0 = page;
      }
    }

    out.push({
      ...c,
      pageStart: startPage0 + 1, // expose 1-based to the rest of the system
      pageEnd: endPage0 + 1,
    });
  }

  return out;
}

/**
 * Apply overlap between consecutive chunks.
 * Takes the end of the previous chunk and prepends it to the current chunk.
 */
function applyChunkOverlap(
  chunks: Chunk[],
  overlapTokens: number,
  minTokens: number
): Chunk[] {
  if (chunks.length <= 1 || overlapTokens <= 0) {
    return chunks;
  }

  const overlapChars = tokensToChars(overlapTokens);
  const result: Chunk[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    if (i === 0) {
      // First chunk has no previous context
      result.push({ ...chunk });
    } else {
      const prevChunk = chunks[i - 1];

      // Only apply overlap if chunks are from the same heading section
      // or if the current chunk would benefit from context
      if (prevChunk.headingPath === chunk.headingPath) {
        // Get the last N characters from previous chunk for overlap
        const prevText = prevChunk.text;
        const overlapText = prevText.slice(-overlapChars).trim();

        // Find a good break point (sentence or paragraph boundary)
        const cleanOverlap = findCleanOverlapStart(overlapText);

        if (cleanOverlap && estimateTokens(cleanOverlap) >= minTokens / 2) {
          // Prepend overlap with a separator
          const overlappedText = `${cleanOverlap}\n\n${chunk.text}`;
          result.push({
            ...chunk,
            text: overlappedText,
          });
        } else {
          result.push({ ...chunk });
        }
      } else {
        // Different heading sections - no overlap to preserve section boundaries
        result.push({ ...chunk });
      }
    }
  }

  return result;
}

/**
 * Find a clean starting point for overlap text (sentence boundary).
 */
function findCleanOverlapStart(text: string): string {
  // Try to find a sentence boundary to start from
  const sentences = text.split(/(?<=[.!?])\s+/);

  if (sentences.length > 1) {
    // Skip partial first sentence, use complete sentences
    return sentences.slice(1).join(" ").trim();
  }

  // If no sentence boundary, try paragraph
  const paragraphs = text.split(/\n\n+/);
  if (paragraphs.length > 1) {
    return paragraphs.slice(1).join("\n\n").trim();
  }

  // Fall back to the whole text if short enough
  if (text.length < 200) {
    return text;
  }

  // Otherwise return empty (no clean overlap found)
  return "";
}

/**
 * Add chunks from a section, splitting if necessary.
 */
function addChunksFromSection(
  text: string,
  headingPath: string,
  startOffset: number,
  chunks: Chunk[],
  maxTokens: number
): void {
  const tokens = estimateTokens(text);

  if (tokens <= maxTokens) {
    // Section fits in one chunk
    chunks.push({
      text,
      index: chunks.length,
      headingPath,
      startOffset,
      endOffset: startOffset + text.length,
    });
    return;
  }

  // Try splitting by paragraphs
  const paragraphs = splitByParagraphs(text);
  let currentChunk = "";
  let chunkStart = startOffset;

  for (const paragraph of paragraphs) {
    const combined = currentChunk ? `${currentChunk}\n\n${paragraph}` : paragraph;

    if (estimateTokens(combined) <= maxTokens) {
      currentChunk = combined;
    } else {
      // Save current chunk if non-empty
      if (currentChunk.trim()) {
        chunks.push({
          text: currentChunk.trim(),
          index: chunks.length,
          headingPath,
          startOffset: chunkStart,
          endOffset: chunkStart + currentChunk.length,
        });
      }

      // Start new chunk with this paragraph
      // If paragraph itself is too large, split by sentences
      if (estimateTokens(paragraph) > maxTokens) {
        const rawSentences = splitBySentences(paragraph);
        // Any single "sentence" that is itself larger than maxTokens (common
        // for OCR / AI-transcribed pages with no punctuation) gets hard-split
        // by size so we never produce a chunk that exceeds the embedding
        // model's input limit.
        const sentences: string[] = [];
        for (const s of rawSentences) {
          if (estimateTokens(s) > maxTokens) {
            sentences.push(...hardSplitBySize(s, maxTokens));
          } else {
            sentences.push(s);
          }
        }
        let sentenceChunk = "";

        for (const sentence of sentences) {
          const sentenceCombined = sentenceChunk
            ? `${sentenceChunk} ${sentence}`
            : sentence;

          if (estimateTokens(sentenceCombined) <= maxTokens) {
            sentenceChunk = sentenceCombined;
          } else {
            if (sentenceChunk.trim()) {
              chunks.push({
                text: sentenceChunk.trim(),
                index: chunks.length,
                headingPath,
                startOffset: chunkStart,
                endOffset: chunkStart + sentenceChunk.length,
              });
            }
            sentenceChunk = sentence;
          }
        }

        if (sentenceChunk.trim()) {
          currentChunk = sentenceChunk;
        } else {
          currentChunk = "";
        }
      } else {
        currentChunk = paragraph;
      }

      chunkStart = startOffset + text.indexOf(currentChunk);
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push({
      text: currentChunk.trim(),
      index: chunks.length,
      headingPath,
      startOffset: chunkStart,
      endOffset: chunkStart + currentChunk.length,
    });
  }
}
