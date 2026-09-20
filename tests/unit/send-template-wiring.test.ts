import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { AGENT_TOOL_DEFS } from "@/lib/agent-engine/agent/inbound-turn";

/**
 * O canal continua oferecendo templates ao atendente humano. O Conversador,
 * porém, não pode receber valores produzidos pelo modelo: isso seria uma porta
 * de texto livre paralela à biblioteca de respostas aprovadas.
 */
describe("send_template — indisponivel ao Conversador", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"),
    "utf8",
  );

  it("nao aparece no contrato estatico das tools", () => {
    expect("send_template" in AGENT_TOOL_DEFS).toBe(false);
  });

  it("nao possui execute no turno", () => {
    expect(source).not.toContain("send_template: tool({");
    expect(source).not.toContain("AGENT_TOOL_DEFS.send_template");
  });

  it("mantem send_message como unica porta de fala e sem body", () => {
    expect(AGENT_TOOL_DEFS.send_message.inputSchema.safeParse({ body: "livre" }).success).toBe(
      false,
    );
    expect(
      AGENT_TOOL_DEFS.send_message.inputSchema.safeParse({
        reply_id: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(true);
  });

  it("janela fechada termina em handoff, sem reabrir texto parametrizado", () => {
    expect(source).toMatch(/chain\.code === 'messaging_window_closed'[\s\S]*performHumanHandoff/);
    expect(source).toContain("reason: 'approved_reply_outside_window'");
  });
});
