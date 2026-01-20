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
        const sentences = splitBySentences(paragraph);
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
