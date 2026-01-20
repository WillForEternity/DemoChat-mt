/**
 * Auth Helper for API Routes
 *
 * Server-side utilities for checking authentication and owner status.
 * Use this in API routes to determine which API key to use.
 */

import { auth } from "./auth";
import { headers } from "next/headers";

export interface AuthContext {
  session: Awaited<ReturnType<typeof auth.api.getSession>> | null;
  isOwner: boolean;
  userEmail: string | null;
  isAuthenticated: boolean;
}

/**
 * Get authentication context for the current request.
 *
 * @returns AuthContext with session info and owner status
 *
 * Usage in API routes:
 * ```ts
 * const { isOwner, isAuthenticated } = await getAuthContext();
 * const apiKey = isOwner ? process.env.ANTHROPIC_API_KEY : userProvidedKey;
 * ```
 */
export async function getAuthContext(): Promise<AuthContext> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    // Parse owner emails from environment variable
    const ownerEmailsRaw = process.env.OWNER_EMAILS || "";
    const ownerEmails = ownerEmailsRaw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    // Get user email from session
    const userEmail = session?.user?.email?.toLowerCase() || null;

    // Check if user is an owner
    const isOwner = userEmail ? ownerEmails.includes(userEmail) : false;

    return {
      session,
      isOwner,
      userEmail,
      isAuthenticated: Boolean(session?.user),
    };
  } catch (error) {
    console.error("[Auth Helper] Error getting auth context:", error);
    return {
      session: null,
      isOwner: false,
      userEmail: null,
      isAuthenticated: false,
    };
  }
}

/**
 * Determine which API key to use based on auth context.
 *
 * @param isOwner - Whether the user is an owner
 * @param userProvidedKey - API key provided by the user (if any)
 * @param envKey - Environment variable API key
 * @param useFreeTrial - Whether the user is using the free trial (uses env key)
 * @returns The API key to use, or null if none available
 */
export function resolveApiKey(
  isOwner: boolean,
  userProvidedKey: string | undefined,
  envKey: string | undefined,
  useFreeTrial: boolean = false
): string | null {
  // Owners always use the environment key
  if (isOwner && envKey) {
    return envKey;
  }

  // Free trial users use the environment key
  if (useFreeTrial && envKey) {
    return envKey;
  }

  // Non-owners must provide their own key
  if (userProvidedKey) {
    return userProvidedKey;
  }

  // No key available
  return null;
}

/**
 * Create an error response for missing API key
 */
export function createApiKeyRequiredResponse(): Response {
  return new Response(
    JSON.stringify({
      error:
        "API key required. Please add your API key in settings, or sign in with an owner account.",
      code: "API_KEY_REQUIRED",
    }),
    {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }
  );
}
