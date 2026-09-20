-- 0275: o Conversador deixa de escrever mensagens livres.
--
-- Cada linha e um texto previamente aprovado por uma pessoa. `agent_id is null`
-- significa global DA ORGANIZACAO (nunca global entre tenants); preenchido,
-- significa exclusivo daquele agente. O runtime aceita apenas o id da linha e
-- relê o corpo por (organization_id, agent_id) antes de enviar.

create table if not exists public.ai_approved_replies (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid references public.ai_agents(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A FK composta impede que um id de agente de outro tenant seja associado a
-- uma resposta desta organização, mesmo por escrita direta no PostgREST.
create unique index if not exists uniq_ai_agents_organization_id_id
  on public.ai_agents (organization_id, id);

do $f$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ai_approved_replies_agent_org_fk'
  ) then
    alter table public.ai_approved_replies
      add constraint ai_approved_replies_agent_org_fk
      foreign key (organization_id, agent_id)
      references public.ai_agents (organization_id, id)
      on delete cascade;
  end if;
end $f$;

create index if not exists idx_ai_approved_replies_runtime
  on public.ai_approved_replies (organization_id, agent_id, is_active, label);

create unique index if not exists uniq_ai_approved_replies_global_label
  on public.ai_approved_replies (organization_id, lower(label))
  where agent_id is null;

create unique index if not exists uniq_ai_approved_replies_agent_label
  on public.ai_approved_replies (organization_id, agent_id, lower(label))
  where agent_id is not null;

drop trigger if exists trg_ai_approved_replies_updated_at on public.ai_approved_replies;
create trigger trg_ai_approved_replies_updated_at
  before update on public.ai_approved_replies
  for each row execute function public.fn_set_updated_at();

alter table public.ai_approved_replies enable row level security;
revoke all on table public.ai_approved_replies from anon;
grant select, insert, update, delete on table public.ai_approved_replies to authenticated;
grant all on table public.ai_approved_replies to service_role;

drop policy if exists ai_approved_replies_select on public.ai_approved_replies;
create policy ai_approved_replies_select on public.ai_approved_replies
  for select using (
    organization_id in (select public.fn_user_org_ids())
    or public.fn_is_platform_admin()
  );

drop policy if exists ai_approved_replies_write on public.ai_approved_replies;
create policy ai_approved_replies_write on public.ai_approved_replies
  for all using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or public.fn_is_platform_admin()
  ) with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or public.fn_is_platform_admin()
  );

-- A tabela nasce coberta pelas cercas do suporte temporario na mesma aplicacao.
do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;
