import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql, writeCountAs } from "./gov-helpers";

const ORG_A = "aaa02750-0000-4000-8000-000000000001";
const ORG_B = "bbb02750-0000-4000-8000-000000000002";
const USER_A = "aaa02750-1111-4000-8000-000000000001";
const USER_B = "bbb02750-1111-4000-8000-000000000002";
const AGENT_A = "aaa02750-2222-4000-8000-000000000001";
const AGENT_B = "bbb02750-2222-4000-8000-000000000002";

beforeAll(() => {
  sql(`
    insert into auth.users(id,email) values
      ('${USER_A}','approved-a@invariant.test'),
      ('${USER_B}','approved-b@invariant.test')
      on conflict do nothing;
    insert into public.organizations(id,slug,legal_name,display_name) values
      ('${ORG_A}','approved-a','Approved A','Approved A'),
      ('${ORG_B}','approved-b','Approved B','Approved B')
      on conflict do nothing;
    insert into public.user_organizations(user_id,organization_id,role,accepted_at) values
      ('${USER_A}','${ORG_A}','admin',now()),
      ('${USER_B}','${ORG_B}','admin',now())
      on conflict do nothing;
    insert into public.ai_agents(id,organization_id,name,system_prompt) values
      ('${AGENT_A}','${ORG_A}','Agente A','prompt'),
      ('${AGENT_B}','${ORG_B}','Agente B','prompt')
      on conflict do nothing;
    insert into public.ai_approved_replies(organization_id,agent_id,label,body) values
      ('${ORG_A}',null,'Global A','Texto global A'),
      ('${ORG_A}','${AGENT_A}','Agente A','Texto do agente A'),
      ('${ORG_B}',null,'Global B','Texto global B')
      on conflict do nothing;
  `);
});

describe("respostas aprovadas — isolamento e escopo", () => {
  it("RLS esconde integralmente as respostas do outro tenant", () => {
    expect(countAs(USER_A, "select count(*) from public.ai_approved_replies")).toBe(2);
    expect(
      countAs(
        USER_A,
        `select count(*) from public.ai_approved_replies where organization_id = '${ORG_B}'`,
      ),
    ).toBe(0);
  });

  it("admin pode criar apenas dentro da propria organizacao", () => {
    expect(
      writeCountAs(
        USER_A,
        `insert into public.ai_approved_replies(organization_id,agent_id,label,body)
         values ('${ORG_A}',null,'Criada por admin ' || gen_random_uuid(),'Texto aprovado')`,
      ),
    ).toBe(1);
    expect(
      writeCountAs(
        USER_A,
        `insert into public.ai_approved_replies(organization_id,agent_id,label,body)
         values ('${ORG_B}',null,'Tentativa cruzada ' || gen_random_uuid(),'Nao pode')`,
      ),
    ).toBe(0);
  });

  it("FK composta recusa agente de outra organizacao", () => {
    expect(() =>
      sql(`insert into public.ai_approved_replies(organization_id,agent_id,label,body)
           values ('${ORG_A}','${AGENT_B}','Agente cruzado','Nao pode');`),
    ).toThrow();
  });
});
