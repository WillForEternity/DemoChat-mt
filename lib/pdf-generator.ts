/**
 * PDF Generator
 *
 * Client-side PDF generation using jsPDF with HTML rendering.
 * Uses the same remark/rehype pipeline as the chat for proper
 * markdown and LaTeX rendering.
 */

import type { UIMessage } from "ai";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";

export interface PdfExportOptions {
  filename?: string;
  title?: string;
  messageCount?: number;
  includeUserMessages?: boolean;
  includeAssistantMessages?: boolean;
  /** If true, hide role labels (YOU/ASSISTANT) and export as a clean document */
  cleanDocument?: boolean;
  /** If true, hide the export date from the header */
  hideDate?: boolean;
}

/**
 * Convert markdown text to HTML using the same pipeline as the chat UI.
 * This ensures LaTeX, GFM tables, and all markdown features render correctly.
 */
async function markdownToHtml(markdown: string): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeKatex)
    .use(rehypeStringify)
    .process(markdown);
  
  return String(result);
}

/**
 * CSS styles for PDF rendering.
 * These are inlined to ensure consistent rendering regardless of page styles.
 */
const PDF_STYLES = `
  .pdf-export-container {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    line-height: 1.5;
    color: #1f2937;
    max-width: 100%;
    padding: 0;
    background: white;
  }
  .pdf-export-container h1 {
    font-size: 16px;
    font-weight: 700;
    margin: 0 0 6px 0;
    color: #111827;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 6px;
  }
  .pdf-export-container h2 {
    font-size: 14px;
    font-weight: 600;
    margin: 12px 0 6px 0;
    color: #1f2937;
  }
  .pdf-export-container h3 {
    font-size: 12px;
    font-weight: 600;
    margin: 10px 0 4px 0;
    color: #374151;
  }
  .pdf-export-container h4 {
    font-size: 11px;
    font-weight: 600;
    margin: 8px 0 3px 0;
    color: #4b5563;
  }
  .pdf-export-container p {
    margin: 6px 0;
    /* Prevent page breaks inside paragraphs where possible */
    orphans: 3;
    widows: 3;
  }
  .pdf-export-container ul {
    margin: 6px 0;
    padding-left: 18px;
    list-style-type: disc;
  }
  .pdf-export-container ol {
    margin: 6px 0;
    padding-left: 18px;
    list-style-type: decimal;
  }
  .pdf-export-container li {
    margin: 3px 0;
    padding-left: 4px;
  }
  .pdf-export-container ul ul {
    list-style-type: circle;
    margin: 2px 0;
  }
  .pdf-export-container ul ul ul {
    list-style-type: square;
  }
  .pdf-export-container blockquote {
    margin: 6px 0;
    padding: 6px 10px;
    border-left: 3px solid #d1d5db;
    background: #f9fafb;
    color: #6b7280;
    font-style: italic;
  }
  .pdf-export-container code {
    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
    font-size: 9px;
    background: #f3f4f6;
    padding: 1px 3px;
    border-radius: 2px;
    color: #1f2937;
  }
  .pdf-export-container pre {
    margin: 6px 0;
    padding: 10px;
    background: #1f2937;
    border-radius: 4px;
    overflow-x: auto;
  }
  .pdf-export-container pre code {
    background: transparent;
    padding: 0;
    color: #e5e7eb;
    font-size: 8px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .pdf-export-container table {
    width: 100%;
    border-collapse: collapse;
    margin: 6px 0;
    font-size: 9px;
  }
  .pdf-export-container th, .pdf-export-container td {
    border: 1px solid #e5e7eb;
    padding: 4px 8px;
    text-align: left;
  }
  .pdf-export-container th {
    background: #f9fafb;
    font-weight: 600;
  }
  .pdf-export-container hr {
    border: none;
    border-top: 1px solid #e5e7eb;
    margin: 12px 0;
  }
  .pdf-export-container a {
    color: #2563eb;
    text-decoration: underline;
  }
  .pdf-export-container .katex {
    font-size: 1em;
  }
  .pdf-export-container .katex-display {
    margin: 8px 0;
    overflow-x: auto;
  }
  .pdf-title {
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 3px;
    color: #111827;
  }
  .pdf-date {
    font-size: 9px;
    color: #6b7280;
    margin-bottom: 10px;
  }
  .pdf-role-label {
    font-size: 8px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 3px;
    padding: 2px 0;
  }
  .pdf-role-user {
    color: #4b5563;
  }
  .pdf-role-assistant {
    color: #111827;
  }
  .pdf-message {
    margin-bottom: 12px;
    padding-bottom: 12px;
  }
  .pdf-message:not(:last-child) {
    border-bottom: 1px solid #f3f4f6;
  }
  .pdf-message.clean-mode {
    border-bottom: none;
    margin-bottom: 6px;
    padding-bottom: 6px;
  }
  /* Strong/bold text */
  .pdf-export-container strong {
    font-weight: 600;
  }
  /* Emphasis/italic text */
  .pdf-export-container em {
    font-style: italic;
  }
`;

/**
 * Generate PDF from chat messages using jsPDF with HTML rendering.
 * Uses the same markdown/LaTeX pipeline as the chat UI.
 */
export async function generateChatPdf(
  messages: UIMessage[],
  options: PdfExportOptions = {}
): Promise<{ success: boolean; filename: string; blob?: Blob; error?: string }> {
  const {
    filename = "chat-export",
    title,
    messageCount = 2,
    includeUserMessages = true,
    includeAssistantMessages = true,
    cleanDocument = false,
    hideDate = false,
  } = options;
  
  // Auto-detect clean document mode: if only exporting assistant messages, default to clean
  const isCleanMode = cleanDocument || (includeAssistantMessages && !includeUserMessages);

  try {
    // Dynamic import of jsPDF
    const jsPDFModule = await import("jspdf");
    const jsPDF = jsPDFModule.default || jsPDFModule.jsPDF;

    // IMPORTANT: Exclude the current/last assistant message since that's the one
    // calling the pdf_export tool. We want the content BEFORE this tool call.
    let messagesToConsider = [...messages];
    
    // Remove the last assistant message (which contains the pdf_export tool call)
    if (messagesToConsider.length > 0 && messagesToConsider[messagesToConsider.length - 1].role === "assistant") {
      messagesToConsider = messagesToConsider.slice(0, -1);
    }

    // Filter messages FIRST based on role options, THEN take the last N
    // This ensures messageCount applies to the filtered set
    let filteredByRole = messagesToConsider.filter((msg) => {
      if (msg.role === "user" && !includeUserMessages) return false;
      if (msg.role === "assistant" && !includeAssistantMessages) return false;
      return true;
    });

    // Now take the last N messages from the filtered set
    const filteredMessages = filteredByRole.slice(-messageCount);

    if (filteredMessages.length === 0) {
      return { success: false, filename, error: "No messages to export. Make sure there is assistant content before this message." };
    }

    // Build HTML content for the PDF
    let htmlContent = "";

    // Add title header if provided (separate from content)
    // Note: If the content already starts with a heading, consider not providing a title
    // to avoid duplication
    if (title) {
      htmlContent += `<div class="pdf-title">${escapeHtml(title)}</div>`;
      if (!hideDate) {
        const dateStr = new Date().toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
        });
        htmlContent += `<div class="pdf-date">${dateStr}</div>`;
      }
      htmlContent += `<hr style="margin: 8px 0; border: none; border-top: 1px solid #e5e7eb;">`;
    }

    // Process each message
    for (const message of filteredMessages) {
      const messageClass = isCleanMode ? "pdf-message clean-mode" : "pdf-message";
      htmlContent += `<div class="${messageClass}">`;

      // Role label - only show in non-clean mode
      if (!isCleanMode) {
        const roleClass = message.role === "user" ? "pdf-role-user" : "pdf-role-assistant";
        const roleText = message.role === "user" ? "YOU" : "ASSISTANT";
        htmlContent += `<div class="pdf-role-label ${roleClass}">${roleText}</div>`;
      }

      // Extract text content from message parts
      let textContent = "";
      if (message.parts) {
        for (const part of message.parts) {
          if (part.type === "text") {
            textContent += part.text;
          }
        }
      } else if (typeof message.content === "string") {
        textContent = message.content;
      }

      // Convert markdown to HTML using the same pipeline as the chat
      let contentHtml = await markdownToHtml(textContent);
      
      // If we added a title header, remove the first H1 from the content to avoid duplication
      // This handles cases where the markdown starts with "# Title" and we also set a title
      if (title) {
        contentHtml = contentHtml.replace(/^<h1[^>]*>.*?<\/h1>\s*/i, '');
      }
      
      htmlContent += `<div class="message-content">${contentHtml}</div>`;
      htmlContent += `</div>`;
    }

    // Fetch KaTeX CSS for math rendering
    let katexStyles = "";
    const katexCssLink = document.querySelector('link[href*="katex"]');
    if (katexCssLink) {
      try {
        const response = await fetch((katexCssLink as HTMLLinkElement).href);
        katexStyles = await response.text();
      } catch {
        // KaTeX will still render, just might not look perfect
      }
    }

    // Create an isolated iframe to avoid oklch color issues from the main page
    // A4 at 72 DPI = 595 x 842 points, with 40px margins = 515px content width
    const contentWidth = 515;
    const iframe = document.createElement("iframe");
    iframe.style.cssText = `
      position: absolute;
      left: -9999px;
      top: 0;
      width: ${contentWidth + 80}px;
      height: 20000px;
      border: none;
      background: white;
    `;
    document.body.appendChild(iframe);

    // Wait for iframe to be ready
    await new Promise(resolve => setTimeout(resolve, 50));

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
      throw new Error("Failed to create iframe for PDF rendering");
    }

    // Build the complete HTML document inside the iframe (isolated from main page CSS)
    iframeDoc.open();
    iframeDoc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            html, body { 
              margin: 0; 
              padding: 0; 
              background: white; 
              font-size: 10px;
            }
            ${PDF_STYLES}
            ${katexStyles}
          </style>
        </head>
        <body>
          <div class="pdf-export-container" style="width: ${contentWidth}px; padding: 0; margin: 0; background: white;">
            ${htmlContent}
          </div>
        </body>
      </html>
    `);
    iframeDoc.close();

    // Wait for content and fonts to render
    await new Promise(resolve => setTimeout(resolve, 200));

    // Get the container from the iframe
    const container = iframeDoc.querySelector(".pdf-export-container") as HTMLElement;
    if (!container) {
      throw new Error("Failed to find content container in iframe");
    }

    // Create PDF
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: "a4",
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 40;

    // Use html2canvas on the iframe content (now isolated from oklch colors)
    const html2canvasModule = await import("html2canvas");
    const html2canvas = html2canvasModule.default;

    // Add canvas to PDF, handling multiple pages properly
    const imgWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2 - 25; // Leave room for page numbers
    
    // Find natural break points in the content to avoid cutting text mid-line
    // We look for element boundaries and line boxes within text nodes.
    const breakableElements = container.querySelectorAll(
      "p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, table, tr, td, th, hr, .pdf-message, .katex-display"
    );
    
    // Build a list of potential break points (bottom edges of elements and lines)
    const breakPoints: number[] = [0]; // Always include start
    const containerRect = container.getBoundingClientRect();
    
    breakableElements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      // Get the bottom of this element relative to the container
      const bottom = rect.bottom - containerRect.top;
      if (bottom > 0) {
        breakPoints.push(bottom);
      }
    });
    
    // Add line-level break points for text to avoid cutting mid-line
    const textElements = container.querySelectorAll(
      "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, td, th"
    );
    
    textElements.forEach((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (!node.nodeValue || !node.nodeValue.trim()) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      
      let textNode: Node | null;
      while ((textNode = walker.nextNode())) {
        const range = document.createRange();
        range.selectNodeContents(textNode);
        const rects = range.getClientRects();
        for (const rect of Array.from(rects)) {
          const lineBottom = rect.bottom - containerRect.top;
          if (lineBottom > 0) {
            breakPoints.push(lineBottom);
          }
        }
        range.detach();
      }
    });
    
    // Get total content height
    const totalContentHeight = container.scrollHeight;
    breakPoints.push(totalContentHeight); // Ensure we have the end
    
    // Sort and dedupe break points
    breakPoints.sort((a, b) => a - b);
    const uniqueBreakPoints = [...new Set(breakPoints)];
    
    // Calculate page breaks that don't exceed usableHeight
    // Each entry is [startY, endY] in CSS pixels
    const pageSlices: Array<{ start: number; end: number }> = [];
    let currentPageStart = 0;
    
    while (currentPageStart < totalContentHeight) {
      // Find the best break point that fits within usableHeight from currentPageStart
      let bestBreak = currentPageStart;
      
      for (const bp of uniqueBreakPoints) {
        if (bp <= currentPageStart) continue;
        if (bp - currentPageStart <= usableHeight) {
          bestBreak = bp;
        } else {
          // This break point exceeds the page - stop looking
          break;
        }
      }
      
      // If no break point found (single element taller than page), force break
      if (bestBreak <= currentPageStart) {
        bestBreak = Math.min(currentPageStart + usableHeight, totalContentHeight);
      }
      
      pageSlices.push({ start: currentPageStart, end: bestBreak });
      currentPageStart = bestBreak;
    }
    
    // Ensure we have at least one page
    if (pageSlices.length === 0) {
      pageSlices.push({ start: 0, end: totalContentHeight });
    }
    
    // Render the FULL content once with html2canvas
    const scale = 2;
    const fullCanvas = await html2canvas(container, {
      scale: scale,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      windowWidth: contentWidth,
    });
    
    // Calculate scale factor from CSS pixels to canvas pixels
    const pxPerCss = fullCanvas.height / totalContentHeight;
    
    // Now slice the full canvas at the calculated break points
    for (let pageIdx = 0; pageIdx < pageSlices.length; pageIdx++) {
      if (pageIdx > 0) {
        pdf.addPage();
      }
      
      const slice = pageSlices[pageIdx];
      
      // Convert CSS pixel positions to canvas pixel positions
      const srcY = Math.round(slice.start * pxPerCss);
      const srcHeight = Math.round((slice.end - slice.start) * pxPerCss);
      
      if (srcHeight <= 0) continue;
      
      // Create a temporary canvas for this page's slice
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = fullCanvas.width;
      pageCanvas.height = srcHeight;
      const ctx = pageCanvas.getContext("2d");
      
      if (ctx) {
        // Fill with white background first
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        
        // Draw the slice of the full canvas
        ctx.drawImage(
          fullCanvas,
          0, srcY, fullCanvas.width, srcHeight,  // source rect
          0, 0, fullCanvas.width, srcHeight       // dest rect
        );
        
        const pageImgData = pageCanvas.toDataURL("image/png");
        const destHeight = (srcHeight / fullCanvas.width) * imgWidth;
        pdf.addImage(pageImgData, "PNG", margin, margin, imgWidth, destHeight);
      }
    }

    // Clean up iframe
    document.body.removeChild(iframe);

    // Add page numbers
    const totalPages = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);
      pdf.setFontSize(9);
      pdf.setTextColor(156, 163, 175);
      pdf.setFont("helvetica", "normal");
      pdf.text(
        `Page ${i} of ${totalPages}`,
        pageWidth / 2,
        pageHeight - 20,
        { align: "center" }
      );
    }

    // Generate blob for download
    const blob = pdf.output("blob");

    // Trigger download
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return { success: true, filename, blob };
  } catch (error) {
    console.error("PDF generation failed:", error);
    return {
      success: false,
      filename,
      error: error instanceof Error ? error.message : "Failed to generate PDF",
    };
  }
}

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
