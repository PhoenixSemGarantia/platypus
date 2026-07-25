---
name: tools
description: Guide for Platypus tools and tool sets - covers creating, updating, sharing, and registering tools, frontend icon mapping, custom UI, and architecture. Always load this skill when the user mentions tools or tool sets.
---

# Platypus Tools Guide

This guide explains how tools and tool sets work in Platypus, and how to add, update, or share tools that AI agents use during chat sessions.

---

## Overview

Tools in Platypus are defined using the AI SDK's `tool()` function with three components:

- **description**: What the tool does (helps AI decide when to invoke it)
- **inputSchema**: Zod schema defining parameters with descriptions
- **execute**: Async function that performs the operation

---

## Step 1: Create Backend Tool Definition

### File Location

Create a new file in `/apps/backend/src/tools/` or add to an existing category file.

### Tool Structure

```typescript
import { tool } from "ai";
import { z } from "zod";

export const yourToolName = tool({
  description: "Clear description of what this tool does",
  inputSchema: z.object({
    parameterName: z.string().describe("Description for AI context"),
    optionalParam: z.number().optional().describe("Optional parameter"),
  }),
  execute: async ({ parameterName, optionalParam }) => {
    // Implement your logic here
    const result = performOperation(parameterName, optionalParam);

    // Return results as an object
    return { result };
  },
});
```

### Real Example: Temperature Conversion

```typescript
// apps/backend/src/tools/math.ts
export const convertFahrenheitToCelsius = tool({
  description: "Convert temperature from Fahrenheit to Celsius",
  inputSchema: z.object({
    temperature: z.number().describe("Temperature in Fahrenheit"),
  }),
  execute: async ({ temperature }) => {
    const celsius = Math.round((temperature - 32) * (5 / 9));
    return { celsius };
  },
});
```

### Tool Best Practices

1. **Descriptive names**: Use clear, action-oriented names (e.g., `getCurrentTime`, not `time`)
2. **Rich descriptions**: Help the AI understand when to use the tool
3. **Parameter descriptions**: Use `.describe()` on each schema field
4. **Error handling**: Wrap logic in try-catch and return error objects
5. **Return objects**: Always return structured data, not primitives

---

## Step 2: Register Tool in Tool Set

### File Location

Edit `/apps/backend/src/tools/index.ts`

### Registration Pattern

```typescript
import { yourToolName, anotherTool } from "./your-file.ts";

// Register a new tool set
registerToolSet("tool-set-id", {
  name: "Display Name",
  category: "Category Name",
  description: "Optional description of the tool set",
  tools: {
    yourToolName,
    anotherTool,
  },
});
```

### Real Example: Time Tools

```typescript
// apps/backend/src/tools/index.ts
import { getCurrentTime, convertTimezone } from "./time.ts";

registerToolSet("time", {
  name: "Time",
  category: "Utilities",
  description:
    "Tools for getting current time and converting between timezones",
  tools: {
    getCurrentTime,
    convertTimezone,
  },
});
```

### Tool Set Guidelines

- **ID**: Use kebab-case (e.g., `math-conversions`, `time`)
- **Category**: Groups tool sets in UI (e.g., "Math", "Utilities")
- **Related tools**: Group related functionality in one tool set
- **Description**: Optional but helpful for users selecting tools

---

## Step 3: Set the Chat UI Icon for Your Tool Set

When tools execute in the chat, each tool displays an icon based on its owning tool set. By default, unrecognised tools show a wrench icon. To show a custom icon you must update two maps in `/apps/frontend/components/ai-elements/tool.tsx`:

### 1. Map tool names → tool set ID

Add every tool name exported by your tool set to the `toolToToolSet` lookup:

```typescript
// apps/frontend/components/ai-elements/tool.tsx
const toolToToolSet: Record<string, string> = {
  // ... existing entries
  // currency
  convertCurrency: "currency",
};
```

**Important**: Every tool must have an entry here. If a tool appears in multiple tool sets, map it to the most semantically fitting one — the icon displays correctly regardless of which tool set provided it at runtime.

### 2. Map tool set ID → icon

Add an entry to `toolSetIcons` with a Lucide icon import:

```typescript
import { CoinsIcon } from "lucide-react";

const toolSetIcons: Record<string, LucideIcon> = {
  // ... existing entries
  currency: CoinsIcon,
};
```

### Where Tools Appear

1. **Agent Creation/Edit Form**
   - Tools grouped by category
   - 2-column grid with toggle switches
   - Shows name and description

2. **Agent List View**
   - Shows tool count with wrench icon
   - Hover to see tool set names

3. **Agent Info Dialog**
   - Displays assigned tools as badges

4. **Chat Interface**
   - Real-time tool execution display
   - Status indicators (pending, running, completed, error)
   - Input/output JSON rendering
   - Tool set icon shown next to tool name (configured above)

### Tool Display Example

When you register `math-conversions` tool set:

- **Category**: "Math"
- **Display**: "Math Conversions" with description
- **Assignment**: Users toggle switch to assign to agents
- **Chat**: Shows "convertFahrenheitToCelsius" executing during chat with the tool set icon

---

## Step 4: Test Your Tool

### 1. Restart Backend

```bash
# Stop current dev server (Ctrl+C)
pnpm dev
```

### 2. Create Test Agent

1. Navigate to workspace
2. Click "Create Agent"
3. Enable your new tool set
4. Save agent

### 3. Test in Chat

Start a chat and ask the agent to use your tool:

```
User: "Convert 75 Fahrenheit to Celsius"
Agent: [Uses convertFahrenheitToCelsius tool]
Result: { "celsius": 24 }
```

### 4. Run Tests

Tests are co-located with tool files at `apps/backend/src/tools/*.test.ts`:

```bash
pnpm --filter backend test
```

---

## Advanced Patterns

### 1. Dynamic/Workspace-Scoped Tools

For tools that need workspace or agent context, use a factory function and register with `tools` as a function instead of an object.

The `tools` property on `registerToolSet` accepts either a static object or a function receiving a `ToolSetContext`. Use the function form when tools need runtime context. Check `apps/backend/src/tools/index.ts` for the `ToolSetContext` type definition — it includes fields like `workspaceId`, `agentId`, `orgId`, `frontendUrl`, and `userId`.

**Pattern:** Create a `createYourTools(...)` factory function in your tool file that accepts the context fields it needs and returns `Record<string, Tool>`. Then in `index.ts`, register with `tools: (ctx) => createYourTools(ctx.workspaceId, ...)`. See existing dynamic tool sets (kanban, agent-management, triggers, etc.) for real examples.

### 2. Sharing Tools Across Tool Sets

To reuse a tool in multiple tool sets, extract it into a **standalone exported factory function** in its primary file that returns a single `Tool`. Other tool set factories can then import and call it.

**Pattern:**

1. In the tool's primary file, export a `create<ToolName>Tool(...)` factory that returns a `Tool`.
2. The primary tool set's factory calls the standalone factory internally.
3. Other tool set files import the standalone factory and include the result in their returned tools object.
4. Use the **same key name** in every tool set so runtime deduplication works — `loadTools()` in `chat-execution.ts` uses `Object.assign()`, so identical keys naturally deduplicate.

### 3. Tools with Database Access

Import the shared `db` instance and table schemas following the pattern used by existing tools. Check any existing tool file (e.g., `agent-management.ts`, `kanban.ts`) for the correct import paths — they use Drizzle ORM for queries.

### 4. Tools with External API Calls

Use standard `fetch()` inside the `execute` function. Always wrap in try-catch and return `{ error: "..." }` on failure. See `apps/backend/src/tools/fetch.ts` for a real example.

### 5. Custom Tool UI Components (Optional)

By default, tools display input/output as formatted JSON. For better UX, you can create custom React components.

**When to use custom UI:**

- Interactive elements (buttons, clickable suggestions)
- Special formatting (images, charts, structured data)
- User interaction during execution

**How it works:**

The `ChatMessage` component in `apps/frontend/components/chat-message.tsx` checks tool part types. Named tool types (e.g. `tool-loadSkill`) are matched with specific components before the generic `tool-*` fallback renders JSON. Read the file to see the current conditional rendering chain.

**Steps to add custom tool UI:**

1. **Create component** in `/apps/frontend/components/your-tool.tsx`
2. **Add the tool to `CustomUITools`** in `apps/backend/src/types.ts`. That type
   enumerates only the tools with bespoke UI — being listed there is what gives
   your tool part real `input`/`output` types instead of `unknown`.
3. **Add conditional rendering** in `chat-message.tsx` (before the generic `tool-*` fallback):
   ```typescript
   else if (part.type === "tool-yourToolName") {
     return <YourToolComponent toolPart={part} />;
   }
   ```
   No cast is needed — matching the literal `type` narrows the part. The generic
   fallback branches use the `isToolUIPart` guard from `ai`, since plugin- and
   MCP-contributed tools aren't known at compile time.
4. **Import component** at top of `chat-message.tsx`
5. **Handle tool states**: `input-streaming`, `input-available`, `output-available`, `output-error`

**Existing custom tool components** (check `apps/frontend/components/` for current list):

- `load-skill-tool.tsx` - Skill loading status display
- `sub-agent-tool.tsx` - Sub-agent delegation with nested chat

---

## Tool Categories Reference

Check `apps/backend/src/tools/index.ts` for the current list of categories used in `registerToolSet` calls. Choose an existing category or create a new one as needed.

---

## Tool Set vs Individual Tools

**Tool Set**: A collection of related tools registered together

- Example: `math-conversions` contains `convertTemperature`, `convertDistance`, `convertWeight`, and `convertVolume`

**Individual Tool**: A single executable function

- Example: `convertTemperature` is one tool within the set

**Sharing**: A single tool can appear in multiple tool sets via standalone factory functions (see "Sharing Tools Across Tool Sets" above).

**Assignment**: Agents are assigned entire tool sets, not individual tools.

---

## Troubleshooting

### Tool Not Appearing in UI

1. Check tool set is registered in `/apps/backend/src/tools/index.ts`
2. Verify no registration errors (duplicate IDs throw errors)
3. Restart backend server
4. Check browser console for API errors

### Tool Not Executing

1. Verify agent has tool set assigned (`agent.toolSetIds`)
2. Check tool description is clear for AI to understand when to use it
3. Review parameter descriptions in `inputSchema`
4. Check backend logs for execution errors

### Tool Returning Errors

1. Add error handling in `execute` function
2. Return error objects: `{ error: "Error message" }`
3. Check parameter validation (Zod schema)
4. Review backend logs for stack traces

---

## Complete Example: Adding a Currency Converter

### 1. Create Tool File

```typescript
// apps/backend/src/tools/currency.ts
import { tool } from "ai";
import { z } from "zod";

export const convertCurrency = tool({
  description:
    "Convert amount from one currency to another using live exchange rates",
  inputSchema: z.object({
    amount: z.number().describe("Amount to convert"),
    from: z.string().describe("Source currency code (e.g., USD)"),
    to: z.string().describe("Target currency code (e.g., EUR)"),
  }),
  execute: async ({ amount, from, to }) => {
    try {
      // Example: Call exchange rate API
      const rate = await fetchExchangeRate(from, to);
      const converted = amount * rate;

      return {
        original: { amount, currency: from },
        converted: { amount: converted, currency: to },
        rate,
      };
    } catch (error) {
      return { error: "Failed to convert currency" };
    }
  },
});

async function fetchExchangeRate(from: string, to: string): Promise<number> {
  // Implementation details
  return 1.09; // Example rate
}
```

### 2. Register Tool Set

```typescript
// apps/backend/src/tools/index.ts
import { convertCurrency } from "./currency.ts";

registerToolSet("currency", {
  name: "Currency Converter",
  category: "Finance",
  description: "Convert between different currencies using live rates",
  tools: {
    convertCurrency,
  },
});
```

### 3. Set Chat UI Icon

```typescript
// apps/frontend/components/ai-elements/tool.tsx
import { CoinsIcon } from "lucide-react";

// Add to toolToToolSet:
const toolToToolSet: Record<string, string> = {
  // ... existing entries
  convertCurrency: "currency",
};

// Add to toolSetIcons:
const toolSetIcons: Record<string, LucideIcon> = {
  // ... existing entries
  currency: CoinsIcon,
};
```

### 4. Test

```bash
pnpm dev
```

Create an agent, enable "Currency Converter", and test:

```
User: "How much is 100 USD in EUR?"
Agent: [Uses convertCurrency tool]
Result: { "converted": { "amount": 109, "currency": "EUR" }, "rate": 1.09 }
```

---

## Key Files Reference

| File                                            | Purpose                                                |
| ----------------------------------------------- | ------------------------------------------------------ |
| `apps/backend/src/tools/index.ts`               | Tool set registry and registration                     |
| `apps/backend/src/tools/*.ts`                   | Individual tool implementations                        |
| `apps/backend/src/tools/*.test.ts`              | Co-located tool tests                                  |
| `apps/backend/src/services/chat-execution.ts`   | Tool loading (`loadTools`) and execution logic         |
| `apps/backend/src/routes/tool.ts`               | API endpoint for listing tools                         |
| `packages/schemas/index.ts`                     | ToolSet and Tool schemas                               |
| `apps/frontend/components/agent-form.tsx`       | Tool assignment UI                                     |
| `apps/frontend/components/chat-message.tsx`     | Tool rendering logic and custom component routing      |
| `apps/frontend/components/ai-elements/tool.tsx` | Default tool display, icon mapping, and toolset lookup |
| `apps/frontend/components/load-skill-tool.tsx`  | Custom UI for skill loading tool                       |
| `apps/frontend/components/sub-agent-tool.tsx`   | Custom UI for sub-agent delegation tool                |

---

## Next Steps

After adding your tool:

1. Consider writing tests co-located at `apps/backend/src/tools/your-tool.test.ts`
2. Document complex tools with JSDoc comments
3. Create custom frontend UI if needed (see "Advanced Patterns" section above)
   - Reference `load-skill-tool.tsx` for status display examples
   - Reference `sub-agent-tool.tsx` for nested interaction examples

---

## Resources

- [AI SDK Tools Documentation](https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling)
- [Zod Schema Documentation](https://zod.dev)
- Platypus examples: `/apps/backend/src/tools/`
