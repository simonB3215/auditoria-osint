-- ============================================================
-- Parte 1, fase V5 (metodologia osint/plan-modulo-c.md, sección 3.0): un
-- subdominio se habilita desde su dominio padre verificado, sin repetir la
-- declaración, salvo que apunte con CNAME a un tercero.
--
-- `parent_asset_id` también separa los subdominios del límite de activos de
-- la organización: tienen el suyo propio (MAX_SUBDOMAIN_ASSETS_PER_ORG). La FK
-- compuesta impide colgar un subdominio de un activo de otra organización.
-- Borrar el dominio padre borra sus subdominios: sin padre no hay autorización.
-- ============================================================
alter table assets add column parent_asset_id uuid;
alter table assets add constraint assets_parent_asset_fk
    foreign key (parent_asset_id, organization_id)
    references assets(id, organization_id) on delete cascade;
create index idx_assets_parent on assets(parent_asset_id) where parent_asset_id is not null;

-- Igual que la verificación: define qué autoriza a escanear, así que solo la
-- escribe el backend (ver migración 023).
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
        if new.verification_status <> 'pending' or new.verified_at is not null or new.parent_asset_id is not null then
            raise exception 'La verificación de un activo solo la escribe el backend'
                using errcode = '42501';
        end if;
    elsif new.verification_status is distinct from old.verification_status
        or new.verified_at is distinct from old.verified_at
        or new.value is distinct from old.value
        or new.type is distinct from old.type
        or new.parent_asset_id is distinct from old.parent_asset_id then
        raise exception 'La verificación, el valor y el tipo de un activo solo los escribe el backend'
            using errcode = '42501';
    end if;

    return new;
end;
$$;
