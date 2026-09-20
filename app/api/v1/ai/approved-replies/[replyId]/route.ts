import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, noContent, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLUMNS = "id, organization_id, agent_id, label, body, is_active, created_at, updated_at";

const patchSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(4000).optional(),
    is_active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Informe ao menos uma alteracao.");

type RouteCtx = { params: Promise<{ replyId: string }> };

async function globalReplyExists(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  replyId: string,
) {
  const { data } = await admin
    .from("ai_approved_replies")
    .select("id")
    .eq("organization_id", orgId)
    .eq("id", replyId)
    .is("agent_id", null)
    .maybeSingle();
  return data !== null;
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { replyId } = await ctx.params;
  if (!UUID_RX.test(replyId))
    return fail("invalid_request", "Identificador invalido.", 400, { requestId });
  const authz = await requireRole("admin", { requestId, resource: "ai_approved_replies" });
  if (!authz.ok) return authz.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON invalido.", 400, { requestId });
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success)
    return fail("validation_failed", "Campos invalidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });

  const admin = createAdminClient();
  if (!(await globalReplyExists(admin, authz.org.orgId, replyId)))
    return fail("not_found", "Resposta global nao encontrada.", 404, { requestId });

  const { data, error } = await admin
    .from("ai_approved_replies")
    .update(parsed.data)
    .eq("organization_id", authz.org.orgId)
    .eq("id", replyId)
    .is("agent_id", null)
    .select(COLUMNS)
    .single();
  if (error?.code === "23505")
    return fail("state_conflict", "Ja existe uma resposta global com esse nome.", 409, {
      requestId,
    });
  if (error || !data)
    return fail("internal_error", "Erro ao atualizar resposta global.", 500, { requestId });

  void audit({
    action: "ai_agent.approved_reply_updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "ai_approved_reply",
    resourceId: replyId,
    requestId,
    metadata: { scope: "global", fields: Object.keys(parsed.data) },
  });
  return ok(data, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { replyId } = await ctx.params;
  if (!UUID_RX.test(replyId))
    return fail("invalid_request", "Identificador invalido.", 400, { requestId });
  const authz = await requireRole("admin", { requestId, resource: "ai_approved_replies" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  if (!(await globalReplyExists(admin, authz.org.orgId, replyId)))
    return fail("not_found", "Resposta global nao encontrada.", 404, { requestId });

  const { data: deleted, error } = await admin
    .from("ai_approved_replies")
    .delete()
    .eq("organization_id", authz.org.orgId)
    .eq("id", replyId)
    .is("agent_id", null)
    .select("id")
    .maybeSingle();
  if (error) return fail("internal_error", "Erro ao excluir resposta global.", 500, { requestId });
  if (!deleted) return fail("not_found", "Resposta global nao encontrada.", 404, { requestId });

  void audit({
    action: "ai_agent.approved_reply_deleted",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "ai_approved_reply",
    resourceId: replyId,
    requestId,
    metadata: { scope: "global" },
  });
  return noContent(requestId);
}
