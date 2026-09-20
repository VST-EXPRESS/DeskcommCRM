import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireSupportWrite } from "@/lib/impersonate/support";
import { ok, fail, noContent } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const patchSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(4000).optional(),
    scope: z.enum(["global", "agent"]).optional(),
    is_active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Informe ao menos uma alteracao.");

type RouteCtx = { params: Promise<{ id: string; replyId: string }> };

async function loadAuthorizedReply(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  agentId: string,
  replyId: string,
) {
  const { data } = await admin
    .from("ai_approved_replies")
    .select("id, agent_id, label, body, is_active")
    .eq("organization_id", orgId)
    .eq("id", replyId)
    .or(`agent_id.is.null,agent_id.eq.${agentId}`)
    .maybeSingle();
  return data;
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const { id, replyId } = await ctx.params;
  if (!UUID_RX.test(id) || !UUID_RX.test(replyId))
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
  const existing = await loadAuthorizedReply(admin, authz.org.orgId, id, replyId);
  if (!existing) return fail("not_found", "Resposta nao encontrada.", 404, { requestId });
  const update: Record<string, unknown> = {};
  if (parsed.data.label !== undefined) update.label = parsed.data.label;
  if (parsed.data.body !== undefined) update.body = parsed.data.body;
  if (parsed.data.is_active !== undefined) update.is_active = parsed.data.is_active;
  if (parsed.data.scope !== undefined) update.agent_id = parsed.data.scope === "global" ? null : id;

  const { data, error } = await admin
    .from("ai_approved_replies")
    .update(update)
    .eq("organization_id", authz.org.orgId)
    .eq("id", replyId)
    .select("id, organization_id, agent_id, label, body, is_active, created_at, updated_at")
    .single();
  if (error?.code === "23505")
    return fail("state_conflict", "Ja existe uma resposta com esse nome neste escopo.", 409, {
      requestId,
    });
  if (error || !data)
    return fail("internal_error", "Erro ao atualizar resposta aprovada.", 500, { requestId });

  void audit({
    action: "ai_agent.approved_reply_updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "ai_approved_reply",
    resourceId: replyId,
    requestId,
    metadata: { agent_id: id, fields: Object.keys(update) },
  });
  return ok(data, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const { id, replyId } = await ctx.params;
  if (!UUID_RX.test(id) || !UUID_RX.test(replyId))
    return fail("invalid_request", "Identificador invalido.", 400, { requestId });
  const authz = await requireRole("admin", { requestId, resource: "ai_approved_replies" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const existing = await loadAuthorizedReply(admin, authz.org.orgId, id, replyId);
  if (!existing) return fail("not_found", "Resposta nao encontrada.", 404, { requestId });
  const { error } = await admin
    .from("ai_approved_replies")
    .delete()
    .eq("organization_id", authz.org.orgId)
    .eq("id", replyId);
  if (error)
    return fail("internal_error", "Erro ao excluir resposta aprovada.", 500, { requestId });

  void audit({
    action: "ai_agent.approved_reply_deleted",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "ai_approved_reply",
    resourceId: replyId,
    requestId,
    metadata: { agent_id: id, scope: existing.agent_id === null ? "global" : "agent" },
  });
  return noContent(requestId);
}
