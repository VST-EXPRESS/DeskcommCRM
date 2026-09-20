import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { ROLE_RANK } from "@/lib/auth/types";
import { ApprovedRepliesManager } from "@/components/ai/ApprovedRepliesManager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Respostas globais" };

export default async function TemplatesPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app/inbox");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");
  const readOnly = ROLE_RANK[activeOrg.role] < ROLE_RANK.admin;
  // `t` local em vez do hook: esta página é componente de SERVIDOR, e lá o
  // idioma vem resolvido em `user.idioma` (a cadeia pessoa → organização →
  // padrão vive em `lib/auth/server.ts`), sem reler o `locale` cru.
  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Respostas globais")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Respostas aprovadas que todos os agentes de IA desta organização podem usar.")}
        </p>
      </header>
      <ApprovedRepliesManager
        endpoint="/api/v1/ai/approved-replies"
        readOnly={readOnly}
        title={t("Biblioteca global de respostas")}
        description={t(
          "Tudo que for cadastrado aqui fica disponível para todos os agentes de IA. O texto é enviado exatamente como foi escrito.",
        )}
        emptyDescription={t(
          "Nenhuma resposta global foi cadastrada. Os agentes ainda podem usar suas respostas exclusivas.",
        )}
      />
    </div>
  );
}
