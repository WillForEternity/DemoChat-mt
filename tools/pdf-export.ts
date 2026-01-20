/**
 * PDF Export Tool
 *
 * Allows users to export recent chat messages as a beautifully
 * formatted PDF document with proper markdown and LaTeX rendering.
 *
 * This tool is executed client-side via onToolCall callback since it
 * needs access to the DOM for PDF generation.
 */

import { tool } from "ai";
import { z } from "zod";

export const pdfExportTool = tool({
  description: `Export recent chat messages as a clean PDF document.
The PDF preserves markdown formatting including headers, lists, code blocks,
and LaTeX math equations. You control exactly how many messages to include.

WHEN TO USE:
- User asks to "export as PDF", "download PDF", "save as PDF", or "export this"
- User wants to save your most recent response (homework, notes, etc.)
- User needs a printable document

IMPORTANT PARAMETERS:
- messageCount: How many recent messages to include
  - Use 1 to export ONLY your last response (DEFAULT - most common!)
  - Use 2 for user question + your response
  - Higher numbers for more context
- includeUserMessages: Set to false when exporting just your content (e.g., homework)
- title: Optional document title (appears at top of PDF)

By default, exports as a CLEAN DOCUMENT without "ASSISTANT" labels - perfect for homework, notes, etc.

Returns: { success: true, filename: string } or { success: false, error: string }`,
  inputSchema: z.object({
    messageCount: z.number().optional().default(1).describe("Number of recent messages to include. Default: 1 (just your last response)"),
    filename: z.string().optional().describe("Custom filename (without .pdf extension)"),
    title: z.string().optional().describe("Optional title for the PDF document header"),
    includeUserMessages: z.boolean().optional().default(false).describe("Include user messages (default: false - exports clean document)"),
    includeAssistantMessages: z.boolean().optional().default(true).describe("Include assistant messages (default: true)"),
  }),
});

export const pdfExportTools = {
  pdf_export: pdfExportTool,
};
