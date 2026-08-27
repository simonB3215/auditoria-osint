# BUILD PROMPT: Eliminacion del rol auditor_guest (Piloto Invitado temporal)

## Rol e instrucciones

Actua como ingeniero senior eliminando el rol `auditor_guest` del producto. Los roles son el modelo de
aislamiento y control de acceso del sistema: cualquier error aca puede escalar privilegios o romper el
aislamiento multi-tenant. Trabaja en dos fases: primero INVENTARIAR y PROPONER (sin cambios), luego
APLICAR tras confirmacion. No realices cambios destructivos en base de datos ni sobre cuentas de usuario
sin aprobacion explicita del plan.

## Contexto de riesgo (leer antes de tocar nada)

- Todavia NO hay red de CI ni corre la suite completa con Redis (TC-10 no corre en este entorno). Por lo
  tanto la validacion depende de tsc, build, los tests que si corren, y tu propio analisis. Extra cuidado.
- `auditor_guest` es el "Piloto Invitado": rol temporal de 10 dias con cuotas. Roles del sistema:
  `ciso`, `auditor`, `auditor_guest`, `viewer`. Se elimina solo `auditor_guest`; los otros tres quedan.
- Hay trabajo intencionalmente sin commitear en el working tree (sistema de consentimiento de cookies y
  archivos de andamiaje). NO lo toques, NO lo incluyas en tus commits, NO lo uses de base. Trabaja solo
  sobre los cambios de esta tarea.

## Reglas de seguridad (innegociables)

1. Quitar el rol NO debe otorgar mas acceso a nadie. Revisar especificamente cualquier logica del tipo
   `if (role !== 'auditor_guest')` o cualquier rama que, al desaparecer el rol, cambie el comportamiento
   hacia MAS permisos. El resultado debe ser igual o mas restrictivo, nunca menos.
2. No debilitar ninguna policy de RLS ni el aislamiento por `organization_id`.
3. No borrar cuentas de usuario ni datos sin confirmacion explicita. La migracion por defecto de un
   holder de `auditor_guest` es hacia el rol de MENOR privilegio (`viewer`), no eliminarlo.
4. No commitear a ciegas: presentar el inventario, el plan de migracion de cuentas y el plan de cambio
   de base de datos ANTES de aplicarlos, y esperar confirmacion.

## Fase 1 - Inventario y propuesta (sin cambios)

### 1.1 Inventario de referencias
Localizar TODAS las referencias a `auditor_guest` (y a "Piloto Invitado") en:
- Tipos/enums de roles en el backend (TypeScript).
- Representacion del rol en la base de datos: determinar si es un enum de Postgres, un check constraint,
  o una tabla de lookup. Esto define que tan costoso es removerlo (ver 1.4).
- Policies de RLS que mencionen el rol.
- Logica de cuotas asociada al invitado.
- Logica de expiracion / caducidad de 10 dias (jobs, cron, checks en runtime).
- UI: flujo de creacion/invitacion de guests, selectores de rol que lo listen, badges/labels.
- Diccionarios i18n (es/en): entradas del rol y de "Piloto Invitado".
- Tests y seeds/fixtures que creen o usen guests.
- Documentos legales en `legal/` (DPA, Terminos, Politica de Privacidad, y cualquier brief) que listen
  el rol.

Reportar el inventario completo antes de proponer cambios.

### 1.2 Chequeo de escalada de privilegios
Analizar cada rama de codigo donde el rol participa en una decision de acceso, y confirmar que quitarlo
no habilita mas de lo debido. Reportar cada punto revisado y su conclusion.

### 1.3 Cuentas existentes
Inventariar cuantas cuentas tienen hoy el rol `auditor_guest`. Proponer la migracion (por defecto:
downgrade a `viewer`, minimo privilegio). No aplicar hasta confirmacion.

### 1.4 Estrategia de base de datos
Segun como se almacene el rol:
- Si es enum de Postgres: remover un valor de enum requiere recrear el tipo (migracion pesada, con
  riesgo). Proponer las dos opciones con su costo: (a) migracion completa que elimina el valor, o
  (b) dejar el valor en el enum pero volverlo inasignable (sin UI, sin endpoint, sin seed que lo
  asigne) y sin logica especial. Recomendar la opcion mas segura dado que no hay red de CI, y esperar
  decision.
- Si es check constraint o tabla de lookup: proponer la remocion directa, que es de bajo riesgo.

## Fase 2 - Aplicar (tras confirmacion del plan)

- Migrar las cuentas existentes segun lo aprobado.
- Remover el flujo de creacion/invitacion de guests y toda UI que lo exponga.
- Remover la logica de cuotas y de expiracion de 10 dias especifica del invitado (si esa logica sirve a
  otros roles, conservar solo lo que aplique a ellos; no borrar de mas).
- Remover las entradas i18n del rol.
- Aplicar el cambio de base de datos aprobado en 1.4.
- Actualizar los documentos legales de `legal/`: quitar `auditor_guest` / "Piloto Invitado" de las
  listas de roles, dejando `ciso`, `auditor`, `viewer`. Mantener coherencia entre todos los docs.
- Actualizar o eliminar los tests y seeds que referencien el guest.

## Fase 3 - Verificacion

- `grep` final: no debe quedar ninguna referencia a `auditor_guest` en codigo, i18n ni docs (salvo,
  si se eligio la opcion 1.4.b, el valor inerte en el enum, que debe quedar documentado como inasignable).
- `tsc --noEmit` backend y frontend: limpio.
- `npm run build`: limpio.
- Correr la suite: unico fallo aceptable TC-10 (Redis local); sin fallos nuevos. Ajustar/agregar tests
  si la eliminacion dejo casos sin cubrir.
- Confirmar que login, asignacion de roles y las policies de RLS siguen comportandose correctamente para
  los tres roles restantes.

## Fase 4 - Commits (presentar plan y esperar confirmacion)

- Agrupar los cambios en commit(s) tematico(s) de esta tarea unicamente. NO arrastrar el sistema de
  cookies ni el andamiaje sin commitear del working tree.
- Presentar el plan de commits (archivos y mensajes) y esperar confirmacion antes de crear y pushear.

## Fuera de alcance
- No implementar Redis en CI ni cerrar el schema de Zod (es la parte siguiente).
- No commitear el sistema de consentimiento de cookies (esta sin probar).
- No rotar credenciales.
- No modificar los otros tres roles ni el modelo de aislamiento mas alla de remover el guest.

## Entregable
1. Inventario completo de referencias a `auditor_guest` (Fase 1.1).
2. Resultado del chequeo de escalada de privilegios (1.2).
3. Cuentas guest existentes y plan de migracion propuesto (1.3).
4. Estrategia de base de datos recomendada con su justificacion de riesgo (1.4).
5. Tras confirmacion: cambios aplicados, resultado de grep/tsc/build/suite, y confirmacion de que RLS y
   login siguen correctos para los roles restantes.
6. Plan de commits propuesto y, tras confirmacion, los commits creados con sus hashes.