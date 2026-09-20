import type pg from "pg";
import { z } from "zod";

export const approvedReplyIdSchema = z.string().uuid();

export interface ApprovedReply {
  id: string;
  agentId: string | null;
  label: string;
  body: string;
}

/**
 * Uniao autorizada para um turno: globais da organizacao + exclusivas do
 * agente publicado. Organizacao e agente chegam do job/config confiavel.
 */
export async function loadApprovedReplies(
  db: pg.Pool,
  organizationId: string,
  agentId: string | null,
): Promise<ApprovedReply[]> {
  const { rows } = await db.query<{
    id: string;
    agent_id: string | null;
    label: string;
    body: string;
  }>(
    `select id, agent_id, label, body
       from ai_approved_replies
      where organization_id = $1
        and is_active = true
        and (agent_id is null or agent_id = $2::uuid)
      order by agent_id nulls first, label, id`,
    [organizationId, agentId],
  );
  return rows.map((row) => ({
    id: row.id,
    agentId: row.agent_id,
    label: row.label,
    body: row.body,
  }));
}

export function findApprovedReply(
  replies: readonly ApprovedReply[],
  replyId: string,
): ApprovedReply | null {
  return replies.find((reply) => reply.id === replyId) ?? null;
}

/** O modelo precisa conhecer as opcoes, mas nunca recebe uma porta de texto livre. */
export function renderApprovedReplies(replies: readonly ApprovedReply[]): string {
  if (replies.length === 0) {
    return [
      "## Respostas aprovadas",
      "Nao ha resposta aprovada disponivel para este agente.",
      "Voce NAO pode escrever uma resposta. Encaminhe para uma pessoa.",
    ].join("\n");
  }
  return [
    "## Respostas aprovadas",
    "Para falar com o cliente, escolha UMA resposta abaixo e chame send_message apenas com reply_id.",
    "O texto sera buscado e enviado pelo sistema. Nunca escreva, adapte, complete ou combine os textos.",
    ...replies.map(
      (reply) =>
        `- reply_id=${reply.id} | ${reply.agentId === null ? "GLOBAL" : "DESTE AGENTE"} | ${reply.label}: ${JSON.stringify(reply.body)}`,
    ),
  ].join("\n");
}
