/**
 * Markdown Chunker
 *
 * Heading-aware chunking for Markdown content.
 * Splits content by headings, with fallback to paragraphs for long sections.
 */

import type { Chunk } from "./types";

/**
 * Estimate token count (rough: 1 token ≈ 4 chars for English).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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
 */
export function chunkMarkdown(content: string, maxTokens = 500): Chunk[] {
  const chunks: Chunk[] = [];
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
      addChunksFromSection(text, "", 0, chunks, maxTokens);
    }
    return chunks;
  }

  // Process content before first heading (if any)
  if (headings[0].index > 0) {
    const preContent = content.slice(0, headings[0].index).trim();
    if (preContent.length > 0) {
      addChunksFromSection(preContent, "", 0, chunks, maxTokens);
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
        chunks,
        maxTokens
      );
    }
  }

  // Re-index chunks sequentially
  chunks.forEach((chunk, i) => {
    chunk.index = i;
  });

  return chunks;
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
