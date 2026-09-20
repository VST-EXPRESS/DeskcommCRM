"use client";

import { ApprovedRepliesManager } from "@/components/ai/ApprovedRepliesManager";
import { useT } from "@/hooks/i18n/useT";

interface Props {
  agentId: string;
  active: boolean;
  readOnly?: boolean;
}

export function ApprovedRepliesPanel({ agentId, active, readOnly = false }: Props) {
  const t = useT();
  return (
    <ApprovedRepliesManager
      endpoint={`/api/v1/ai/agents/${agentId}/approved-replies`}
      active={active}
      readOnly={readOnly}
      title={t("Respostas exclusivas deste agente")}
      description={t(
        "Cadastre aqui somente as respostas que este agente pode usar. Ele também pode usar as respostas globais.",
      )}
      emptyDescription={t(
        "Este agente ainda não tem respostas exclusivas. Ele continua podendo usar as respostas globais.",
      )}
    />
  );
}
