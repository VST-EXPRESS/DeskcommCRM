import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { chaveDaRequisicao, comIdempotencia } from "@/lib/api/idempotency";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const ENDPOINT = "/api/v1/ai/approved-replies";
const COLUMNS = "id, organization_id, agent_id, label, body, is_active, created_at, updated_at";

const createSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(4000),
  })
  .strict();

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "ai_approved_replies" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_approved_replies")
    .select(COLUMNS)
    .eq("organization_id", authz.org.orgId)
    .is("agent_id", null)
    .order("label", { ascending: true });
  if (error)
    return fail("internal_error", "Erro ao carregar respostas globais.", 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
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

  async function createReply() {
    const { data, error } = await admin
      .from("ai_approved_replies")
      .insert({
        organization_id: org.orgId,
        agent_id: null,
        label: input.label,
        body: input.body,
        created_by: user.id,
      })
      .select(COLUMNS)
      .single();
    if (error || !data) throw new Error("approved_reply_create_failed", { cause: error?.code });

    void audit({
      action: "ai_agent.approved_reply_created",
      actorUserId: user.id,
      organizationId: org.orgId,
      resourceType: "ai_approved_reply",
      resourceId: data.id,
      requestId,
      metadata: { scope: "global" },
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
      corpo: input,
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
      return fail("state_conflict", "Ja existe uma resposta global com esse nome.", 409, {
        requestId,
      });
    return fail("internal_error", "Erro ao criar resposta global.", 500, { requestId });
  }
}
