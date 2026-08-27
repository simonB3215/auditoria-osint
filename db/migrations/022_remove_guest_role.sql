-- ============================================================
-- Elimina el rol auditor_guest (Piloto Invitado). Ver inventario y plan
-- completo en el reporte de esta fase (prompts.md, "BUILD PROMPT:
-- Eliminacion del rol auditor_guest (Piloto Invitado temporal)").
--
-- Estrategia de enum elegida: (b) dejar 'auditor_guest' como valor
-- INERTE en el enum user_role, sin recrear el tipo. Postgres no permite
-- un DROP VALUE de un enum sin recrear el tipo completo (la columna
-- profiles.role, la funcion current_user_role() que lo devuelve, y
-- cualquier otra dependencia) -- riesgo innecesario sin una red de CI que
-- corra la suite completa contra un clon antes de aplicar. El valor
-- queda tecnicamente en el tipo pero inasignable: no hay UI, endpoint ni
-- seed que lo use (confirmado en el inventario de esta fase).
--
-- profiles.expires_at NO se toca: sigue siendo una columna generica
-- (la usan otras cosas), y para los perfiles que fueron guest queda como
-- registro historico de que hubo un trial -- no se borra dato de nadie.
-- ============================================================

-- 1) Migra las cuentas existentes al rol de menor privilegio (regla de
--    seguridad 3: nunca eliminar, downgrade a viewer).
update profiles set role = 'viewer' where role = 'auditor_guest';

-- 2) Revierte las 7 policies que la migracion 013 modifico agregandoles
--    la guarda de expiracion del guest -- vuelven a su forma original
--    (ver db/schema.sql, previa a la 013). Ninguna queda MAS permisiva
--    de lo que ya era para ciso/auditor/viewer: solo se quita la rama
--    que existia unicamente para auditor_guest.
drop policy assets_insert on assets;
create policy assets_insert on assets
    for insert with check (organization_id = current_organization_id() and created_by = auth.uid());

drop policy assets_modify on assets;
create policy assets_modify on assets
    for update using (organization_id = current_organization_id() and (created_by = auth.uid() or current_user_role() = 'ciso'));

drop policy audits_insert on audits;
create policy audits_insert on audits
    for insert with check (organization_id = current_organization_id() and created_by = auth.uid());

drop policy audits_modify on audits;
create policy audits_modify on audits
    for update using (organization_id = current_organization_id() and (created_by = auth.uid() or current_user_role() = 'ciso'));

drop policy audit_assets_insert on audit_assets;
create policy audit_assets_insert on audit_assets
    for insert with check (audit_id in (select id from audits where organization_id = current_organization_id()));

drop policy evidences_insert on audit_evidences;
create policy evidences_insert on audit_evidences
    for insert with check (
        uploaded_by = auth.uid()
        and audit_id in (select id from audits where organization_id = current_organization_id())
    );

drop policy findings_modify on findings;
create policy findings_modify on findings
    for update using (
        audit_id in (select id from audits where organization_id = current_organization_id())
        and current_user_role() in ('ciso', 'auditor')
    );

-- 3) current_profile_expires_at() solo la usaban las 7 guardas de arriba
--    -- huerfana, se dropea.
drop function if exists current_profile_expires_at();

-- 4) Documenta el valor inerte del enum (no se puede DROP VALUE sin
--    recrear el tipo -- ver nota al inicio de este archivo).
comment on type user_role is 'Roles asignables: ciso, auditor, viewer. auditor_guest (Piloto Invitado) quedo como valor INERTE tras la migracion 022 -- ningun endpoint, UI ni seed lo asigna.';
