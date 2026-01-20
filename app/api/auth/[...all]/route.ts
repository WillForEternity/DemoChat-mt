/**
 * Better Auth API Route Handler
 *
 * This catch-all route handles all authentication requests:
 * - /api/auth/signin/* - OAuth sign-in flows
 * - /api/auth/callback/* - OAuth callbacks
 * - /api/auth/signout - Sign out
 * - /api/auth/session - Get current session
 */

import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
