export type JSONSchemaType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "integer";

export interface JSONSchemaProperty {
  type: JSONSchemaType;
  description?: string;
  enum?: (string | number | boolean)[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface ChatToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, JSONSchemaProperty>;
    required?: string[];
  };
}

export interface ChatToolHandler<TContext = unknown> {
  (args: Record<string, unknown>, context: TContext): Promise<unknown>;
}

const toolDefinitions = new Map<string, ChatToolDefinition>();
const toolHandlers = new Map<string, ChatToolHandler<any>>();

export function registerTool<TContext = unknown>(
  appId: string,
  tool: ChatToolDefinition,
  handler: ChatToolHandler<TContext>
) {
  const fullName = `${appId}_${tool.name}`;
  if (toolDefinitions.has(fullName)) {
    throw new Error(`Tool ${fullName} is already registered`);
  }
  toolDefinitions.set(fullName, { ...tool, name: fullName });
  toolHandlers.set(fullName, handler);
}

export function getToolsForSession(_userId: string): ChatToolDefinition[] {
  // TODO: Filter by user's installed apps
  return Array.from(toolDefinitions.values());
}

export function getToolDefinition(name: string): ChatToolDefinition | undefined {
  return toolDefinitions.get(name);
}

export async function executeTool<TContext>(
  name: string,
  args: Record<string, unknown>,
  context: TContext
): Promise<unknown> {
  const handler = toolHandlers.get(name);
  if (!handler) {
    throw new Error(`Tool ${name} not found`);
  }
  return handler(args, context);
}

export function unregisterAppTools(appId: string) {
  for (const [name] of toolDefinitions) {
    if (name.startsWith(`${appId}_`)) {
      toolDefinitions.delete(name);
      toolHandlers.delete(name);
    }
  }
}
