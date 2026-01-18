/**
 * Save to Context Tool
 *
 * This tool allows the main chat agent to delegate saving information
 * to a parallel Context Saver agent. When called:
 *
 * 1. A unique taskId is generated
 * 2. The tool returns immediately so the main agent can continue
 * 3. A background request spawns the Context Saver agent
 * 4. The UI shows the agent's streaming "thinking" as it saves
 *
 * This tool is executed client-side - the actual agent spawning
 * happens in the handleToolCall callback in ai-chat.tsx.
 */

import { tool } from "ai";
import { z } from "zod";

export const saveToContextTool = tool({
  description: `Spawn a parallel background agent to save ONE category of information to the knowledge base. 

CALL THIS MULTIPLE TIMES for different categories - each call runs in parallel! The UI shows an orchestrator tracking all spawned agents.

Examples of good parallel usage:
- Personal info → one call
- Work/job info → another call  
- Preferences → another call
- Each project → separate calls

Each agent organizes and saves its piece independently. This is faster and creates cleaner organization than bundling everything together.`,
  inputSchema: z.object({
    information: z
      .string()
      .describe(
        "ONE focused piece of information to save. Keep it to a single category/topic. Example: 'User works at Google as a software engineer on distributed systems team, started 2022.'"
      ),
    context: z
      .string()
      .optional()
      .describe(
        "Category hint for organization: 'personal', 'work', 'preferences', 'projects', 'skills', etc."
      ),
  }),
});

export default saveToContextTool;
