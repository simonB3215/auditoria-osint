-- ============================================================
-- Parte 1, fase V1 (metodologia osint/plan-modulo-c.md, sección 3.0):
-- datos de la nueva verificación de dominios, que reemplaza al TXT. Un
-- dominio se verifica con una declaración firmada, poderes del firmante,
-- correo del dominio y revisión manual.
--
-- Esta migración no cambia cómo se verifica hoy: el flujo se conecta en V2
-- y el TXT se retira en V3. `assets.verification_token` se mantiene hasta
-- entonces.
--
-- Solo se guarda el path y el hash de los documentos. El bucket y el
-- cifrado llegan en V2, igual que su retención.
-- ============================================================

-- La 021 eliminó `rut` porque ningún formulario lo capturaba: ahora la
-- verificación lo necesita. No es único: si lo fuera, cualquiera podría
-- bloquear a la empresa real cargando su RUT primero. El dígito verificador
-- se valida en el backend.
alter table organizations add column rut text
    check (rut is null or rut ~ '^[0-9]{7,8}-[0-9Kk]$');

-- ============================================================
-- Una organización y un id: permite que las FK compuestas de abajo impidan
-- enlazar un activo o una declaración de otra organización.
-- ============================================================
create unique index idx_assets_id_org on assets(id, organization_id);

create table domain_ownership_declarations (
    id                      uuid primary key default uuid_generate_v4(),
    organization_id         uuid not null references organizations(id) on delete cascade,
    submitted_by            uuid references profiles(id) on delete set null,
    signer_rut              text not null check (signer_rut ~ '^[0-9]{7,8}-[0-9Kk]$'),
    declaration_version     text not null,
    signed_document_path    text not null,
    signed_document_sha256  text not null check (signed_document_sha256 ~ '^[0-9a-f]{64}$'),
    powers_document_path    text not null,
    powers_document_sha256  text not null check (powers_document_sha256 ~ '^[0-9a-f]{64}$'),
    -- `not_configured`: no hay proveedor de firma conectado (pendiente P2).
    -- Rechaza igual que `invalid`, nunca aprueba por omisión.
    signature_status        text not null default 'pending'
                            check (signature_status in ('pending', 'valid', 'invalid', 'not_configured')),
    signature_checked_at    timestamptz,
    powers_status           text not null default 'pending'
                            check (powers_status in ('pending', 'approved', 'rejected')),
    powers_reviewed_by      uuid references profiles(id) on delete set null,
    powers_reviewed_at      timestamptz,
    created_at              timestamptz not null default now(),
    unique (id, organization_id)
);
create index idx_domain_declarations_org on domain_ownership_declarations(organization_id, created_at desc);

-- Cada dominio de la declaración avanza por separado: uno puede requerir
-- revisión manual sin frenar a los demás.
create table domain_declaration_items (
    id                  uuid primary key default uuid_generate_v4(),
    organization_id     uuid not null references organizations(id) on delete cascade,
    declaration_id      uuid not null,
    asset_id            uuid not null,
    status              text not null default 'pending_email'
                        check (status in ('pending_email', 'pending_review', 'approved', 'rejected')),
    email_confirmed_at  timestamptz,
    review_reason       text,
    reviewed_by         uuid references profiles(id) on delete set null,
    reviewed_at         timestamptz,
    review_notes        text,
    created_at          timestamptz not null default now(),
    unique (id, organization_id),
    foreign key (declaration_id, organization_id)
        references domain_ownership_declarations(id, organization_id) on delete cascade,
    foreign key (asset_id, organization_id)
        references assets(id, organization_id) on delete cascade
);
create index idx_domain_items_declaration on domain_declaration_items(declaration_id);
-- Un dominio solo puede tener un trámite abierto a la vez.
create unique index idx_domain_items_open_asset on domain_declaration_items(asset_id)
    where status in ('pending_email', 'pending_review');
create index idx_domain_items_review on domain_declaration_items(status) where status = 'pending_review';

-- Solo se guarda el hash del token: una copia de la tabla no permite abrir
-- ningún link.
create table domain_email_challenges (
    id                  uuid primary key default uuid_generate_v4(),
    organization_id     uuid not null references organizations(id) on delete cascade,
    declaration_item_id uuid not null,
    issued_to           uuid not null references profiles(id) on delete cascade,
    token_hash          text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
    expires_at          timestamptz not null,
    consumed_at         timestamptz,
    created_at          timestamptz not null default now(),
    check (expires_at > created_at),
    foreign key (declaration_item_id, organization_id)
        references domain_declaration_items(id, organization_id) on delete cascade
);
create index idx_domain_challenges_item on domain_email_challenges(declaration_item_id);

-- Contienen RUT de personas y el estado del trámite: las lee solo el `ciso`
-- de la organización. Sin policies de escritura para `authenticated`: un
-- usuario no puede aprobar su propio trámite, escribe solo el backend
-- (service_role). `domain_email_challenges` no tiene ninguna policy, igual
-- que `scan_runs`.
alter table domain_ownership_declarations enable row level security;
alter table domain_declaration_items enable row level security;
alter table domain_email_challenges enable row level security;

create policy domain_declarations_select on domain_ownership_declarations
    for select using (organization_id = current_organization_id() and current_user_role() = 'ciso');
create policy domain_items_select on domain_declaration_items
    for select using (organization_id = current_organization_id() and current_user_role() = 'ciso');

-- ============================================================
-- Cierra la verificación directa contra la base. `assets_modify` y
-- `assets_insert` autorizan filas, no columnas: con su JWT y la anon key
-- (pública), un usuario podía marcar su activo como `verified`, o cambiar
-- `value` de un activo ya verificado a un dominio ajeno, sin pasar por
-- ninguna validación. Sin esto, la barrera de `scans.ts` y todo este flujo
-- se podrían saltar. Ahora esas columnas solo se escriben con service_role.
-- ============================================================
create or replace function protect_asset_verification_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if current_user not in ('authenticated', 'anon') then
        return new;
    end if;

    if tg_op = 'INSERT' then
        if new.verification_status <> 'pending' or new.verified_at is not null then
            raise exception 'La verificación de un activo solo la escribe el backend'
                using errcode = '42501';
        end if;
    elsif new.verification_status is distinct from old.verification_status
        or new.verified_at is distinct from old.verified_at
        or new.value is distinct from old.value
        or new.type is distinct from old.type then
        raise exception 'La verificación, el valor y el tipo de un activo solo los escribe el backend'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

create trigger assets_protect_verification_fields
    before insert or update on assets
    for each row execute function protect_asset_verification_fields();
