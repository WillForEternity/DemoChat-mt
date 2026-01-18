/**
 * Context Saver Agent - A specialized parallel agent for organizing and saving context
 *
 * This agent runs asynchronously in the background when the main chat agent
 * calls `save_to_context`. It makes intelligent decisions about:
 * - How to organize the information (file paths, folder structure)
 * - Whether to create new files or append to existing ones
 * - How to structure the content in markdown format
 *
 * The agent streams its "thinking" to the UI so users can see what it's doing.
 *
 * AI SDK v6 ARCHITECTURE NOTE:
 * ----------------------------
 * We DON'T use ToolLoopAgent here because the kb_* tools need to execute
 * client-side (IndexedDB). ToolLoopAgent requires tools to have server-side
 * execute functions to continue the loop, which doesn't work for client-side tools.
 *
 * Instead, we export the config for use with streamText. The client handles
 * tool execution and can drive multi-step logic if needed via addToolOutput.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { tool } from "ai";
import { z } from "zod";

// =============================================================================
// CONTEXT SAVER TOOLS
// =============================================================================

// These tools are defined here but executed client-side via tool outputs
// The API route will receive tool calls and the client will execute them

export const contextSaverTools = {
  kb_list: tool({
    description: "List contents of a folder in the knowledge base. Returns an array of file and folder names.",
    inputSchema: z.object({
      path: z.string().describe("Folder path, e.g. 'projects' or 'about-me'. Use '/' for root."),
    }),
  }),

  kb_read: tool({
    description: "Read the contents of a file in the knowledge base. Returns the file content as a string.",
    inputSchema: z.object({
      path: z.string().describe("File path, e.g. 'projects/ideas.md' or 'about-me/background.md'"),
    }),
  }),

  kb_write: tool({
    description: "Create or overwrite a file in the knowledge base. Parent folders are created automatically.",
    inputSchema: z.object({
      path: z.string().describe("File path to write, e.g. 'projects/new-idea.md'"),
      content: z.string().describe("Content to write to the file"),
    }),
  }),

  kb_append: tool({
    description: "Append content to a file in the knowledge base. Creates the file if it doesn't exist.",
    inputSchema: z.object({
      path: z.string().describe("File path to append to"),
      content: z.string().describe("Content to append (a newline is added before if needed)"),
    }),
  }),

  kb_mkdir: tool({
    description: "Create a folder in the knowledge base. Parent folders are created automatically.",
    inputSchema: z.object({
      path: z.string().describe("Folder path to create, e.g. 'projects/work' or 'preferences'"),
    }),
  }),
};

// =============================================================================
// AGENT CONFIGURATION
// =============================================================================

/**
 * Get the model and system prompt for the Context Saver.
 * Used by the API route with streamText instead of ToolLoopAgent.
 *
 * CONTEXT ENGINEERING: Uses XML structure at top per research best practices.
 *
 * @param apiKey - Anthropic API key
 * @param rootFolders - Current root folders in the Knowledge Base
 * @returns { model, system } for use with streamText
 */
export function getContextSaverConfig(
  apiKey: string,
  rootFolders: string[] = []
) {
  const anthropic = createAnthropic({ apiKey });
  // Use a faster/cheaper model for background tasks
  const modelName = process.env.CONTEXT_SAVER_MODEL || "claude-sonnet-4-5";

  // Build XML-structured folder list (data at top per context engineering research)
  const folderXml =
    rootFolders.length > 0
      ? rootFolders.map((f) => `<folder name="${f}" />`).join("\n")
      : "<empty>No folders yet</empty>";

  // ==========================================================================
  // SYSTEM PROMPT - Context Engineering Structure
  // ==========================================================================
  // Data/context at TOP improves retrieval accuracy
  // XML tags improve long-context performance
  // ==========================================================================

  const system = `<knowledge_base_state>
<root_folders>
${folderXml}
</root_folders>
</knowledge_base_state>

<assistant_role>
You are a Context Saver assistant. Your job is to organize and save information to the user's Knowledge Base efficiently.
</assistant_role>

<instructions>
## Available Tools

- \`kb_write(path, content)\` - Create or overwrite a file
- \`kb_append(path, content)\` - Append to a file
- \`kb_mkdir(path)\` - Create a folder

## CRITICAL: Single-Step Saving

You must save the information in a SINGLE response. Do NOT call kb_list or kb_read first.
Based on the root folders shown in <knowledge_base_state> above, decide immediately where to save and call kb_write or kb_append.

## Instructions

1. Analyze the information and determine the best file path
2. Call kb_write (for new files) or kb_append (to add to existing files)
3. Write a brief confirmation of what you saved

## Organization Guidelines

- Use clear folder names: \`about-me/\`, \`projects/\`, \`work/\`, \`preferences/\`, \`notes/\`
- Use descriptive file names: \`background.md\`, \`skills.md\`, \`current-projects.md\`
- Use \`.md\` extension for all files
- Format content with markdown: headers, lists, bold for emphasis

## Example

User: "Save this: User works at Google as a software engineer"
You: "Saving to about-me/work.md"
[call kb_write with path="about-me/work.md" and formatted content]

Be efficient. Just save and confirm.
</instructions>`;

  return {
    model: anthropic(modelName),
    system,
    tools: contextSaverTools,
  };
}

// Legacy export for backwards compatibility
export function createContextSaverAgent(
  apiKey: string,
  rootFolders: string[] = [],
  _information?: string,
  _context?: string
) {
  // Return the config - the route now uses streamText directly
  return getContextSaverConfig(apiKey, rootFolders);
}
