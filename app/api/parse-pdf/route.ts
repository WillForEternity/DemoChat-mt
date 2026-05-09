/**
 * Parse PDF API Route
 *
 * Extracts text from scanned/image-based PDFs using Gemini 2.5 Flash's
 * native PDF understanding. Called when client-side PDF.js extraction
 * fails to produce meaningful text (scanned documents, image-heavy PDFs).
 *
 * Phase 1 (provider swap): switched provider to Google Gemini 2.5 Flash.
 * Phase 2 (hardening): size guard, MIME guard, per-user rate limit, daily
 *   free-trial token budget, and structured error responses.
 * Phase 4 (parallel + streaming): accepts pageStart/pageEnd form fields
 *   for logging, returns a text stream via the AI SDK.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText } from "ai";
import { getAuthContext, resolveApiKey, createApiKeyRequiredResponse } from "@/lib/auth-helper";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkBudget, recordUsage } from "@/lib/budget";

// Phase 4 chunks the document into ≤5-page sub-PDFs, each well under 60s.
export const maxDuration = 60;

const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB

type ErrorCode =
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "RATE_LIMITED"
  | "BUDGET_EXCEEDED"
  | "UPSTREAM_ERROR"
  | "BAD_REQUEST"
  | "API_KEY_REQUIRED";

function errorResponse(code: ErrorCode, message: string, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
  });
}

export async function POST(req: Request) {
  try {
    // Quick size check via Content-Length before reading the body into memory.
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > 0 && contentLength > MAX_PDF_BYTES) {
      return errorResponse(
        "PAYLOAD_TOO_LARGE",
        `PDF exceeds ${MAX_PDF_BYTES / (1024 * 1024)} MB limit`,
        413,
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const userKey = formData.get("apiKey") as string | null;
    const useFreeTrial = formData.get("useFreeTrial") === "true";
    const pageStart = formData.get("pageStart");
    const pageEnd = formData.get("pageEnd");

    if (!file) {
      return errorResponse("BAD_REQUEST", "PDF file required", 400);
    }
    if (file.type !== "application/pdf") {
      return errorResponse("UNSUPPORTED_TYPE", "file must be application/pdf", 415);
    }
    if (file.size > MAX_PDF_BYTES) {
      return errorResponse(
        "PAYLOAD_TOO_LARGE",
        `PDF exceeds ${MAX_PDF_BYTES / (1024 * 1024)} MB limit`,
        413,
      );
    }

    const { isOwner, userEmail } = await getAuthContext();

    // Per-user rate limit (Upstash). Owner accounts are exempt.
    if (!isOwner) {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
      const rateKey = userEmail ?? `ip:${ip}`;
      const rl = await checkRateLimit(rateKey);
      if (!rl.success) {
        return errorResponse("RATE_LIMITED", "Too many requests", 429, {
          "Retry-After": String(Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000))),
        });
      }
    }

    const apiKey = resolveApiKey(
      isOwner,
      userKey ?? undefined,
      process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      useFreeTrial,
    );
    if (!apiKey) {
      return createApiKeyRequiredResponse();
    }

    // Free-trial users are subject to a daily token budget.
    if (useFreeTrial && !isOwner) {
      const budgetKey = userEmail ?? `ip:${req.headers.get("x-forwarded-for") ?? "unknown"}`;
      const ok = await checkBudget(budgetKey);
      if (!ok) {
        return errorResponse(
          "BUDGET_EXCEEDED",
          "Daily free-trial token budget exhausted. Provide your own API key or wait 24h.",
          429,
        );
      }
    }

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const google = createGoogleGenerativeAI({ apiKey });

    const result = streamText({
      model: google("gemini-2.5-flash"),
      temperature: 0,
      maxRetries: 3,
      maxOutputTokens: 65536,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "file",
              data: bytes,
              mediaType: "application/pdf",
            },
            {
              type: "text",
              text: "Extract all text content from this PDF document. Return only the extracted text, preserving the original structure (headings, paragraphs, lists, etc.) as much as possible. Do not add any commentary, explanations, or formatting instructions - just the raw extracted text.",
            },
          ],
        },
      ],
      onFinish: async ({ usage }) => {
        const total = usage?.totalTokens ?? 0;
        const range = pageStart && pageEnd ? ` pages=${pageStart}-${pageEnd}` : "";
        console.log(`[Parse PDF] gemini-2.5-flash usage tokens=${total}${range}`);
        if (useFreeTrial && !isOwner && total > 0) {
          const budgetKey = userEmail ?? `ip:${req.headers.get("x-forwarded-for") ?? "unknown"}`;
          try {
            await recordUsage(budgetKey, total);
          } catch (err) {
            console.error("[Parse PDF] recordUsage failed:", err);
          }
        }
      },
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error("[Parse PDF API] Error:", error);
    return errorResponse(
      "UPSTREAM_ERROR",
      error instanceof Error ? error.message : "PDF parsing failed",
      500,
    );
  }
}
