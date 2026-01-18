/**
 * Web Search Tool
 *
 * Uses Anthropic's built-in web search capability to give Claude
 * real-time access to information from the internet.
 *
 * This is a first-party tool provided by Anthropic - Claude can
 * search the web just like the version in Cursor or Claude.ai.
 *
 * CONFIGURATION OPTIONS:
 * ----------------------
 * - maxUses: Limit searches per conversation (prevents runaway costs)
 * - allowedDomains: Restrict to specific trusted sources
 * - blockedDomains: Block specific sites from results
 * - userLocation: Provide location context for relevant results
 */

import { createAnthropic } from "@ai-sdk/anthropic";

/**
 * Creates the Anthropic web search tool.
 *
 * We use a factory function because the tool needs the API key
 * to be configured with the Anthropic provider.
 *
 * @param apiKey - Anthropic API key
 * @returns Configured web search tool
 */
export function createWebSearchTool(apiKey: string) {
  const anthropic = createAnthropic({ apiKey });

  return anthropic.tools.webSearch_20250305({
    // Limit to 5 searches per conversation to control costs
    maxUses: 5,

    // Optional: Restrict to trusted domains (uncomment to enable)
    // allowedDomains: ['docs.anthropic.com', 'sdk.vercel.ai', 'github.com'],

    // Optional: Block specific domains (uncomment to enable)
    // blockedDomains: ['spam-site.com'],

    // Optional: Provide user location for more relevant results
    // userLocation: {
    //   type: 'approximate',
    //   country: 'US',
    //   region: 'CA',
    //   city: 'San Francisco',
    //   timezone: 'America/Los_Angeles',
    // },
  });
}
