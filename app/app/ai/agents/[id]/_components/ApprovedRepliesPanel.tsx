"use client";

import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

interface ApprovedReplyRow {
  id: string;
  organization_id: string;
  agent_id: string | null;
  label: string;
  body: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface Props {
  agentId: string;
  active: boolean;
  readOnly?: boolean;
}

type Scope = "global" | "agent";

export function ApprovedRepliesPanel({ agentId, active, readOnly = false }: Props) {
  const t = useT();
  const [rows, setRows] = React.useState<ApprovedReplyRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [label, setLabel] = React.useState("");
  const [body, setBody] = React.useState("");
  const [scope, setScope] = React.useState<Scope>("agent");

  const basePath = `/api/v1/ai/agents/${agentId}/approved-replies`;

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<{ data: ApprovedReplyRow[] }>(basePath);
      setRows(response.data);
      setLoaded(true);
    } catch {
      toast.error(t("Não foi possível carregar as respostas aprovadas."));
    } finally {
      setLoading(false);
    }
  }, [basePath, t]);

  React.useEffect(() => {
    if (!active || loaded) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [active, loaded, load]);

  function resetForm() {
    setEditingId(null);
    setLabel("");
    setBody("");
    setScope("agent");
  }

  async function save() {
    if (label.trim() === "" || body.trim() === "") {
      toast.error(t("Informe o nome e o texto da resposta."));
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await apiClient.patch(`${basePath}/${editingId}`, { label, body, scope });
        toast.success(t("Resposta aprovada atualizada."));
      } else {
        await apiClient.post(basePath, { label, body, scope });
        toast.success(t("Resposta aprovada criada."));
      }
      resetForm();
      await load();
    } catch {
      toast.error(t("Não foi possível salvar. Confira se o nome já existe neste escopo."));
    } finally {
      setSaving(false);
    }
  }

  function edit(row: ApprovedReplyRow) {
    setEditingId(row.id);
    setLabel(row.label);
    setBody(row.body);
    setScope(row.agent_id === null ? "global" : "agent");
  }

  async function toggle(row: ApprovedReplyRow) {
    try {
      await apiClient.patch(`${basePath}/${row.id}`, { is_active: !row.is_active });
      await load();
    } catch {
      toast.error(t("Não foi possível alterar o estado da resposta."));
    }
  }

  async function remove(row: ApprovedReplyRow) {
    if (!window.confirm(t("Excluir esta resposta?"))) return;
    try {
      await apiClient.delete(`${basePath}/${row.id}`);
      if (editingId === row.id) resetForm();
      await load();
      toast.success(t("Resposta excluída."));
    } catch {
      toast.error(t("Não foi possível excluir a resposta."));
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <div>
          <h3 className="font-medium">{t("Biblioteca de respostas aprovadas")}</h3>
          <p className="text-sm text-muted-foreground">
            {t(
              "A IA apenas escolhe uma destas respostas. Ela não pode escrever, completar ou alterar o texto enviado.",
            )}
          </p>
        </div>

        {!readOnly && (
          <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="space-y-2">
              <Label htmlFor="approved-reply-label">{t("Nome interno")}</Label>
              <Input
                id="approved-reply-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={120}
                placeholder={t("Ex.: Horário de saída")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("Quem pode usar")}</Label>
              <Select value={scope} onValueChange={(value) => setScope(value as Scope)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">{t("Somente este agente")}</SelectItem>
                  <SelectItem value="global">{t("Todos os agentes")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="approved-reply-body">{t("Texto exato que será enviado")}</Label>
              <Textarea
                id="approved-reply-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={5}
                maxLength={4000}
                placeholder={t("Escreva aqui a resposta já revisada e aprovada.")}
              />
              <p className="text-xs text-muted-foreground">
                {body.length}/4000 {t("caracteres")}
              </p>
            </div>
            <div className="flex gap-2 md:col-span-2">
              <Button onClick={save} disabled={saving}>
                {saving
                  ? t("Salvando...")
                  : editingId
                    ? t("Salvar alterações")
                    : t("Adicionar resposta")}
              </Button>
              {editingId && (
                <Button variant="outline" onClick={resetForm}>
                  {t("Cancelar edição")}
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      <div className="space-y-3">
        {loading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("Carregando respostas...")}</p>
        )}
        {!loading && loaded && rows.length === 0 && (
          <Card className="p-6 text-center">
            <p className="font-medium">{t("Nenhuma resposta aprovada")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "Enquanto a biblioteca estiver vazia, este agente não responde e encaminha o atendimento para uma pessoa.",
              )}
            </p>
          </Card>
        )}
        {rows.map((row) => (
          <Card key={row.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-medium">{row.label}</h4>
                <Badge variant={row.agent_id === null ? "info" : "neutral"}>
                  {row.agent_id === null ? t("Todos os agentes") : t("Somente este agente")}
                </Badge>
                <Badge variant={row.is_active ? "success" : "warning"}>
                  {row.is_active ? t("Ativa") : t("Inativa")}
                </Badge>
              </div>
              {!readOnly && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => edit(row)}>
                    {t("Editar")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void toggle(row)}>
                    {row.is_active ? t("Desativar") : t("Ativar")}
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => void remove(row)}>
                    {t("Excluir")}
                  </Button>
                </div>
              )}
            </div>
            <p className="rounded-md bg-muted/40 p-3 text-sm whitespace-pre-wrap">{row.body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
