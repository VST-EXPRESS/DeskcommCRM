import type pg from "pg";
import { describe, expect, it, vi } from "vitest";

import { AGENT_TOOL_DEFS } from "./inbound-turn";
import {
  findApprovedReply,
  loadApprovedReplies,
  renderApprovedReplies,
  type ApprovedReply,
} from "./approved-replies";

const replies: ApprovedReply[] = [
  { id: "11111111-1111-4111-8111-111111111111", agentId: null, label: "Saudacao", body: "Ola!" },
  {
    id: "22222222-2222-4222-8222-222222222222",
    agentId: "33333333-3333-4333-8333-333333333333",
    label: "Caravana A",
    body: "A saida sera as 8h.",
  },
];

describe("respostas aprovadas do agente", () => {
  it("resolve somente um id presente na lista autorizada", () => {
    expect(findApprovedReply(replies, replies[1]!.id)?.body).toBe("A saida sera as 8h.");
    expect(findApprovedReply(replies, "99999999-9999-4999-8999-999999999999")).toBeNull();
  });

  it("entrega ao modelo ids e textos, sem instruir escrita livre", () => {
    const block = renderApprovedReplies(replies);
    expect(block).toContain("reply_id=11111111-1111-4111-8111-111111111111");
    expect(block).toContain("GLOBAL");
    expect(block).toContain("Nunca escreva, adapte, complete ou combine");
  });

  it("fecha em handoff quando nao existe opcao", () => {
    expect(renderApprovedReplies([])).toContain("Encaminhe para uma pessoa");
  });

  it("aceita apenas reply_id na unica ferramenta de fala", () => {
    const schema = AGENT_TOOL_DEFS.send_message.inputSchema;
    expect(schema.safeParse({ reply_id: replies[0]!.id }).success).toBe(true);
    expect(schema.safeParse({ body: "texto inventado" }).success).toBe(false);
    expect("send_template" in AGENT_TOOL_DEFS).toBe(false);
  });

  it("carrega somente globais da organizacao e exclusivas do agente confiavel", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: replies[0]!.id,
          agent_id: null,
          label: replies[0]!.label,
          body: replies[0]!.body,
        },
      ],
    });
    const db = { query } as unknown as pg.Pool;
    const agentId = "33333333-3333-4333-8333-333333333333";

    await expect(
      loadApprovedReplies(db, "44444444-4444-4444-8444-444444444444", agentId),
    ).resolves.toEqual([replies[0]]);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/organization_id = \$1[\s\S]*agent_id is null or agent_id = \$2::uuid/),
      ["44444444-4444-4444-8444-444444444444", agentId],
    );
  });
});
