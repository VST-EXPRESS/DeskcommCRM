import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireSupportWrite } from "@/lib/impersonate/support";
import { chaveDaRequisicao, comIdempotencia } from "@/lib/api/idempotency";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const ENDPOINT = "/api/v1/ai/agents/:id/approved-replies";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const createSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(4000),
    scope: z.enum(["global", "agent"]),
  })
  .strict();

type RouteCtx = { params: Promise<{ id: string }> };

async function agentExists(admin: ReturnType<typeof createAdminClient>, orgId: string, id: string) {
  const { data } = await admin
    .from("ai_agents")
    .select("id")
    .eq("organization_id", orgId)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  return data !== null;
}

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "Agente invalido.", 400, { requestId });

  const authz = await requireRole("manager", { requestId, resource: "ai_approved_replies" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  if (!(await agentExists(admin, authz.org.orgId, id)))
    return fail("not_found", "Agente nao encontrado.", 404, { requestId });

  const { data, error } = await admin
    .from("ai_approved_replies")
    .select("id, organization_id, agent_id, label, body, is_active, created_at, updated_at")
    .eq("organization_id", authz.org.orgId)
    .or(`agent_id.is.null,agent_id.eq.${id}`)
    .order("agent_id", { ascending: true, nullsFirst: true })
    .order("label", { ascending: true });
  if (error)
    return fail("internal_error", "Erro ao carregar respostas aprovadas.", 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "Agente invalido.", 400, { requestId });

  const authz = await requireRole("admin", { requestId, resource: "ai_approved_replies" });
  if (!authz.ok) return authz.response;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON invalido.", 400, { requestId });
  }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success)
    return fail("validation_failed", "Campos invalidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });

  const idempotencyKey = chaveDaRequisicao(req);
  if (idempotencyKey !== null && !z.string().uuid().safeParse(idempotencyKey).success)
    return fail("validation_error", "Idempotency-Key deve ser UUID.", 400, { requestId });
  const { org, user } = authz;
  const input = parsed.data;

  const admin = createAdminClient();
  if (!(await agentExists(admin, org.orgId, id)))
    return fail("not_found", "Agente nao encontrado.", 404, { requestId });

  async function createReply() {
    const { data, error } = await admin
      .from("ai_approved_replies")
      .insert({
        organization_id: org.orgId,
        agent_id: input.scope === "global" ? null : id,
        label: input.label,
        body: input.body,
        created_by: user.id,
      })
      .select("id, organization_id, agent_id, label, body, is_active, created_at, updated_at")
      .single();
    if (error || !data) throw new Error("approved_reply_create_failed", { cause: error?.code });

    void audit({
      action: "ai_agent.approved_reply_created",
      actorUserId: user.id,
      organizationId: org.orgId,
      resourceType: "ai_approved_reply",
      resourceId: data.id,
      requestId,
      metadata: { agent_id: id, scope: input.scope },
    });
    return data;
  }

  try {
    if (idempotencyKey === null) return ok(await createReply(), { status: 201, requestId });
    const sessionDb = await createClient();
    const outcome = await comIdempotencia({
      db: sessionDb,
      organizationId: org.orgId,
      endpoint: ENDPOINT,
      chave: idempotencyKey,
      corpo: { agent_id: id, ...input },
      executar: async () => ({ resposta: await createReply(), status: 201 }),
    });
    if (outcome.tipo === "conflito")
      return fail(
        "idempotency_conflict",
        "Esta chave de idempotencia ja foi usada com outro conteudo.",
        409,
        { requestId },
      );
    return ok(outcome.resposta, { status: 201, requestId });
  } catch (error) {
    if (error instanceof Error && error.cause === "23505")
      return fail("state_conflict", "Ja existe uma resposta com esse nome neste escopo.", 409, {
        requestId,
      });
    return fail("internal_error", "Erro ao criar resposta aprovada.", 500, { requestId });
  }
}
