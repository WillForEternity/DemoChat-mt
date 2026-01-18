/**
 * Knowledge Base Summary Generator
 *
 * Generates a concise index/summary of the KB structure for hybrid preload.
 * This follows the "hybrid strategy" from context engineering research:
 * - Claude sees what exists (fast reference via summary)
 * - Claude uses tools for full content (just-in-time retrieval)
 *
 * Benefits:
 * - Reduces token usage vs preloading all content
 * - Gives Claude awareness of available information
 * - Enables informed decisions about what to retrieve
 */

import { getRootFolders, listFolder, readFile } from "./operations";

/**
 * Maximum number of files to show per folder in the summary.
 * Keeps the summary compact while showing the structure.
 */
const MAX_FILES_PER_FOLDER = 10;

/**
 * Maximum length of first-line preview for each file.
 */
const MAX_PREVIEW_LENGTH = 60;

/**
 * Get the first non-empty line of a file as a preview.
 */
async function getFilePreview(path: string): Promise<string | null> {
  try {
    const content = await readFile(path);
    // Find first non-empty, non-heading line for context
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines and markdown headings
      if (trimmed && !trimmed.startsWith("#")) {
        if (trimmed.length > MAX_PREVIEW_LENGTH) {
          return trimmed.slice(0, MAX_PREVIEW_LENGTH) + "...";
        }
        return trimmed;
      }
    }
    // Fallback to first heading if no content
    const heading = lines.find((l) => l.trim().startsWith("#"));
    if (heading) {
      const text = heading.replace(/^#+\s*/, "").trim();
      return text.length > MAX_PREVIEW_LENGTH
        ? text.slice(0, MAX_PREVIEW_LENGTH) + "..."
        : text;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Recursively build folder structure with file previews.
 */
async function buildFolderSummary(
  folderPath: string,
  folderName: string,
  depth: number = 0
): Promise<string> {
  const indent = "  ".repeat(depth);
  const items = await listFolder(folderPath);

  if (items.length === 0) {
    return `${indent}[${folderName}]: (empty)`;
  }

  const lines: string[] = [`${indent}[${folderName}]:`];

  // Separate files and folders
  const files: string[] = [];
  const folders: string[] = [];

  for (const item of items) {
    if (item.includes(".")) {
      files.push(item);
    } else {
      folders.push(item);
    }
  }

  // Add files with previews
  const filesToShow = files.slice(0, MAX_FILES_PER_FOLDER);
  for (const file of filesToShow) {
    const filePath =
      folderPath === "/" ? `/${file}` : `${folderPath}/${file}`;
    const preview = await getFilePreview(filePath);
    if (preview) {
      lines.push(`${indent}  - ${file}: "${preview}"`);
    } else {
      lines.push(`${indent}  - ${file}`);
    }
  }

  if (files.length > MAX_FILES_PER_FOLDER) {
    lines.push(
      `${indent}  ... and ${files.length - MAX_FILES_PER_FOLDER} more files`
    );
  }

  // Add subfolders (one level deep only to keep summary compact)
  if (depth === 0) {
    for (const folder of folders) {
      const subPath =
        folderPath === "/" ? `/${folder}` : `${folderPath}/${folder}`;
      const subItems = await listFolder(subPath);
      lines.push(`${indent}  [${folder}/]: ${subItems.length} items`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate a concise summary of the entire knowledge base.
 *
 * Returns an XML-structured summary suitable for inclusion in the system prompt.
 * This provides Claude with an overview of available information without
 * loading full file contents.
 *
 * @returns XML-formatted knowledge base summary
 */
export async function generateKBSummary(): Promise<string> {
  const rootFolders = await getRootFolders();

  if (rootFolders.length === 0) {
    return "(Knowledge base is empty - no folders or files yet)";
  }

  const summaryParts: string[] = [];

  for (const folder of rootFolders) {
    const folderSummary = await buildFolderSummary(`/${folder}`, folder);
    summaryParts.push(folderSummary);
  }

  return summaryParts.join("\n\n");
}

/**
 * Generate a minimal summary with just folder names and file counts.
 * Useful when token budget is very limited.
 */
export async function generateMinimalKBSummary(): Promise<string> {
  const rootFolders = await getRootFolders();

  if (rootFolders.length === 0) {
    return "(empty)";
  }

  const parts: string[] = [];

  for (const folder of rootFolders) {
    const items = await listFolder(`/${folder}`);
    parts.push(`[${folder}]: ${items.length} items`);
  }

  return parts.join(", ");
}
