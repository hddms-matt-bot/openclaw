import { describe, expect, it } from "vitest";
import { createCodexClientToolDelegation } from "./client-tool-delegation.js";

function createDelegation() {
  return createCodexClientToolDelegation({
    clientTools: [
      {
        type: "function",
        function: {
          name: "submit_probe_result",
          description: "Submit a result.",
          parameters: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
            additionalProperties: false,
          },
        },
      },
    ],
    reservedSpecs: [],
  });
}

describe("Codex client tool delegation", () => {
  it("advertises caller schemas and records calls idempotently in source order", () => {
    const delegation = createDelegation();
    expect(delegation.specs).toEqual([
      {
        type: "function",
        name: "submit_probe_result",
        description: "Submit a result.",
        inputSchema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
        deferLoading: false,
      },
    ]);

    const call = {
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-1",
      namespace: null,
      tool: "submit_probe_result",
      arguments: { ok: true },
    };
    expect(delegation.matches(call)).toBe(true);
    delegation.record(call);
    delegation.record(call);
    expect(delegation.snapshot()).toEqual([{ name: "submit_probe_result", params: { ok: true } }]);
  });

  it("does not claim namespaced OpenClaw-owned tool calls", () => {
    const delegation = createDelegation();
    expect(
      delegation.matches({
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-1",
        namespace: "openclaw",
        tool: "submit_probe_result",
        arguments: { ok: true },
      }),
    ).toBe(false);
  });

  it("rejects collisions with existing functions or namespaces", () => {
    expect(() =>
      createCodexClientToolDelegation({
        clientTools: [
          {
            type: "function",
            function: { name: "openclaw", parameters: { type: "object" } },
          },
        ],
        reservedSpecs: [
          {
            type: "namespace",
            name: "openclaw",
            description: "OpenClaw tools",
            tools: [],
          },
        ],
      }),
    ).toThrow("Client tool name conflicts with an existing Codex tool: openclaw");
  });
});
