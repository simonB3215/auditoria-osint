-- ============================================================
-- Módulo C, fase C0 (metodologia osint/plan-modulo-c.md, sección 3.2):
-- reconocimiento pasivo. Tablas propias en vez de reutilizar `scan_runs` y
-- `audits.status`: de esos dependen la cobertura ANCI y los límites de escaneo
-- del Módulo A, y una corrida OSINT no es un escaneo. Además necesita un estado
-- `partial`, porque una fuente caída no debe tumbar a las demás.
--
-- `findings` no cambia: `source_engine` es texto libre.
-- ============================================================

create table osint_runs (
    id              uuid primary key default uuid_generate_v4(),
    organization_id uuid not null references organizations(id) on delete cascade,
    audit_id        uuid not null references audits(id) on delete cascade,
    requested_by    uuid references profiles(id) on delete set null,
    status          text not null default 'queued'
                    check (status in ('queued', 'running', 'completed', 'partial', 'failed')),
    domains         text[] not null default '{}',
    source_status   jsonb not null default '{}'::jsonb,   -- {dominio: {fuente: {status, detail, durationMs, cached}}}
    summary         jsonb not null default '{}'::jsonb,   -- acotado y sin datos personales
    started_at      timestamptz,
    finished_at     timestamptz,
    created_at      timestamptz not null default now()
);
create index idx_osint_runs_audit on osint_runs(audit_id, created_at desc);
create index idx_osint_runs_org_status on osint_runs(organization_id, status);
-- Dos pedidos simultáneos no pueden dejar dos corridas activas en una auditoría.
create unique index idx_osint_runs_one_active on osint_runs(audit_id) where status in ('queued', 'running');

create table osint_discovered_subdomains (
    id              uuid primary key default uuid_generate_v4(),
    organization_id uuid not null references organizations(id) on delete cascade,
    audit_id        uuid not null references audits(id) on delete cascade,
    osint_run_id    uuid not null references osint_runs(id) on delete cascade,
    parent_asset_id uuid references assets(id) on delete cascade,
    hostname        text not null,
    first_seen      timestamptz,
    last_seen       timestamptz,
    resolved_ips    text[] not null default '{}',
    behind_cdn      boolean not null default false,
    status          text not null default 'new' check (status in ('new', 'dismissed')),
    created_at      timestamptz not null default now()
);
create unique index idx_osint_subdomains_run_host on osint_discovered_subdomains(osint_run_id, lower(hostname));
create index idx_osint_subdomains_org on osint_discovered_subdomains(organization_id);

create table osint_breach_exposures (
    id              uuid primary key default uuid_generate_v4(),
    organization_id uuid not null references organizations(id) on delete cascade,
    audit_id        uuid not null references audits(id) on delete cascade,
    osint_run_id    uuid not null references osint_runs(id) on delete cascade,
    parent_asset_id uuid references assets(id) on delete cascade,
    alias_masked    text not null,          -- j***@empresa.cl: nunca el alias crudo
    breaches        text[] not null default '{}',
    created_at      timestamptz not null default now()
);
create index idx_osint_breaches_org_created on osint_breach_exposures(organization_id, created_at);

-- Por organización y no global: si un dominio se borra y lo reclama otra
-- organización, la nueva no hereda lo que consultó la anterior.
create table osint_source_cache (
    id              uuid primary key default uuid_generate_v4(),
    organization_id uuid not null references organizations(id) on delete cascade,
    source          text not null,
    query_key       text not null,
    payload         jsonb not null,
    fetched_at      timestamptz not null default now(),
    expires_at      timestamptz not null
);
create unique index idx_osint_cache_key on osint_source_cache(organization_id, source, query_key);

alter table osint_runs enable row level security;
alter table osint_discovered_subdomains enable row level security;
alter table osint_breach_exposures enable row level security;
alter table osint_source_cache enable row level security;   -- sin policies: solo service_role, igual que scan_runs

create policy osint_runs_select on osint_runs
    for select using (organization_id = current_organization_id());
create policy osint_subdomains_select on osint_discovered_subdomains
    for select using (organization_id = current_organization_id());
create policy osint_subdomains_update on osint_discovered_subdomains
    for update using (organization_id = current_organization_id() and current_user_role() in ('ciso', 'auditor'));
create policy osint_breaches_select on osint_breach_exposures
    for select using (organization_id = current_organization_id() and current_user_role() in ('ciso', 'auditor'));
-- Sin policies de insert ni delete para authenticated: escribe solo el worker (service_role).
