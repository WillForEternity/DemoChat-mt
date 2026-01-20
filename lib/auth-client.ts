/**
 * Better Auth Client
 *
 * This file provides the client-side auth utilities for React components.
 * Use this to trigger sign in/out and access session state.
 *
 * Usage:
 *   import { authClient } from "@/lib/auth-client";
 *
 *   // Sign in with Google
 *   await authClient.signIn.social({ provider: "google", callbackURL: "/" });
 *
 *   // Sign in with GitHub
 *   await authClient.signIn.social({ provider: "github", callbackURL: "/" });
 *
 *   // Sign out
 *   await authClient.signOut();
 *
 *   // Get session (React hook)
 *   const { data: session, isPending } = authClient.useSession();
 */

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // Use relative URL so it works in both dev and production
  baseURL: typeof window !== "undefined" ? window.location.origin : "",
});

// Export convenience hooks and methods
export const { signIn, signOut, useSession } = authClient;
