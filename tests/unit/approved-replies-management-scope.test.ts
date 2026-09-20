import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), "utf8");

describe("cadastros global e por agente permanecem separados", () => {
  const globalCollection = read("app/api/v1/ai/approved-replies/route.ts");
  const globalItem = read("app/api/v1/ai/approved-replies/[replyId]/route.ts");
  const agentCollection = read("app/api/v1/ai/agents/[id]/approved-replies/route.ts");
  const agentItem = read("app/api/v1/ai/agents/[id]/approved-replies/[replyId]/route.ts");

  it("a pagina global lista, cria e altera somente agent_id nulo", () => {
    expect(globalCollection).toContain('.is("agent_id", null)');
    expect(globalCollection).toContain("agent_id: null");
    expect(globalItem.match(/\.is\("agent_id", null\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("a aba do agente lista, cria e altera somente o id daquele agente", () => {
    expect(agentCollection).toContain('.eq("agent_id", id)');
    expect(agentCollection).toContain("agent_id: id");
    expect(agentItem.match(/\.eq\("agent_id", (agentId|id)\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("nenhuma das APIs aceita trocar uma resposta de escopo", () => {
    for (const source of [globalCollection, globalItem, agentCollection, agentItem]) {
      expect(source).not.toContain('scope: z.enum(["global", "agent"])');
    }
  });
});
