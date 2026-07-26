import type { EmbeddedRunAttemptParams } from "openclaw/plugin-sdk/agent-harness-runtime";
import type {
  CodexDynamicToolCallParams,
  CodexDynamicToolFunctionSpec,
  CodexDynamicToolSpec,
  JsonValue,
} from "./protocol.js";

type ClientToolCall = {
  name: string;
  params: Record<string, unknown>;
};

const CODEX_DYNAMIC_TOOL_NAME = /^[a-zA-Z0-9_-]{1,128}$/u;

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toClientToolSpec(
  tool: NonNullable<EmbeddedRunAttemptParams["clientTools"]>[number],
): CodexDynamicToolFunctionSpec {
  const name = tool.function.name.trim();
  if (!CODEX_DYNAMIC_TOOL_NAME.test(name)) {
    throw new Error(`Invalid Codex client tool name: ${name || "(empty)"}`);
  }
  return {
    type: "function",
    name,
    description: tool.function.description?.trim() || `Caller-owned function ${name}`,
    inputSchema: (tool.function.parameters ?? {
      type: "object",
      properties: {},
      additionalProperties: false,
    }) as JsonValue,
    deferLoading: false,
  };
}

/**
 * Owns caller-provided functions for one native Codex attempt. These functions
 * are advertised to Codex but are delegated back to the HTTP caller, never
 * executed by OpenClaw.
 */
export function createCodexClientToolDelegation(params: {
  clientTools: EmbeddedRunAttemptParams["clientTools"];
  reservedSpecs: readonly CodexDynamicToolSpec[];
}) {
  const reservedNames = new Set(
    params.reservedSpecs.flatMap((spec) =>
      spec.type === "namespace" ? [spec.name, ...spec.tools.map((tool) => tool.name)] : [spec.name],
    ),
  );
  const specs = (params.clientTools ?? []).map(toClientToolSpec);
  const toolsByName = new Map<string, CodexDynamicToolFunctionSpec>();
  for (const spec of specs) {
    if (reservedNames.has(spec.name) || toolsByName.has(spec.name)) {
      throw new Error(`Client tool name conflicts with an existing Codex tool: ${spec.name}`);
    }
    toolsByName.set(spec.name, spec);
  }

  const callsById = new Map<string, ClientToolCall>();
  return {
    specs,
    matches(call: CodexDynamicToolCallParams): boolean {
      return call.namespace == null && toolsByName.has(call.tool);
    },
    record(call: CodexDynamicToolCallParams): ClientToolCall {
      const existing = callsById.get(call.callId);
      if (existing) {
        return existing;
      }
      if (!isJsonObject(call.arguments)) {
        throw new Error(`Codex client tool arguments must be an object: ${call.tool}`);
      }
      const recorded = {
        name: call.tool,
        params: { ...call.arguments },
      };
      callsById.set(call.callId, recorded);
      return recorded;
    },
    snapshot(): ClientToolCall[] {
      return [...callsById.values()].map((call) => ({
        name: call.name,
        params: { ...call.params },
      }));
    },
  };
}

export type CodexClientToolDelegation = ReturnType<typeof createCodexClientToolDelegation>;
