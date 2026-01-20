/**
 * Check Owner Status API Route
 *
 * Returns whether the current authenticated user is an owner.
 * Used by the client to determine UI elements like free trial status.
 */

import { getAuthContext } from "@/lib/auth-helper";

export async function GET() {
  try {
    const { isOwner, isAuthenticated } = await getAuthContext();

    return new Response(
      JSON.stringify({
        isOwner,
        isAuthenticated,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[Check Owner API] Error:", error);
    return new Response(
      JSON.stringify({
        isOwner: false,
        isAuthenticated: false,
        error: "Failed to check owner status",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
