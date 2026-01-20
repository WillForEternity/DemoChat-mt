/**
 * Better Auth Server Configuration
 *
 * This file configures Better Auth with GitHub and Google OAuth providers.
 * It runs on the server side and handles authentication requests.
 *
 * SETUP REQUIRED:
 * ---------------
 * 1. Create a GitHub OAuth App at: https://github.com/settings/developers
 *    - Set callback URL to: http://localhost:3000/api/auth/callback/github
 *
 * 2. Create a Google OAuth App at: https://console.cloud.google.com/apis/credentials
 *    - Set callback URL to: http://localhost:3000/api/auth/callback/google
 *
 * 3. Add the following to your .env.local:
 *    BETTER_AUTH_SECRET=your-random-32-char-secret
 *    BETTER_AUTH_URL=http://localhost:3000
 *    GITHUB_CLIENT_ID=your-github-client-id
 *    GITHUB_CLIENT_SECRET=your-github-client-secret
 *    GOOGLE_CLIENT_ID=your-google-client-id
 *    GOOGLE_CLIENT_SECRET=your-google-client-secret
 *    OWNER_EMAILS=your@email.com,another@email.com
 */

import { betterAuth } from "better-auth";

// Determine the base URL
const baseURL = process.env.BETTER_AUTH_URL || "http://localhost:3000";

export const auth = betterAuth({
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,

  // Trust the base URL origin for redirects
  trustedOrigins: [baseURL],

  // Social OAuth providers
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    },
  },

  // Use cookies for session management (stateless JWT)
  session: {
    // Session expires after 30 days
    expiresIn: 60 * 60 * 24 * 30,
    // Update session if it's about to expire in 7 days
    updateAge: 60 * 60 * 24 * 7,
  },
});
