# Aegis CyberAudit

Plataforma de auditoría de ciberseguridad para pymes: gestión de activos,
checklist de cumplimiento normativo (ISO 27001 / NIST CSF / GDPR / Ley N°
21.663 de Chile — ANCI / normativa local), ingesta y validación de
evidencias, motor de escaneo asíncrono, y generación de reportes ejecutivos
con scoring de riesgo.

Backend en `src/` (Node.js + Express + TypeScript), frontend en `frontend/`
(Next.js). Base de datos y autenticación con Supabase (PostgreSQL + Auth +
Storage), cola de trabajos con BullMQ + Redis.

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Backend | Node.js, Express 5, TypeScript, ESM |
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind v4, shadcn/ui |
| Base de datos | PostgreSQL (Supabase), Row Level Security |
| Auth | Supabase Auth (email/password + Google OAuth) |
| Storage | Supabase Storage (evidencias cifradas, reportes con signed URL) |
| Cola de jobs | BullMQ + Redis (Upstash u otro proveedor) |
| Motor de escaneo | Nmap (invocado por el worker) |
| Tests | Jest + Supertest (integración real, sin mocks) |
| i18n | Diccionarios propios (es neutro / en), sin librería externa |

---

## Estructura del repo

```
├── src/                    Backend Express
│   ├── routes/              Un archivo por recurso (audits, assets, evidences, ...)
│   ├── middlewares/          auth (JWT + RBAC + platform admin), validación, errores
│   ├── services/              coverageEngine, riskScoring, pdfReport, fileValidation, costEngine, auditLogger, dataRetentionEngine, ...
│   ├── jobs/                   scanQueue/scanWorker y retentionQueue/retentionWorker (productor/consumidor)
│   └── config/                  env.ts (valida .env con zod), supabase.ts, redis.ts
├── db/
│   ├── schema.sql              Esquema inicial (tablas + RLS)
│   ├── migrations/              002, 003, 004... (incrementales)
│   ├── run-migrations.ts       npm run db:migrate — trackea qué ya se aplicó
│   ├── setup-storage.ts        npm run storage:setup — crea los buckets
│   └── promote-admin.ts        npm run admin:promote — otorga platform_admin
├── frontend/                Next.js App Router
│   └── src/
│       ├── app/                 login, register, onboarding, (app)/dashboard, (app)/audits/[id]...
│       ├── components/           shadcn/ui + componentes propios
│       └── lib/i18n/             diccionarios es/en + contexto de idioma
└── tests/                    Suite QA (Jest + Supertest), ver tests/README.md
```

---

## Setup desde cero

### 1. Prerequisitos
- Node.js 20+
- Un proyecto [Supabase](https://supabase.com) (gratis)
- Un Redis accesible por red — recomendado [Upstash](https://upstash.com) (gratis, sin instalar nada)
- Opcional: `nmap` instalado donde vaya a correr el worker de escaneo

### 2. Base de datos y Storage
```bash
npm install
cp .env.example .env        # completar con tus credenciales (ver tabla abajo)
npm run db:migrate           # crea las tablas + RLS
npm run storage:setup        # crea los buckets privados (evidences, reports)
```

### 3. Variables de entorno (`.env`, raíz)

| Variable | De dónde sale |
|---|---|
| `SUPABASE_URL` | Project Settings → API Keys |
| `SUPABASE_ANON_KEY` | Publishable key (o "anon key" legacy) — Project Settings → API Keys |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key (o "service_role key" legacy) — **nunca** exponer al frontend |
| `DATABASE_URL` | Botón "Connect" del proyecto → **Session pooler** (no "Direct connection": requiere IPv6) |
| `REDIS_URL` | De Upstash (u otro proveedor Redis), formato `rediss://...` |
| `EVIDENCE_ENCRYPTION_KEY` | Generar con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CORS_ORIGIN` | URL del frontend, ej. `http://localhost:3001` |

No hace falta ningún "JWT Secret": la validación de sesión se hace contra la
propia API de Supabase (`auth.getUser()`), no localmente.

### 4. Backend
```bash
npm run dev              # API en http://localhost:3000
npm run worker:scan      # aparte, si vas a probar escaneos reales (requiere nmap)
```

### 5. Frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local   # NEXT_PUBLIC_SUPABASE_URL/ANON_KEY + NEXT_PUBLIC_API_URL
npm run dev -- --port 3001
```

### 6. Tu cuenta y rol de platform admin (opcional)
```bash
# Después de registrarte una vez en /register:
npm run admin:promote -- tu@email.com
```
No hay ningún botón ni endpoint que otorgue `platform_admin` — es intencional,
para que solo se pueda activar corriendo este script localmente con la
`service_role` key.

### 7. Login con Google (opcional)
Requiere configurar el provider en Supabase (Authentication → Providers →
Google) con credenciales de Google Cloud Console (gratis, no requiere
facturación) y agregar `http://localhost:3001/auth/callback` a las Redirect
URLs de Supabase.

---

## Scripts disponibles

**Backend** (raíz)
| Script | Qué hace |
|---|---|
| `npm run dev` | Levanta la API con recarga automática |
| `npm run build` / `npm start` | Build de producción + arranque |
| `npm run typecheck` | Solo chequeo de tipos |
| `npm run worker:scan` | Worker que consume la cola de escaneos |
| `npm run worker:domain-verify` | Worker que reintenta automáticamente la verificación DNS de dominios (hasta 5 intentos en 24h) |
| `npm run worker:retention` | Worker que purga evidencias vencidas (corre diario vía BullMQ Job Scheduler; también se puede disparar manual con `POST /admin/retention/run-now`) |
| `npm run worker:economic-indicators` | Worker que refresca UF/UTM/Dólar desde Mindicador.cl (corre diario a las 08:00 America/Santiago vía BullMQ Job Scheduler; el endpoint del panel también refresca al vuelo si el caché tiene más de 1h) |
| `npm run db:migrate` | Aplica `schema.sql` + migraciones pendientes |
| `npm run storage:setup` | Crea los buckets de Storage si no existen |
| `npm run admin:promote -- email` | Otorga `platform_admin` a un usuario ya registrado |
| `npm test` | Suite QA (necesita un Supabase de test aparte, ver `tests/README.md`) |

**Frontend** (`frontend/`)
| Script | Qué hace |
|---|---|
| `npm run dev` | Dev server de Next.js |
| `npm run build` / `npm start` | Build de producción + arranque |

---

## Arquitectura

### Autenticación y autorización
- El frontend habla con Supabase Auth directamente (email/password y Google
  OAuth) — el backend nunca ve contraseñas.
- Cada request al backend lleva el JWT de sesión como `Authorization: Bearer`.
  El middleware `authenticateToken` lo valida contra `supabase.auth.getUser()`
  (no localmente), así que sigue funcionando sin cambios sin importar qué
  esquema de firma use el proyecto de Supabase.
- **RBAC por organización**: `ciso` (dueño/máximo permiso) > `auditor` >
  `viewer`, definido en `profiles.role`. `auditor_guest` ("Piloto Invitado")
  es un quinto rol especial de solo 10 días — ver sección propia abajo.
- **RLS multi-tenant**: cada tabla filtra por `organization_id` vía
  `current_organization_id()`, así que un usuario nunca ve datos de otra
  organización, ni aunque el backend tuviera un bug — la base de datos misma
  lo bloquea.
- **Platform admin**: rol aparte del RBAC por-org (`profiles.is_platform_admin`),
  ve/administra todas las organizaciones vía `/api/v1/admin/*`. Se otorga con
  `npm run admin:promote` (nunca vía API pública) o, una vez que existe al
  menos un platform admin, desde `/admin` en el frontend (gestión de roles
  de otros usuarios, gateada por `requirePlatformAdmin`).
- **Suspensión de organizaciones**: un platform admin puede suspender una
  organización (`PATCH /admin/organizations/:id/suspend`); sus usuarios
  pierden acceso a la API hasta reactivarla (el propio platform admin nunca
  queda bloqueado por esto).
- **Gestión directa de usuarios (`/admin`, modal de organización)**: cada
  quien se registra crea su propia organización (`POST /onboarding/organization`,
  ver `/register`) — no existe ningún flujo de invitación. Para llevar a un
  usuario que ya tiene cuenta a la organización correcta (ej. sacarlo de la
  organización personal que se le creó al registrarse y moverlo a la
  corporativa), un platform admin lo reasigna directamente desde `/admin`
  con un selector inline ("Mover a...") — efecto inmediato, sin invitación
  ni correo (`POST /admin/users/assign-organization`). El cambio de rol y
  de `is_platform_admin` usa el mismo patrón (`POST /admin/users/role`).
- **Borrar una organización no queda bloqueado por su historial**: borrar
  un perfil (directo o en cascada al borrar su organización) no debe
  romper la integridad referencial de lo que ese usuario generó —
  evidencias, activos, auditorías, reportes y revisiones de hallazgos
  necesitan sobrevivir para la trazabilidad de la Ley 21.663, aunque quien
  los creó ya no exista. Las columnas `audit_evidences.uploaded_by`,
  `assets.created_by`, `audits.created_by`, `reports.generated_by` y
  `findings.reviewed_by` son nullable con `on delete set null` (migración
  `018_fix_profile_deletion_fks.sql`) — antes de esta migración, ninguna
  tenía una regla `ON DELETE` explícita (Postgres usa `NO ACTION` por
  defecto), así que borrar una organización con evidencia cargada fallaba
  de forma intermitente con `foreign key constraint
  "audit_evidences_uploaded_by_fkey"` (Postgres no garantiza el orden entre
  ramas hermanas de una cascada). `DELETE /admin/organizations/:id`
  también traduce cualquier violación de FK (`23503`) restante a un 409
  con mensaje claro en vez de filtrar el error crudo de Postgres. La lista
  de evidencias (`/audits/:id`) muestra "Usuario eliminado / Sistema" en
  vez de romperse cuando el que subió el archivo ya no tiene perfil.

### Persistencia de sesión y contraseñas
Diagnóstico y correcciones sobre expiración de sesión e indicadores de
usuarios (a.md, "PROMPT DE DIAGNÓSTICO Y CORRECCIÓN: PERSISTENCIA DE
SESIÓN..."):
- **Middleware de Next.js (`frontend/src/middleware.ts` /
  `lib/supabase/middleware.ts`)**: se revisó contra el patrón canónico de
  `@supabase/ssr` y ya estaba correcto — llama `supabase.auth.getUser()`
  (que refresca la sesión si hace falta) y reemite las cookies actualizadas
  en cada response. No se encontró ahí la causa de cierres de sesión
  prematuros; el TTL de tokens en sí es una config del proyecto Supabase
  (Auth > Settings), no algo controlable desde el código de la app.
- **Interceptor de refresh-and-retry (`frontend/src/lib/api.ts`)**: el gap
  real está en el cliente del browser — `getSession()` refresca cuando
  detecta el token vencido, pero queda una ventana (reloj desincronizado,
  pestaña en segundo plano que no corrió el timer de auto-refresh) donde
  igual llega un access token vencido al backend, que responde 401 y cada
  página lo mostraba como error aunque el refresh token siguiera siendo
  válido — el síntoma de "expiración prematura" que reporta a.md. Se agregó
  un interceptor de respuesta que, ante un 401, intenta
  `supabase.auth.refreshSession()` una vez y reintenta la request original;
  si el refresh también falla (o la request reintentada sigue devolviendo
  401), ver el punto siguiente.
- **Redirect global a `/login` en 401 irrecuperable (a.md, "FIX MANEJO DE
  AUTENTICACIÓN Y REDIRECCIÓN 401")**: antes, cuando el refresh-and-retry
  de arriba también fallaba, el error simplemente se propagaba y cada
  página (`useProfile`, `/dashboard`) lo mostraba como un mensaje de error
  suelto — la sesión quedaba "muerta" en el cliente sin que el usuario
  entendiera por qué. Ahora el interceptor de `api.ts` cierra la sesión de
  Supabase (`signOut()`) y redirige a `/login` en cualquier 401 que
  sobreviva al retry, **excepto** `PROFILE_NOT_FOUND` — ese código es un
  401 "de aplicación" (token válido, todavía sin fila en `profiles`) que
  el layout de `/(app)` sigue redirigiendo a `/onboarding`, no a `/login`;
  tratarlo igual que un token inválido habría roto el flujo de onboarding
  de cuentas recién confirmadas. Un flag de módulo evita cerrar sesión dos
  veces si varias requests en paralelo (`/users/me` y
  `/dashboard/summary`) fallan al mismo tiempo.
- **`ensureSession()` antes de disparar `/users/me` y
  `/dashboard/summary`**: el middleware de Next (cookies, lado servidor)
  ya garantiza que no se llega a una ruta de `/(app)` sin sesión, pero la
  hidratación de esa misma sesión en el cliente de Supabase del browser
  (`localStorage`) es asíncrona — si `useProfile` o `/dashboard` disparan
  su fetch en el primer render sin esperarla, el interceptor de request
  no encuentra token todavía y el backend responde 401 real, que era
  exactamente el síntoma que reportaba a.md en esos dos endpoints. Ambos
  hooks ahora esperan `ensureSession()` (definida en `api.ts`, reusa el
  mismo `redirectToUnauthorized`) antes de llamar a la API; en el caso
  límite de que de verdad no haya sesión, redirige directo en vez de
  disparar una request condenada a fallar.
- **Cambio de contraseña propio (`/settings/account`, página nueva)**:
  formulario mínimo que llama `supabase.auth.updateUser({ password })`
  directo desde el browser (no pasa por el backend, igual que el login) y
  fuerza `refreshSession()` después para que el nuevo token quede propagado
  sin cerrar la sesión de la pestaña actual (a.md: "sin cerrar la ventana
  actual") — verificado con Playwright que tras cambiar la contraseña la
  navegación a `/dashboard` no redirige a `/login`.
- **Restablecimiento administrativo (`/admin/users`, botón "Restablecer
  contraseña")**: `POST /api/v1/admin/users/reset-password` usa
  `auth.admin.updateUserById` para fijar la contraseña y además invalida
  las sesiones del usuario en otros dispositivos. supabase-js (auth-js
  2.112) solo expone `auth.admin.signOut(jwt, scope)`, que pide el JWT de
  la sesión a cerrar — inútil cuando un admin actúa sobre la cuenta de otra
  persona, de la que no tiene ningún token. La forma soportada por Supabase
  para este caso es borrar las filas de `auth.sessions` del usuario
  directamente; se expuso como función `SECURITY DEFINER`
  (`db/migrations/020_force_sign_out_function.sql`, `force_sign_out_user`)
  llamada vía `supabaseAdmin.rpc(...)` en vez de abrir una conexión `pg`
  nueva en el backend (que hoy solo usa supabase-js). **Matiz importante**:
  esto invalida el *refresh token* (fuerza re-login en cuanto el access
  token en curso expire, normalmente ≤1h) — no revoca instantáneamente un
  access token JWT ya emitido y todavía no vencido, porque esos JWT son
  auto-contenidos y no se validan contra una tabla de sesiones. Es una
  propiedad de JWT sin estado, no una limitación de esta implementación.
  Verificado con un script contra Supabase real: el refresh token previo al
  reset queda rechazado (`Invalid Refresh Token: Refresh Token Not Found`)
  y la contraseña vieja deja de servir para loguearse.
- **Logging de errores de autenticación (a.md, sección 4)**:
  `authenticateToken` clasifica el mensaje de `auth.getUser()`
  (`jwt_expired` / `refresh_token_not_found` / `invalid_credentials` /
  `unknown`), lo loguea en consola y lo registra en `audit_logs`
  (`AUTH_TOKEN_REJECTED`). El login en sí pega directo a Supabase Auth
  desde el browser — nunca pasa por este backend — así que no hay señal
  server-side nativa de intentos fallidos de login sin configurar un Auth
  Hook de Supabase (infraestructura fuera de alcance). Como adaptación
  honesta, `/login` reporta el fallo con un best-effort
  `POST /api/v1/auth/log-failure` (público, sin token porque en ese momento
  no existe sesión, protegido por el rate limiter estricto existente) que
  también escribe en `audit_logs` (`AUTH_LOGIN_FAILED`).

### Panel de administración (`/admin`) — Command Center
Rediseño completo del panel de plataforma (a.md, "Rediseño y reestructuración
completa del Dashboard de Administración") con navegación por sidebar
colapsable y las organizaciones desacopladas de la gestión de usuarios.
- **Layout** (`frontend/src/app/(app)/admin/layout.tsx`): sidebar fijo
  agrupado en 4 categorías (General, Gestión, Operaciones & Seguridad,
  Finanzas & FinOps), colapsable y persistido en `localStorage`. El guard
  de `is_platform_admin` vive acá una sola vez para todo el módulo en vez
  de repetirse en cada página.
- **Buscador universal (`Cmd/Ctrl+K`)**: filtra en el cliente contra un
  índice liviano de organizaciones + usuarios ya cargado (`GET
  /admin/organizations` + `GET /admin/users`, sin paginar — a esta escala
  alcanza). Es una adaptación honesta del "Cmd+K" que pedía el prompt
  original: no hay un índice de búsqueda ni un command palette de verdad,
  es un filtro por substring sobre los datos que el panel ya tiene
  cargados, con resultados que llevan a la página correspondiente.
- **Badges de estado del sistema**: "Workers" hace un `PING` real a Redis
  (la misma conexión que usan los workers de BullMQ) y "APIs" reutiliza el
  flag `stale` de los indicadores económicos (`GET
  /admin/system-status`) — señales reales, no simuladas, reutilizando
  infraestructura que ya existía en vez de montar un sistema de monitoreo
  nuevo.
- **Modo oscuro/claro**: toggle real (`ThemeProvider`,
  `frontend/src/lib/theme/context.tsx`) que agrega/quita la clase `dark`
  en `<html>` y persiste en `localStorage` — mismo patrón que
  `I18nProvider`. Un script inline bloqueante en `app/layout.tsx` aplica
  el tema guardado antes de la primera pintura para evitar flash de
  contenido sin estilo.
- **Toasts**: sistema propio (`frontend/src/hooks/use-toast.tsx`, sin
  dependencias externas) para confirmar acciones exitosas — los errores
  siguen mostrándose con el `Alert` en la propia página, consistente con
  el resto de la plataforma.
- **`/admin` (Resumen)**: 4 tarjetas con datos 100% reales (organizaciones
  registradas, dominios verificados, MRR real, auditorías del mes —
  reutiliza directamente `GET /admin/kpis/real-metrics`), un gráfico de
  actividad reciente, y una tarjeta de alertas operativas construida con
  señales reales (organizaciones suspendidas, dominios pendientes de
  verificación, intentos de escaneo no autorizado bloqueados
  recientemente) — no hay indicadores de tendencia (+/-) inventados: no
  existe ningún snapshot histórico guardado para calcular una variación
  real, así que se muestran los valores absolutos del periodo actual.
- **`/admin/organizations`**: las organizaciones pasan a ser una entidad
  de empresa pura — nombre, dominio principal, plan, estado de
  verificación DNS, sin ninguna columna ni conteo de usuarios en la fila
  (`organizations.plan`, migración `019_organization_entity_fields.sql`).
  La misma migración agregó también `organizations.rut`, pero ningún
  formulario de la plataforma lo capturaba (el onboarding solo pide
  nombre) — quedaba `null` siempre y solo generaba una columna/fallback
  "Sin RUT" sin valor real; se eliminó por completo (columna, endpoints y
  UI) en la migración `021_drop_organization_rut.sql` (a.md, "AUDITORÍA Y
  LIMPIEZA DE INCONSISTENCIAS EN MODELO DE DATOS, UI Y FORMULARIOS").
  `plan` es una **etiqueta**
  administrativa editable (`starter`/`pro`/`custom`), no una suscripción
  real — no hay pasarela de pagos conectada, mismo criterio que
  `is_suspended`. Acciones por fila: editar (`PATCH
  /admin/organizations/:id`), archivar/reactivar (reusa `.../suspend`),
  ver detalle (dominios + actividad reciente vía `GET
  /admin/organizations/:id/domains` y `.../activity`), eliminar.
- **`/admin/users`**: gestión global de usuarios, desacoplada de la tabla
  de organizaciones (`GET /admin/users`, cruza `profiles` con `auth.users`
  vía la Admin API de Supabase para traer el email real). Acciones por
  fila: cambiar rol, otorgar/quitar `platform_admin`, reasignar
  organización (mismo mecanismo que ya existía,
  `POST /admin/users/assign-organization`), y **desactivar/reactivar
  cuenta** — nuevo (`POST /admin/users/deactivate`): usa el "ban" nativo
  de Supabase Auth (bloquea el login de inmediato, verificado end-to-end)
  en vez de un flag propio que habría que duplicar en `authenticateToken`.
  **Restablecer contraseña** (nuevo, ver "Persistencia de sesión y
  contraseñas" arriba) también vive acá, un botón por fila. Encima de la
  tabla, 4 tarjetas de indicadores (a.md, sección 1) calculadas por
  `GET /admin/users` sobre los mismos datos que ya trae (sin una consulta
  extra por tarjeta): activos/inactivos (sesión en los últimos 30 días),
  % de cuentas con 2FA activo + alerta si hay cuentas con ≥3 intentos
  fallidos de login en 24h (ver adaptación de logging más arriba — hoy da
  0% de 2FA porque la app todavía no ofrece UI para enrolar factores, es un
  número real, no inventado), conteo estricto de `is_platform_admin = true`,
  y cuentas "posiblemente abandonadas" (creadas hace más de 14 días sin
  login en los últimos 90). La tabla también suma una columna "Último
  acceso" con tiempo relativo (`Intl.RelativeTimeFormat`) para poder ir
  directo a esas cuentas.
- **FinOps unificado bajo tabs**: `/admin/costs` y `/admin/internal-finops`
  siguen siendo dos páginas independientes (cada una con su propio estado
  y fetching, uno mide gasto real y el otro simula ingresos) pero ahora
  comparten un selector visual tipo Tabs (`FinOpsTabs`) que navega entre
  ambas sin volver al panel principal — una fusión real en una sola página
  con un único árbol de estado habría sido mucho más invasiva sin agregar
  valor real.
- **Desviación de a.md**: el prompt original pedía un ítem de nav
  "Auditorías y Escaneos" separado de "Audit Logs & Trazabilidad" dentro
  de Operaciones & Seguridad — no existe ninguna vista administrativa
  global de auditorías/escaneos (las auditorías se gestionan por
  organización, no desde un panel admin), así que ese ítem quedó afuera en
  vez de crear una página nueva sin datos reales que mostrar.

### Flujo de una auditoría
1. Se crea la auditoría (`POST /audits`) eligiendo un framework.
2. Se cargan evidencias (`POST /audits/:id/evidences`) — validadas en dos
   capas: magic bytes (rechaza binarios disfrazados) y contenido semántico
   (columnas/campos obligatorios según el requisito).
3. Se registran y verifican activos (IP/CIDR/dominio) — un activo no puede
   escanearse hasta probar su propiedad (DNS TXT para dominios, autoatestación
   de rol `ciso` para IP/CIDR).
4. `POST /audits/:id/run-scan` encola un job (BullMQ/Redis); el worker
   (proceso aparte) corre Nmap, además de un chequeo de certificados TLS
   (vencimiento, confianza, protocolo débil) y de cabeceras de seguridad
   HTTP faltantes sobre los puertos web que encuentra abiertos, y normaliza
   todo a `findings` con severidad. Activos tipo repositorio/servidor cloud
   se excluyen del escaneo de red (nmap no aplica a esos tipos).
5. `GET /audits/:id/report` calcula el puntaje de riesgo, genera un PDF, lo
   sube a Storage, y devuelve un signed URL de descarga de corta duración.

### Clarificación de módulos en `/audits/[id]` y `/onboarding`
En `/audits/[id]` convivían dos flujos con requisitos muy distintos — el
escaneo técnico de red (Nmap, automático, sin archivos) y la carga manual
de evidencia documental — sin ninguna señal visual de que fueran cosas
separadas, lo que generaba confusión sobre si el escaneo requería subir
algo o dar credenciales (a.md, "CLARIFICACIÓN DE MÓDULOS DE AUDITORÍA Y
UX").
- **Banner de garantía del Módulo A** (`ShieldCheck`, encabezado "Módulo A
  · Seguridad de Red y Perímetro"): mensaje fijo aclarando que el escaneo
  vía Nmap es 100% externo — no sube archivos, no pide credenciales, no
  accede a datos internos — colocado antes del botón "Ejecutar Escaneo
  Técnico de Perímetro".
- **Modal de privacidad de bases de datos**: un botón "¿Cómo evaluamos la
  seguridad de sus bases de datos?" dentro del banner abre un diálogo
  explicando que solo se comprueba desde afuera si puertos como
  PostgreSQL 5432 o MySQL 3306 están expuestos o sin TLS — nunca hay
  conexión real a la base de datos del cliente.
- **Módulo B separado visualmente**: la matriz de cobertura y la carga de
  evidencia (Excel, PDF, esquemas SQL) quedan bajo un eyebrow "Módulo B ·
  Auditoría de Archivos y Esquemas (Opcional)", dejando explícito que es
  un paso manual y opcional, no un requisito del escaneo técnico.
- **Nota en `/onboarding`**: un párrafo debajo del formulario de alta de
  organización adelanta la misma distinción antes de que el usuario
  llegue a `/audits/[id]`.
- **Desviación de a.md**: el prompt pedía además separar "Escáner de Red"
  y "Analizador de Archivos" como dos ítems de navegación (Sidebar/Tabs)
  distintos. No existe una página de "análisis de archivos" independiente
  — la carga de evidencia solo ocurre dentro del detalle de una auditoría
  puntual, nunca como sección propia del menú — así que la separación se
  resolvió donde realmente ocurre la confusión (dentro de `/audits/[id]`)
  en vez de crear un ítem de nav sin una página real detrás.

### Cuentas de Auth "colgadas" sin perfil (`/onboarding`)
a.md pedía un rol `admin` y un bypass de `/organizations/new` para
"usuarios administradores" que no existen en el esquema real — no hay
ningún literal `'admin'` en `UserRole` (`ciso` / `auditor` /
`auditor_guest` / `viewer` — `src/types/express.d.ts`), y "ser admin de
plataforma" es el flag aparte `profiles.is_platform_admin`, que se activa
manualmente (`npm run admin:promote -- email`) **sobre un perfil que ya
existe**. Investigar con datos reales en vez de asumir el esquema del
prompt encontró la causa real: una cuenta de Supabase Auth puede quedar
"colgada" — creada, pero sin haber completado nunca `POST
/onboarding/organization` (ej. alguien cierra la pestaña entre el
`signUp` y el paso de onboarding) — y al volver a loguearse, `/users/me`
devuelve (correctamente) `401 PROFILE_NOT_FOUND`, mandando de nuevo a
`/onboarding`. Para quien ya tenía la cuenta desde hace días, esa pantalla
se sentía como "me pide registrarme de nuevo" sin dejar claro que el
problema era solo el paso de organización, no la cuenta en sí.
- **`/onboarding` ahora muestra el email de la sesión activa** y aclara
  explícitamente "No es un registro nuevo — es el último paso para tu
  cuenta existente", con un link "¿No sos vos? Cerrar sesión" para quien
  llegó ahí por error de cuenta.
- **Desviación de a.md**: no se implementó el rol `admin` ni el bypass de
  organización porque no hay ningún "org por defecto/global" a la que
  asignar automáticamente — inventar esa asignación habría creado un
  segundo mecanismo de admin en conflicto con `is_platform_admin`, que ya
  funciona (`/admin/organizations`, `/admin/users`, gate de
  `requirePlatformAdmin` en el backend). En cambio se atacó la confusión
  real reportada por el usuario con la copy de arriba.

### Rediseño de intuitividad y advertencias críticas (a.md, "REDISEÑO COMPLETO DE UI/UX")
- **Puntaje de Salud de Seguridad** en `/dashboard`: `GET
  /dashboard/summary` agrega `securityHealthScore` (promedio de
  `audits.risk_score` — pese al nombre de la columna, 100 es perfecto,
  ver `src/services/riskScoring.ts` — entre todas las auditorías con
  reporte generado, no solo las 5 "recientes" que ya traía el summary).
  El frontend lo traduce a 3 etiquetas simples reusando la paleta de
  severidad ya validada (`SEVERITY_VISUALS`) en vez de inventar un cuarto
  set de colores: **Excelente** (≥85), **Atención Necesaria** (40-84),
  **Riesgo Crítico** (&lt;40) — mismos umbrales que ya usaba
  `complianceLevel`. `null` cuando ninguna auditoría tiene puntaje
  todavía, para no mostrar un 0 engañoso.
- **Confirmación legal antes de escanear** (`/audits/[id]`, Ley N°
  21.459): el botón "Ejecutar Escaneo Técnico de Perímetro" ya no dispara
  la request directo — abre un modal con una declaración de
  responsabilidad ("Declaro... que soy propietario o cuento con
  autorización explícita...") detrás de un checkbox obligatorio; el botón
  de confirmar queda deshabilitado hasta marcarlo.
- **Advertencia de consecuencias al ignorar un hallazgo**: el modal de
  justificación (ya existente, ver "Gestión de falsos positivos" más
  abajo) ahora muestra un `Alert` explícito cuando el cambio es a "falso
  positivo" o "riesgo aceptado", aclarando que el hallazgo queda excluido
  de reportes oficiales y del cálculo de cumplimiento.
- **Pestaña "Alertas Ignoradas"** en `/audits/[id]/report`: los hallazgos
  se separan en dos tabs (Activos / Ignorados) además del filtro por
  severidad que ya existía. En la pestaña de ignorados, la acción es un
  botón directo "Reactivar Alerta" (reusa el mismo `PATCH
  /findings/:id/status` a `open`) en vez del menú desplegable de la
  pestaña activa.
- **"Ver detalles" por hallazgo**: nuevo modal que muestra el campo
  `finding.detail` (la descripción técnica cruda, ej. "Nmap detectó el
  puerto 5432/tcp abierto ejecutando postgresql...") junto a motor,
  fecha de detección y CVE — antes se guardaba en la base pero no se
  mostraba en ningún lado de la UI, solo se veían el título humano y la
  remediación.
- **Mensaje de sesión caducada**: el redirect a `/login` que ya hacía
  `redirectToUnauthorized` (ver "Persistencia de sesión") ahora agrega
  `?reason=session_expired`, y `/login` lo traduce a un aviso visible en
  vez del redirect silencioso de antes ("Tu sesión caducó por seguridad.
  Por favor, vuelve a iniciar sesión.") — mismo patrón que ya existía
  para `?error=oauth_failed`.
- **Desviación de a.md**: no se reorganizó la navegación en dos bloques
  "Seguridad de Red & Perímetro" / "Análisis de Planillas & Esquemas" —
  la navegación de `/(app)` es un header horizontal con 5 destinos reales
  (Panel, Activos, Retención, Mi cuenta, Admin), ninguno de los cuales es
  "el escáner de red" o "el analizador de archivos": esas dos cosas son
  acciones dentro de una auditoría puntual (`/audits/[id]`), no páginas
  del menú principal — la separación visual ya se resolvió ahí mismo en
  la fase anterior (ver "Clarificación de módulos"). Tampoco se forzó el
  redirect automático de `is_platform_admin` a `/admin` en cada login:
  un platform admin también es dueño de organizaciones propias y navegar
  siempre forzado a `/admin` le saca acceso directo a su propio
  `/dashboard`; ya puede ir a `/admin` con un click desde el nav, y la
  redirección real que corregía a.md (onboarding forzado) se arregló en
  la fase anterior.

### Repintado de tema: "Clean Enterprise / Cyber-Minimalist" (a.md, "REDISEÑO VISUAL Y ESTRUCTURAL COMPLETO")
Tercera resubmisión casi idéntica del mismo prompt de rediseño de UX —
todo lo funcional (banners, modales legales, pestañas de excepciones,
mensajes de sesión, score de salud) ya estaba cubierto por las dos fases
anteriores. Lo único nuevo fue un pedido explícito de reemplazar la
paleta de colores, que sí se implementó, a diferencia de los ítems ya
descartados en fases previas (sidebar en 2 zonas, selector de
organización en el topbar, selector de alcance "columna" en falsos
positivos, redirect forzado de admin) que siguen sin aplicar por las
mismas razones ya documentadas — ninguno de esos tres corresponde a la
arquitectura real de la app (nav de un solo nivel, un usuario = una
organización, findings de infraestructura no de datos tabulares).
- **Paleta azul profundo/slate reemplaza el gris neutro** (`frontend/src/app/globals.css`):
  el tema por defecto de shadcn usaba grises puros (0 de chroma OKLCH)
  para fondo/texto/primary/border. Se reemplazaron los tokens de
  `:root` y `.dark` por una escala slate (fondo `slate-50`/`slate-950`,
  cards blancas/`slate-900`, texto `slate-900`/`slate-100`) con
  `--primary`/`--ring`/`--accent` en azul (`blue-700` claro,
  `blue-500` oscuro) — cambio centralizado en un solo archivo de
  tokens CSS, sin tocar la estructura de ningún componente, así que se
  propaga automáticamente a toda la app (botones, badges, focus rings,
  progress bars) sin trabajo adicional por pantalla.
- **Severidad crítica → rojo cálido, severidad baja → esmeralda**: el
  crítico ya era un rojo cálido cercano a Tailwind `red-600`, se alineó
  al valor exacto para que combine con el nuevo `--destructive`. El de
  severidad baja pasó de verde puro (`#0ca30c`) a esmeralda
  (`#059669`, `emerald-600`), como pedía a.md explícitamente para
  "estados de salud". Alta/media quedaron sin cambios — a.md no
  especificó esos dos.
- **No se tocaron**: radios de borde (ya eran `rounded-xl` en `Card`
  antes de este cambio, ver `components/ui/card.tsx`), la librería de
  componentes (sigue siendo shadcn/ui — no se agregó Tremor, que ni
  siquiera se menciona como dependencia instalada), ni los colores de
  gráficos de costos/FinOps (`--chart-*`, `--cost-*`, `--finops-*`) —
  fuera del alcance que pidió a.md y con riesgo real de romper la
  legibilidad de esos gráficos ya validados.
- Verificado con Playwright contra Supabase real en `/dashboard`,
  `/audits/[id]/report` y `/admin`, en modo claro y oscuro.

### Rediseño del dashboard y first-time UX (a.md, "REDISEÑO COMPLETO DEL DASHBOARD Y FIRST-TIME UX")
- **Fix de la métrica de cumplimiento engañosa**: `GET /dashboard/summary`
  devolvía `averageCoveragePercentage: 100` cuando la organización todavía
  no tenía ninguna auditoría (`coverages.length === 0`) — una cuenta
  recién creada mostraba "100% de cumplimiento" sin haber auditado nada.
  Ahora devuelve `null` en ese caso; el campo pasó a `number | null` en el
  tipo del frontend.
- **Hero de bienvenida para cuentas nuevas** (`totalAudits === 0`):
  reemplaza toda la vista (que si no hubiera tenido el fix de arriba
  habría mostrado varias tarjetas en 0%/100% sin contexto) por un único
  banner: título, subtítulo mencionando Ley 21.663, botón "Ejecutar
  Primer Escaneo de Perímetro" (a `/audits/new`) y el badge de privacidad
  "0% lectura de datos privados".
- **Tarjetas del dashboard reestructuradas**: de las 3 genéricas
  anteriores (activos/cobertura/auditorías) a 3 específicas + el Puntaje
  de Salud como tarjeta héroe aparte (ya existía, se mantuvo con ese
  tratamiento más grande en vez de bajarla a una tarjeta más — es el
  número más importante del dashboard, objetivo #1 de a.md): **Dominio/IP
  a Auditar** (cuenta de activos `ip`/`cidr`/`domain`, nuevo
  `networkAssetsCount` en el summary), **Cumplimiento Ley 21.663 (ANCI)**
  (del audit `ley_21663_cl` más reciente, no un promedio — cada auditoría
  ANCI es una foto de cumplimiento puntual; `null`/"Sin auditoría ANCI
  todavía" si la organización no tiene ninguna), y **Falsos Positivos /
  Excepciones** (`ignoredFindingsCount`, cuenta de findings
  `false_positive` + `accepted_risk` en toda la organización).
- **Formulario "Nueva auditoría"**: framework por defecto cambiado de
  `iso27001` a `ley_21663_cl` (el camino de menor fricción — tiene el
  módulo técnico automático sin archivos), y nota explicativa aclarando
  que después de crear la auditoría van a estar disponibles tanto el
  escaneo automático como la carga opcional de evidencia.
- **Desviación de a.md**: el formulario pedía además un "selector visual
  claro" entre tipo de escaneo (red vs. archivos) al crear la auditoría.
  No se implementó como un control funcional porque una auditoría no
  tiene un "tipo" de escaneo que elegir — cualquier auditoría, sin
  importar el framework, tiene ambos módulos disponibles después de
  creada (ver "Clarificación de módulos" más arriba); un selector ahí
  sería decorativo y no cambiaría ningún comportamiento real, así que se
  reemplazó por la nota explicativa de arriba en su lugar.
- Verificado con Playwright contra Supabase real: cuenta sin auditorías
  (hero, sin 100% engañoso, CTA funcional) y cuenta con datos (3
  tarjetas + score + framework por defecto + nota de módulos).

### Botón para descartar el hero de bienvenida (a.md, "FIX CONDICIONAL DE BIENVENIDA")
El orden condicional que pedía este prompt (loading → error → `totalAudits
=== 0` → dashboard completo) ya estaba implementado correctamente desde la
fase anterior — `summary` arranca en `null`, así que mientras `loading` es
`true` se muestra el skeleton y `totalAudits` nunca se evalúa antes de que
la respuesta llegue; no había ningún parpadeo que corregir. Lo único
genuinamente nuevo era el punto 3 del prompt:
- **Botón "Omitir, ir al panel"** en el hero: guarda
  `aegis-dashboard-hero-dismissed` en `localStorage` (mismo patrón que
  `aegis-theme`) y muestra el dashboard completo con sus estados vacíos
  (0 activos, "Sin auditoría ANCI todavía", etc.) en su lugar. Persiste
  entre recargas de página — se verificó con Playwright que tras
  descartarlo y recargar, el hero no vuelve a aparecer.

### Registro de activos accesible y guiado (`/assets`)
El modal "Registrar recurso para auditoría" (antes "Agregar activo") está
pensado para que lo complete cualquier perfil, no solo gente técnica —
a.md, "Rediseño accesible y guiado del modal Agregar activo".
- **Microcopy explicativo**: cada tipo de activo tiene una descripción en
  lenguaje simple debajo del selector (ej. "Repositorio Git: el código
  fuente de una aplicación"), y el placeholder del campo Valor cambia
  según el tipo elegido (`192.168.1.10` para IP,
  `https://github.com/tu-empresa/tu-proyecto` para repositorio, etc.).
- **Criticidad como tarjetas, no un selector plano**: los 4 niveles
  (crítica/alta/media/baja) se muestran como tarjetas clickeables con un
  punto de color y una frase de impacto de negocio cada una (ej. "Si
  falla, se detiene la operación del negocio"), armadas sobre un
  `RadioGroup` de Radix — navegable con flechas de teclado igual que un
  grupo de radios nativo.
- **Etiquetas como `TagInput` unificado** (a.md, "Consolidación de
  Etiquetas" — reemplaza el diseño anterior de dos mecanismos separados:
  chips predefinidos + un campo de texto libre aparte): ahora es un único
  componente — las etiquetas activas aparecen como píldoras removibles
  (`×`) dentro de la misma caja donde se escriben etiquetas propias
  (Enter o coma para agregar), y debajo quedan como sugerencias de un
  clic solo las predefinidas (Producción, Sitio Web, Interno, Backend,
  etc.) que todavía no se agregaron — al quitarlas, vuelven a aparecer
  como sugerencia en vez de perderse.
- **Validación en tiempo real sin dependencias nuevas**: el prompt
  original pedía Zod/React Hook Form — es un solo formulario chico, así
  que se adaptó con funciones de validación puras por tipo (regex de
  IP/CIDR/dominio/URL de repositorio) en vez de sumar una dependencia
  nueva al frontend (Zod hoy solo lo usa el backend). El error aparece
  recién al salir del campo (`onBlur`), nunca mientras el usuario todavía
  está escribiendo, y usa `aria-invalid` + `aria-describedby` + `role="alert"`
  para que un lector de pantalla lo anuncie de inmediato.
- **Accesibilidad (WCAG 2.1 AA)**: el focus trap y el cierre con `Esc` ya
  los da gratis `Dialog` de Radix (no hizo falta código nuevo para eso).
  Se sumaron dos primitivos nuevos siguiendo el mismo patrón que
  `dropdown-menu.tsx`/`select.tsx`: `components/ui/tooltip.tsx` (los
  íconos "?" junto a cada campo) y `components/ui/radio-group.tsx` (las
  tarjetas de criticidad). El texto de ayuda de cada tooltip también
  quedó visible de forma permanente debajo del campo — el tooltip es un
  refuerzo, nunca la única vía para acceder a la explicación (hover-only
  es un anti-patrón de accesibilidad).
- **Botones**: "Guardar" en color primario con spinner de carga
  (`Loader2` animado, mismo patrón que el resto de la app) y un botón
  "Cancelar" explícito al lado, además del cierre con la "X" o `Esc`.

### Validación de IP privada y garantía de escaneo (a.md, "REDISEÑO DE UX Y VALIDACIONES EN REGISTRO DE RECURSOS")
- **Advertencia de IP privada en tiempo real**: mientras se escribe (sin
  esperar a salir del campo, a diferencia de los errores de formato de
  arriba), si el valor cae en un rango privado (`10.0.0.0/8`,
  `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`) se muestra una
  advertencia amarilla — no bloqueante, porque una IP privada es
  sintácticamente válida, solo no es alcanzable desde Internet para el
  escaneo externo. Aplica a los tipos `ip` y `cidr` (evaluando solo la
  parte de red antes del `/`).
- **Badge de garantía de escaneo**: debajo del selector de tipo, para
  `ip`/`cidr`/`domain` (los tipos que sí escanea Nmap) se muestra
  "Escaneo externo de red. Cero acceso a datos privados." — no aparece
  para `repository`/`cloud_server`, que quedan fuera del escaneo de red
  (mismo criterio que ya documentaba el flujo de una auditoría más
  arriba).
- Verificado con Playwright: badge visible para IP/dominio y ausente para
  repositorio, advertencia de IP privada aparece con `192.168.1.50` y
  desaparece con `8.8.8.8`, TagInput agrega/quita etiquetas predefinidas
  y personalizadas correctamente.

### Selector de tipo simplificado a perímetro externo (a.md, "SIMPLIFICACIÓN DE TIPOS DE RECURSOS")
El selector de `Tipo` del modal de registro quedó limitado a **Dirección
IP Pública** y **Dominio / Sitio Web** — los dos únicos tipos que Nmap
escanea sin pedirle nada al usuario. `Rango CIDR`, `Repositorio Git` y
`Servidor Cloud` generaban desconfianza (sugieren acceso a código fuente
o credenciales de nube) y se sacaron de ahí.
- **Cambio acotado al selector de creación, no al schema**: `AssetType`
  (backend y frontend) sigue teniendo los 5 valores, y el filtro de tipo
  de la tabla (`/assets`) sigue mostrando los 5 — se creó
  `REGISTRABLE_ASSET_TYPES` como un array aparte solo para el `<Select>`
  del modal, en vez de tocar el enum. No había ningún activo real con
  esos tres tipos en la base al momento del cambio (se verificó antes de
  tocar nada), pero aunque hubiera habido, esta forma del cambio no los
  habría roto — solo impide crear nuevos desde este modal.
- **Etiquetas reforzadas**: "Dirección IP" → "Dirección IP Pública",
  "Dominio" → "Dominio / Sitio Web", para dejar explícito que se espera
  una IP alcanzable desde Internet.
- **Nota redirigiendo a la carga de evidencia**: a.md pedía una tercera
  opción "Esquema de BD / Archivo (Opcional)" en el mismo desplegable.
  No se agregó como un tipo de activo más — un archivo Excel/SQL no es
  algo que se pueda verificar o escanear como una IP o un dominio, es la
  evidencia documental que ya se sube por auditoría (Módulo B, ver
  "Clarificación de módulos" más arriba). En su lugar, el modal muestra
  una nota fija aclarando que para eso no hace falta registrar nada acá.
- Verificado con Playwright: el desplegable muestra exactamente 2
  opciones (IP Pública, Dominio) y ninguna de las tres eliminadas; la
  nota sobre planillas/esquemas es visible.

### Módulo de simulación / sandbox (a.md, "MODULO DE SIMULACIÓN (SANDBOX) Y GENERACIÓN DE INFORME TÉCNICO COMPLETO")
Deja probar el flujo completo — escaneo, hallazgos, descarte de falsos
positivos, reporte PDF — sin depender de tener ya un dominio propio
verificado. Botón "Cargar Escaneo de Prueba" visible en el hero de
bienvenida (cuentas nuevas) y como tarjeta propia en el dashboard normal
("Modo simulación"), que pasa a "Limpiar Simulación" una vez que existe
una.
- **`POST/GET/DELETE /api/v1/audits/sandbox`** (`src/routes/sandbox.ts`,
  montado en `app.ts` **antes** que `auditsRouter` — si no, `GET
  /audits/:id` de ese router capturaría "sandbox" como si fuera un `:id`
  y lo rechazaría por no ser un UUID antes de llegar acá). Sin `is_demo`
  ni ninguna columna nueva: el audit de simulación se identifica por un
  título fijo (`"Auditoría de Simulación (Sandbox)"`) scoped a la
  organización — evita una migración para un flag que solo le importa a
  este endpoint. Es idempotente: si ya existe una simulación, `POST` la
  devuelve en vez de duplicarla.
- **Escaneo real, no simulado**: la primera versión insertaba hallazgos
  fabricados a mano contra un dominio ficticio, sin tocar Nmap — corregido
  a pedido explícito para que sea un escaneo de verdad. `POST
  /audits/sandbox` encola un job real en el mismo `scanQueue`/`scanWorker`
  que usa `POST /audits/:id/run-scan` (`scans.ts`), contra
  `scanme.nmap.org` (`45.33.32.156`) — el host que el propio proyecto Nmap
  publica y mantiene explícitamente como target autorizado para pruebas
  (nmap.org/book/testing.html), así que es legal escanearlo de verdad sin
  pedirle a nadie que "sea dueño" de un dominio. Se registra como activo
  `ip` (no `domain`) para no chocar con el índice único global de dominios
  entre organizaciones — un `ip` solo es único dentro de la organización,
  así que cada organización puede correr su propia simulación en paralelo
  sin pisarse. El activo se marca `verified` directo (autoatestación,
  mismo criterio que cualquier IP real) y el audit queda `queued` →
  `running` → `completed`/`failed` igual que un escaneo real — la UI de
  `/audits/[id]` (que ya hace polling cada 3s) no necesitó ningún cambio.
- **RLS real, no supuesta**: se intentó primero escribir `findings`
  directo con el cliente del usuario y falló con 400 — esa tabla no tiene
  policy de `INSERT` para clientes autenticados (`db/schema.sql` — "solo
  lectura desde el cliente, escritura vía service_role desde el worker de
  escaneo"), a propósito. Como ahora el escaneo es real, `sandbox.ts` ya
  ni siquiera toca `findings`/`scan_runs` directamente — los llena el
  worker real, igual que a cualquier auditoría. Limpiar la simulación sí
  respeta la policy real de `audits_delete` (`current_user_role() =
  'ciso'`, un `auditor` no puede borrar ni auditorías reales ni la
  simulación) — el `DELETE` quedó restringido a `ciso` en vez de replicar
  el permiso más laxo de creación.
- **Limpieza sin tocar tablas manualmente de más**: borrar el `audits`
  alcanza — `findings`, `scan_runs` y `audit_assets` tienen `on delete
  cascade` hacia `audits` — el activo (`45.33.32.156`) se borra aparte
  porque no cuelga de `audits`. a.md mencionaba una tabla
  `exceptions_whitelist` que no existe en el schema (los falsos
  positivos/riesgos aceptados son un `status` en `findings`, no una tabla
  aparte); no se creó nada nuevo para eso.
- **Sección "Falsos Positivos y Excepciones Aplicadas" en el PDF**
  (`src/services/pdfReport.ts` + `reports.ts`): el desglose de hallazgos
  del reporte ahora solo muestra los activos — los descartados
  (`false_positive`/`accepted_risk`) se separaron a esta sección nueva,
  con quién los descartó (`profiles.full_name` resuelto desde
  `reviewed_by`) y la nota de justificación guardada, en vez de
  mezclarse sin distinción en el mismo listado.
- **Nmap no estaba instalado en la máquina de desarrollo** — se instaló
  vía `winget install Insecure.Nmap` (confirmado con el usuario antes,
  por ser una instalación de software a nivel de sistema) para poder
  verificar el escaneo de punta a punta.
- Verificado de punta a punta contra el backend, Redis/BullMQ y Supabase
  reales: un smoke test disparó el escaneo real y esperó a que terminara
  (~12s), confirmando 6 hallazgos genuinos contra `scanme.nmap.org`
  (puertos SSH/HTTP abiertos, cabeceras de seguridad faltantes) y el
  `scan_runs` correspondiente; también el ciclo completo de idempotencia,
  descarte de falso positivo, generación de PDF y limpieza. Con Playwright
  en la UI: botón en el hero, redirect al audit, polling de estado hasta
  "Completado", hallazgos reales visibles en `/audits/[id]/report`,
  cumplimiento ANCI calculado a partir de ellos (43%/33%).

### Reglas de negocio del MVP (a.md, "MVP: REGLAS DE NEGOCIO, AUTENTICACIÓN Y MEJORAS DE UX/UI")
Este prompt asumía una arquitectura distinta a la real en dos puntos —
**Firebase Auth** (la app usa Supabase Auth, con RLS de Postgres
dependiendo de `auth.uid()` de Supabase en cada tabla) y un modelo
**single-tenant / sin invitaciones** (ya existe un sistema completo de
roles — ciso/auditor/auditor_guest/viewer — y gestión de usuarios en
`/admin`). Migrar a Firebase o volver single-tenant habría significado
reescribir autenticación, middleware y todas las políticas RLS desde
cero — se confirmó con el usuario no tocar esos dos puntos antes de
implementar el resto. Tampoco se aplicó "Dark Mode exclusivo": contradice
la paleta azul/slate para **ambos** modos que se implementó a pedido
explícito unos commits atrás.
- **Límite de 5 activos por organización** (`MAX_ASSETS_PER_ORGANIZATION`
  en `src/routes/assets.ts`): `POST /assets` cuenta los activos
  existentes antes de insertar y responde `403 ASSET_LIMIT_REACHED` al
  llegar al tope — 5 en vez del piso de "3 a 5" que sugería a.md, para no
  ser tan restrictivo que una auditoría real con un puñado de
  dominios/IPs no entre. El frontend muestra un contador "X/5 activos"
  junto al título de `/assets`, calculado del lado del cliente (no pega
  un request aparte).
- **Banner de riesgo crítico en el dashboard**: si
  `summary.findingsBySeverity.critical > 0`, se muestra un `Alert`
  destructivo arriba de todo — reusa un campo que el summary ya traía
  para `SeverityDistribution`, no hizo falta agregar nada al backend.
- **Notificación por email al completar un escaneo**
  (`src/services/emailTemplates.ts` + `scanWorker.ts`): un solo correo
  cuando el audit termina `completed` (nunca en `failed`), con una
  sección destacada si hubo hallazgos críticos — cubre las dos
  condiciones de a.md ("escaneo completado" + "hallazgo crítico") sin
  mandar dos correos separados por el mismo evento. Mismo patrón
  "preparado pero no conectado" que el resto de los emails del sistema
  (sin `RESEND_API_KEY`, se registra en consola). Falla en silencio
  (try/catch best-effort): un error de notificación no debe tirar abajo
  un job de escaneo que sí terminó bien.
- **Modal híbrido de falsos positivos** (`/audits/[id]/report`): un
  selector "Motivo" (Riesgo Aceptado / Control Compensatorio Existente /
  Entorno de Pruebas / Otro) que precarga el campo de justificación con
  una frase inicial editable — el texto libre que ya existía no
  desapareció, el preset solo lo arranca; la validación de mínimo 10
  caracteres del backend sigue intacta.
- **URLs de PDF a 1 hora**: `SIGNED_URL_TTL_SECONDS` pasó de 5 minutos a
  3600s en `reports.ts` — antes era demasiado corto para que alguien
  reciba el link por otro canal (reenviado por email/chat) y lo abra.
- **Reintentos automáticos de verificación DNS** (`src/jobs/domainVerifyQueue.ts`
  + `domainVerifyWorker.ts`, proceso nuevo — `npm run worker:domain-verify`,
  mismo patrón que `scanQueue`/`scanWorker`): al crear un activo `domain`,
  `POST /assets` agenda automáticamente hasta 5 chequeos de TXT
  espaciados (5min/30min/2h/6h/24h desde la creación, la última marca
  cae justo a las 24h que pedía a.md) sin que el usuario tenga que volver
  a tocar nada — el botón manual "Verificar ahora" sigue disponible para
  quien no quiere esperar. Cada intento relee el estado del activo antes
  de chequear DNS: si ya está `verified` (por el botón manual o un
  intento automático anterior), no hace nada y no reprograma más. No se
  agregó ningún estado "expirado" nuevo al enum de `verification_status`
  — agotados los 5 intentos, el activo simplemente queda `pending`
  (idéntico a como ya se comporta hoy), verificable a mano en cualquier
  momento.
- Verificado con smoke tests contra el backend, Redis/BullMQ y Supabase
  reales (límite de activos, TTL de PDF, dato del banner crítico,
  reprogramación automática del reintento DNS, no-op sobre un activo ya
  verificado, email de notificación disparado tras un escaneo real de la
  simulación) y con Playwright en la UI (banner crítico, contador "3/5",
  precarga de texto en el modal híbrido).

### Auditoría de seguridad y consistencia pre-venta (a.md, "BUILD PROMPT: AUDITORÍA DE SEGURIDAD Y CONSISTENCIA PRE-VENTA")
Auditoría en dos fases: primero reportar sin tocar nada, después aplicar
solo los arreglos acotados que pedía el propio a.md.

**Hallazgos (Fase 1)**: cero fuga de secretos en el árbol actual ni en
**todo** el historial de git (búsqueda tipo *pickaxe* por JWT, `sb_secret_`,
`RESEND_API_KEY=`, cadenas Redis con credenciales — los pocos matches
fueron falsos positivos verificados a mano: un hash de integridad de
`package-lock.json` y placeholders `change-me` en un `.env.example`
viejo). Sesión confirmada en cookies (`@supabase/ssr`, sin `storage:`
override). Cero analítica/tracking instalado, ahora ni antes. Sin
lenguaje que exagere el alcance (nada de "pentesting"/"auditoría
integral"/certificación de cumplimiento); el hash SHA-256 del PDF ya
está correctamente descrito como solo-integridad, nunca como firma
electrónica avanzada.

**Cambios (Fase 2)**:
- `src/config/env.ts` + `src/routes/assets.ts`: `MAX_ASSETS_PER_ORG`
  configurable por variable de entorno (`z.coerce.number().int().positive().default(5)`),
  default sin cambios.
- `src/routes/scans.ts`: hueco real encontrado y cerrado. Al pedir
  `asset_ids` puntuales, un id que RLS no devuelve (no existe, o es de
  otra organización) se descartaba en silencio en vez de rechazarse
  explícitamente — si eran todos los ids pedidos, el endpoint devolvía
  un `422` genérico sin auditar el intento. Ahora cualquier id no
  devuelto por la consulta scoped-a-RLS se trata igual que uno no
  verificado: `403 UNAUTHORIZED_SCAN_TARGET` + `audit_logs`
  (`UNAUTHORIZED_SCAN_BLOCKED`), sin distinguir "no existe" de "no es
  tuyo" a propósito (para no filtrar esa información). Confirmado que
  `scanQueue.add` solo tiene dos puntos de entrada en todo `src/`
  (`scans.ts` y `sandbox.ts`), ambos gateados.

No se pudo correr la suite de tests en esta fase (`.env.test` tenía un
`EVIDENCE_ENCRYPTION_KEY` inválido, preexistente) — verificado en cambio
con `tsc --noEmit` limpio y el backend real con hot-reload sin errores.
Ver la fase siguiente para el cierre de este pendiente.

### Pendientes post-auditoría (a.md, "BUILD PROMPT: PENDIENTES POST-AUDITORÍA")
Cierre de los pendientes que quedaron de la auditoría anterior, en el
orden de prioridad que pedía a.md.

**Prioridad 1 — Suite de tests**:
- `.env.test` tenía literalmente el placeholder sin completar
  (`EVIDENCE_ENCRYPTION_KEY=generar-con-node-crypto-randomBytes-32-hex`)
  en vez de una clave real de 32 bytes — reemplazado por una clave dummy
  generada de verdad, exclusiva para tests.
- Con eso arreglado, la suite pasó de "0 tests, 4 suites sin poder
  cargar" a corriendo de verdad. Diagnóstico pedido por a.md, distinguiendo
  causa: **auth.test.ts, evidences.test.ts y multitenant.test.ts pasan
  completos** (la key tapaba esto). **scanAndReport.test.ts: TC-11/12
  (y la nueva TC-13) pasan; TC-10 falla con `ECONNREFUSED
  127.0.0.1:6379`** — esto **no** es consecuencia de la key ni un bug de
  lógica: no hay una instancia de Redis local corriendo en este entorno
  (`.env.test` apunta a `localhost:6379` a propósito, para nunca tocar
  el Upstash real de producción desde los tests — ver el comentario
  original en el `.env.test.example` histórico). Docker está instalado
  pero el daemon no está corriendo; no lo arranqué ni instalé Redis por
  mi cuenta al ser una decisión de entorno fuera del alcance acotado —
  **queda pendiente del lado del usuario si quiere levantarlo**.
- `tests/scanAndReport.test.ts`: agregado **TC-13** (no existía
  cobertura del fix de la Fase 2.3). Segunda organización + activo real
  ajeno para el caso "no es tuyo", más un UUID random para "no existe";
  confirma `403` idéntico (mismo código y mensaje) en ambos casos —
  sin filtrar la distinción — y verifica los dos registros en
  `audit_logs` con el id correspondiente en el payload. No depende de
  Redis (el rechazo ocurre antes de encolar nada), así que corre limpio
  incluso con TC-10 fallando por la causa de arriba.

**Prioridad 2 — Templates de entorno**: `.env.example` y
`.env.test.example` recreados desde cero en la raíz, usando el schema
de Zod de `env.ts` como única fuente — incluye también `DATABASE_URL`
(usada por `db/run-migrations.ts`) y `RESEND_API_KEY` (leída
directamente vía `process.env`, no por el schema; opcional, sin ella el
envío de emails queda en modo "preparado pero no conectado") aunque
ninguna de las dos vive en el schema de Zod, para que el template sea
realmente completo. Verificado con un smoke test real: copia de
`.env.example` con valores dummy con el formato correcto (URL válida,
64 hex chars, etc.) → `env.ts` parsea sin errores. `.gitignore` ya
ignoraba `.env`/`.env.test` puntual (no un glob `.env*`), así que los
nuevos `*.example` nunca estuvieron en riesgo de quedar ignorados —
confirmado con `git check-ignore`, no hizo falta tocar `.gitignore`.

**Secundario A — Límite de activos sincronizado**: `src/routes/users.ts`
(`GET /users/me`) ahora devuelve `maxAssetsPerOrg: env.MAX_ASSETS_PER_ORG`
— se eligió ese endpoint por ser el "perfil de org" que el frontend ya
pide en casi todas las páginas autenticadas (`useProfile()`, 11 usos
existentes). `frontend/src/lib/types.ts` (`Profile.maxAssetsPerOrg`) y
`assets/page.tsx` (contador "X/5 activos") actualizados para leer el
número de ahí en vez de tenerlo hardcodeado; el contador ahora no se
muestra hasta que el perfil cargó, en vez de mostrar un valor
potencialmente incorrecto mientras tanto.

**Secundario B — Gitleaks en CI**: no existía ningún pipeline de CI en
el repo — `.github/workflows/gitleaks.yml` es nuevo, corre en cada
push/PR usando la Action oficial `gitleaks/gitleaks-action@v2`.
`.gitleaks.toml` (nuevo, raíz del repo) extiende el ruleset por defecto
y agrega el allowlist que pedía a.md (`package-lock.json`, los tres
`.env*.example`). Validado el TOML con un parser real; no se pudo
correr `gitleaks` localmente (no está instalado, y no se instaló
software nuevo sin preguntar) — queda verificado recién en el primer
push/PR real a GitHub. Nota aparte: la Action de gitleaks tiene
condiciones de licencia distintas para repos de cuentas de organización
privadas vs. cuentas personales — no confirmado cuál aplica acá.

⚠️ **Nota de manejo de secretos de esta fase**: al diagnosticar el
`ECONNREFUSED` de TC-10 se comparó `REDIS_URL` de `.env` contra
`.env.test`, y el valor completo de `.env` (una URL de Upstash real,
con el password incluido) quedó impreso en la salida de una terminal
durante el diagnóstico. `.env` nunca se commiteó ni se tocó — el
archivo en sí sigue igual de seguro que antes — pero ese valor quedó
visible en el historial de esa sesión de trabajo. Mencionado
explícitamente para que el usuario evalúe si rotar esa credencial de
Upstash por precaución.

### Hardening del motor de escaneo (a.md, "BUILD PROMPT: Hardening del motor de escaneo")
Trabajo en dos bloques, tal como pedía a.md: Bloque 1 (arreglos seguros,
aplicados) y Bloque 2 (decisiones con trade-off, propuestas sin ejecutar).

**Bloque 1 — aplicado**:

- **1.1 Resolución de IP y detección de CDN/proxy** (`src/jobs/cdnRanges.ts`
  nuevo, `src/jobs/ipScopeCheck.ts` nuevo, `src/jobs/scanWorker.ts`,
  `src/jobs/scanEngine.ts`): antes de escanear un activo `domain`, el
  worker resuelve A/AAAA y rechaza el activo entero si CUALQUIERA de las
  IPs resueltas cae dentro de un rango publicado de Cloudflare (fuente:
  cloudflare.com/ips-v4 e ips-v6, IPv4 e IPv6, 22 rangos) — con DNS
  round-robin no hay garantía de qué IP tocaría nmap en el momento real,
  así que una sola coincidencia basta para bloquear todo el dominio. Si
  pasa el chequeo, se escanea la IP ya verificada (nunca el dominio de
  nuevo) para que no haya una segunda resolución fuera de este control.
  Los activos `ip` se chequean directo contra los mismos rangos (sin
  resolución DNS, ya son una IP). `ScanEngineResult` ganó el caso
  `"out_of_scope_or_proxied"` que pedía a.md. Cada bloqueo por CDN/proxy
  queda registrado en `audit_logs` (`SCAN_TARGET_OUT_OF_SCOPE`, nuevo).
  La lógica de matching (IPv4 con máscara de 32 bits, IPv6 con `BigInt`
  de 128 bits) se validó con 23 casos de borde calculados a mano antes de
  integrarla (rangos exactos, límites superiores, rangos adyacentes,
  direcciones públicas no relacionadas) — los 23 pasaron.
  - **No cubierto, y por qué**: activos `cidr` no se chequean contra estos
    rangos — a.md ya señala el riesgo de CIDR como punto de decisión
    aparte (Bloque 2.C de abajo), no tiene sentido resolver a medias acá
    lo que se está pidiendo evaluar como decisión completa ahí.
  - **"Verificar que la IP resuelta sea coherente con el activo
    verificado"** (última viñeta de 1.1): no es accionable hoy para
    activos `domain` sin una migración — el modelo de datos no guarda una
    IP esperada por dominio, solo verifica la *propiedad* del dominio
    (TXT), no una IP específica. Para `ip` es inherente (el valor
    verificado YA es la IP escaneada). No se agregó ninguna columna
    nueva — una migración excede "Bloque 1, no invasivo"; queda como
    decisión del usuario si se quiere agregar ese pineo.
- **1.2 Presupuesto de tiempo total por job** (`src/jobs/scanWorker.ts`):
  `JOB_TIME_BUDGET_MS = 20 min`. Al agotarse mid-loop, los activos
  restantes quedan marcados como no procesados (sin arrancar), el audit
  pasa a `failed` (no existe un estado "parcial" en el enum
  `audit_status` sin migración — ver `db/schema.sql` — y agregar uno
  excede el alcance seguro; los hallazgos ya insertados antes del corte
  NO se descartan) y queda un evento `SCAN_TIME_BUDGET_EXCEEDED` en
  `audit_logs` con la lista de activos no procesados. `lockDuration` del
  Worker: `JOB_TIME_BUDGET_MS + 5 min` (antes usaba el default de BullMQ,
  30 segundos — muy por debajo de un solo `runNmapScan` de 5 minutos, ya
  un riesgo real de que BullMQ lo marcara "stalled" en pleno escaneo,
  incluso antes de este cambio). De paso se corrigió un bug que esto
  hubiera introducido si no se tocaba: el envío del email de notificación
  chequeaba `!allFailed`, que no contemplaba este nuevo motivo de
  `failed` — ahora chequea el status final real.
- **1.3 Timing de nmap** (`src/jobs/scanEngine.ts`): `-T4` → `-T3`.
- **1.4 Rate limiting por organización**: verificado primero si ya
  existía — `sensitiveActionRateLimiter` (`src/middlewares/security.ts`)
  limita por **IP**, no por organización (20 acciones sensibles/hora,
  compartido además con subida de evidencia), así que no cerraba el caso
  que señala a.md. Agregado: `countActiveOrgScans()`
  (`src/jobs/scanQueue.ts`, cuenta audits `queued`/`running` de la
  organización) + `MAX_CONCURRENT_SCANS_PER_ORG` (nuevo en `env.ts`,
  default 2 — con `concurrency: 4` global en el worker, ninguna
  organización puede ocupar más de la mitad de los slots). Chequeado en
  ambos puntos donde se encola un job: `src/routes/scans.ts` (después de
  validar los activos, para que una autorización inválida siempre se
  detecte primero sin importar la carga de la organización) y
  `src/routes/sandbox.ts` (comparten el mismo `scanQueue`/`scanWorker`).
  `429 ORG_SCAN_CONCURRENCY_LIMIT` si se supera.

**Bloque 2 — propuestas, sin ejecutar** (ver el reporte de esta fase en
el historial de conversación para el detalle completo con trade-offs):
2.A cobertura de puertos (`--top-ports 100` → 1000, o configurable);
2.B escaneo UDP (hoy inexistente); 2.C acotar el tamaño máximo de CIDR
escaneable o reforzar su verificación (autoatestación, el mismo mecanismo
débil que ya está documentado para `ip`).

Ningún cambio cruzó las Reglas de alcance de a.md (activos verificados,
solo observación, calibrar no reinventar, `execFile` con args en array
sin interpolación de shell — no tocado). `tsc --noEmit` limpio. Test
suite: ver el punto anterior de este README (Pendientes post-auditoría)
para el estado general; esta fase se corrió contra la suite completa
después de los cambios, sin diferencias nuevas respecto del baseline ya
documentado ahí (TC-10 sigue fallando solo por la falta de Redis local,
causa ajena a este trabajo).

### Seguimiento del motor de escaneo (prompts.md, "Seguimiento del motor de escaneo (CIDR, presupuesto de tiempo, puertos configurables)")
Tres tareas acopladas, resueltas en el orden que pedía su propia nota de
acoplamiento: primero el tope de puertos (Tarea 3), después el
presupuesto derivado de ese tope (Tarea 2), y el bloqueo de CIDR al
final (Tarea 1) — aunque se reporta en el orden de prioridad original.

- **Tarea 1 — CIDR bloqueado**: `src/routes/scans.ts` rechaza
  explícitamente cualquier `asset_ids` que incluya un activo `cidr` con
  `422 CIDR_SCAN_DISABLED` (mensaje claro: la autoatestación no alcanza
  para autorizar un rango completo), auditado con el evento nuevo
  `CIDR_SCAN_BLOCKED`. Salvaguarda equivalente en `scanWorker.ts`:
  un `cidr` que llegara igual a `processScanJob` (otra vía, un job viejo
  en la cola) se bloquea ANTES del chequeo genérico de
  `NETWORK_SCANNABLE_TYPES`, con el mismo evento — deliberadamente
  **no** se lo trata como "tipo no soportado" (ese bucket sigue siendo
  solo para `repository`/`cloud_server`, que es semánticamente distinto:
  "no aplica" vs. "bloqueado por política"). Documentado en el código qué
  se necesitaría para reactivarlo: verificación de propiedad más fuerte
  que la autoatestación + cobertura del chequeo de CDN/proxy para rangos
  + un tope de tamaño — las tres juntas, no una sola. La alternativa de
  mantenerlo vivo acotado a un prefijo mínimo (ej. `/28`) queda como
  propuesta, no implementada (ver más abajo).
- **Tarea 2 — presupuesto derivado**: `JOB_TIME_BUDGET_MS` en
  `scanWorker.ts` dejó de ser un número fijo (20 min) y ahora es
  `env.MAX_ASSETS_PER_ORG * (NMAP_TIMEOUT_MS + PER_ASSET_CHECKS_MARGIN_MS)`
  — con los defaults actuales, `5 * (5 min + 60s) = 30 min`.
  `NMAP_TIMEOUT_MS` se exportó desde `scanEngine.ts` (antes era un
  `5 * 60 * 1000` duplicado en dos archivos, un desincronismo esperando a
  pasar) — una sola fuente de verdad para el timeout de una invocación de
  nmap. `PER_ASSET_CHECKS_MARGIN_MS` (60s) es el peor caso real de los
  chequeos TLS/cabeceras: como esos chequeos solo se disparan sobre 4
  puertos HTTP(S) **fijos** (443/8443 para TLS, 80/443/8080/8443 para
  cabeceras — ver `HTTPS_PORTS`/`HTTP_LIKE_PORTS` en `scanEngine.ts`), NO
  escalan con `SCAN_TOP_PORTS` — así que, en la aritmética actual, ampliar
  el rango de puertos no cambia el número del presupuesto (nmap ya corta
  a los `NMAP_TIMEOUT_MS` sin importar cuántos puertos pidió escanear).
  Igual quedó expresado en términos de la constante, no de un número
  suelto, documentado explícitamente por si en el futuro cambia esa
  relación (ver el comentario en el código). `lockDuration` del Worker:
  presupuesto + 5 min de margen, ahora **35 min** (subió de los 25 min
  anteriores junto con el presupuesto, automáticamente, sin tocarlo a
  mano).
- **Tarea 3 — puertos configurables**: `SCAN_TOP_PORTS` nuevo en
  `env.ts` (Zod: entero positivo, tope máximo duro **5000**, default
  **1000**). Alcance **global por entorno**, no por auditoría — hacerlo
  por auditoría exigiría una columna nueva (migración), fuera de lo que
  corresponde a un arreglo "a aplicar" de esta fase; queda documentado en
  el propio comentario de la variable. `runNmapScan()` en
  `scanEngine.ts` pasó a recibir `topPorts` como parámetro en vez de
  tenerlo hardcodeado (`"100"`) — el motor sigue sin importar
  configuración directamente, la recibe de quien lo llama
  (`scanWorker.ts`, desde `env.SCAN_TOP_PORTS`). El timing (`-T3`) NO se
  expuso como configuración, tal como exigía el alcance.

**Consistencia numérica entre las tres** (nota de acoplamiento): el tope
de puertos (Tarea 3) no cambia el número del presupuesto (Tarea 2) en la
aritmética actual — justificado arriba, es una propiedad real del
sistema (el timeout duro de nmap por invocación no varía con
`--top-ports`), no una omisión. El bloqueo de CIDR (Tarea 1) elimina de
raíz el peor caso de superficie de escaneo que un rango amplio
introduciría; como se optó por el bloqueo (no por la alternativa
acotada), no hace falta ningún ajuste adicional al cálculo de recursos
de la Tarea 2 por el lado de CIDR.

**Propuestas "requiere confirmación", sin implementar**:
- *Paralelismo acotado dentro del job* (Tarea 2): procesar N activos a
  la vez en vez de en secuencia, para que el tiempo total no sea la suma
  de todos. Trade-off: más carga concurrente hacia distintos targets a
  la vez, mayor uso de recursos del worker por job.
- *CIDR acotado* (Tarea 1, alternativa a mantenerlo bloqueado): permitir
  `cidr` otra vez pero solo hasta un prefijo mínimo (ej. no más amplio
  que `/28`), con el chequeo de CDN/proxy aplicado por-IP del rango y
  verificación reforzada. Trade-off: reintroduce la superficie de riesgo
  que motivó el bloqueo, acotada pero no eliminada; solo tiene sentido si
  hay una necesidad real de escanear rangos.

Ningún cambio cruzó las Reglas de alcance (activos verificados,
solo observación, `execFile` con args en array intacto, timing no
expuesto como config libre, sin barrido completo por defecto). `tsc
--noEmit` y `npm run build` limpios. Suite completa: 11 pass, 1 fail —
mismo TC-10 con la misma causa ya documentada (sin Redis local), sin
diferencias nuevas.

### Seguridad
- Evidencias cifradas (AES-256-GCM) antes de subir a Storage.
- Buckets privados; los reportes se sirven vía signed URL temporal.
- Rate limiting específico en acciones sensibles (subir evidencia, lanzar
  escaneo) además del rate limit general.
- Ningún endpoint permite auto-otorgarse organización, rol o `platform_admin`.

### Piloto Invitado (10 días)
> ⚠️ **El mecanismo para crear un Piloto Invitado nuevo quedó huérfano.**
> Este rol (`auditor_guest`) se otorgaba exclusivamente al aceptar un link
> de invitación, y ese sistema (`invite_links`, `/settings/team`,
> `/register?invite=<token>`, `POST /onboarding/accept-invitation`) se
> eliminó por completo — toda gestión de usuarios ahora es asignación
> directa desde `/admin` (ver sección de arriba), y esa asignación directa
> (`POST /admin/users/role`) solo acepta `ciso`/`auditor`/`viewer`, no
> `auditor_guest`. La mecánica de expiración/degradación/cuotas descrita
> abajo sigue vigente para cualquier perfil que ya tenga el rol, pero hoy
> no hay ninguna forma de generar uno nuevo desde la UI. Pendiente:
> decidir si se agrega `auditor_guest` como opción asignable en
> `/admin/users/role`, o si se da de baja el resto de la funcionalidad.
- **Degradación autónoma**: no depende de un job para bajar de nivel. En
  cuanto `expires_at` vence, la siguiente request autenticada de ese
  usuario lo baja a `viewer` en el momento (`authenticateToken`), antes de
  seguir procesando esa misma request. La policy de RLS que exige
  `expires_at > now()` para escribir es la red de seguridad para la
  ventana entre que expira y esa próxima request.
- **Cuotas FinOps del trial**: máximo 3 escaneos y 100MB de almacenamiento
  por organización durante los 10 días (no por usuario), devuelto como 403
  si se supera — ver `POST /audits/:id/run-scan` y
  `POST /audits/:id/evidences`.
- **UI**: badge en el topbar con los días restantes mientras está activo;
  al expirar, "Cargar evidencia", "Ejecutar escaneo" y las acciones sobre
  hallazgos quedan visualmente deshabilitadas con un aviso puntual para
  actualizar a Plan Pro, en vez de simplemente desaparecer.
- **Secuencia de nurturing (día 1/7/10)**: las 3 plantillas de email están
  preparadas como funciones puras en `src/services/emailTemplates.ts`
  (asunto + texto + HTML reales, con los datos de cobertura/días
  restantes), pero **no hay envío real conectado** — sin
  `RESEND_API_KEY`, el contenido queda en el log del servidor en vez de
  salir por correo. El email de bienvenida (día 1) ya no está enganchado a
  ningún punto de integración real (vivía en `POST /onboarding/accept-invitation`,
  eliminado junto con el resto del sistema de invitación) — las funciones
  siguen ahí, listas para conectarse el día que exista otra forma de dar de
  alta un Piloto Invitado.

### Ley N° 21.663 de Ciberseguridad (Chile — ANCI)
- Framework seleccionable `ley_21663_cl` en `/audits/new` y en la edición de
  auditorías. Sus requisitos (`src/data/complianceRequirements.ts`) se
  dividen en dos ejes independientes:
  - **`kind`**: `documentary` (requiere evidencia subida, como el resto de
    los frameworks) o `technical` (se satisface automáticamente contra los
    hallazgos del motor de escaneo — Nmap/TLS/cabeceras — sin esperar un
    archivo; nunca aparece en la matriz de cobertura documental ni en el
    selector de evidencia, para no pedir un archivo que nunca hace falta).
  - **`tier`**: `SE` (Servicios Esenciales, el piso común) u `OIV`
    (Operadores de Importancia Vital, que ACUMULA todo lo de SE más sus
    requisitos exclusivos — nunca es un conjunto separado).
- `GET /audits/:id/anci-status` (`src/services/anciCoverageEngine.ts`)
  combina evidencia documental y hallazgos de escaneo en dos porcentajes —
  cumplimiento SE y cumplimiento OIV — más el detalle de cada control
  técnico (`ok` / `fail` / `not_scanned`). Se muestra como tarjeta propia
  en `/audits/[id]/report` cuando el framework tiene controles con `tier`.
- **Trazabilidad**: cada activo efectivamente escaneado genera un evento
  `SCAN_EXECUTED` en `audit_logs` con el target, quién disparó el escaneo y
  un hash SHA-256 de integridad de ese resultado puntual (`scanWorker.ts`).
- El reporte PDF de una auditoría `ley_21663_cl` agrega una sección
  "Informe de Posición de Riesgo — Ley 21.663 (ANCI)" con el % SE/OIV, el
  detalle de controles técnicos, una bitácora de evidencias, y un hash
  SHA-256 de verificación del documento — **no es una firma electrónica
  avanzada ni calificada** en los términos de la Ley N° 19.799, se etiqueta
  explícitamente como tal en el propio PDF para no sobre-prometer validez
  legal que requeriría PKI/certificado calificado (fuera de alcance).
- El botón "Ejecutar escaneo" de `/audits/[id]` refresca el estado del
  audit cada 3s mientras está `queued`/`running`, sin necesidad de recargar
  la página a mano, hasta reflejar `completed`/`failed`.

### Verificación de propiedad de dominio
Ningún dominio se escanea sin antes probar que la organización es su dueña —
requisito de la Ley N° 21.663 y salvaguarda contra escanear infraestructura
de terceros sin autorización.
- **Modelo de datos**: se extendió `assets` (migración
  `002_asset_verification.sql` + `015_domain_global_uniqueness.sql`) en vez
  de crear la tabla `organization_domains` que sugería el prompt original —
  el estado de verificación ya vivía en `assets.verification_status` y
  duplicarlo en una tabla paralela habría creado dos fuentes de verdad. La
  migración 015 agrega un índice único global (parcial, case-insensitive)
  sobre `assets.value` para `type = 'domain'`: un mismo dominio no puede
  quedar "verificado" por dos organizaciones a la vez, aunque cada una lo
  haya cargado de forma independiente.
- **Desafío DNS**: `POST /assets/:id/verify` busca un registro TXT en la
  **raíz** del dominio (`@`, sin subdominio dedicado) con el valor
  `aegis-site-verification=<verification_token>` — un solo registro que
  cualquier persona no técnica puede seguir desde el panel de su proveedor
  DNS (Cloudflare, NIC Chile, GoDaddy, AWS, etc.).
- **Security gate en el escáner**: `POST /audits/:id/run-scan` no descarta
  en silencio los activos no verificados que se pidan por `asset_ids` —
  aborta toda la solicitud con `403 UNAUTHORIZED_SCAN_TARGET` y registra el
  intento en `audit_logs` (`UNAUTHORIZED_SCAN_BLOCKED`), con el detalle de
  qué activos estaban sin verificar.
- **Delegación a TI**: quien pide la auditoría no siempre tiene acceso al
  panel DNS de su propio dominio. `POST /assets/:id/delegate-verification`
  arma y envía (mismo patrón "preparado pero no conectado" que el resto de
  los emails — ver más abajo) un correo con el registro TXT exacto a crear,
  reutilizable desde el modal guiado de `/assets`.
- **UI guiada (a.md, "Modal de verificación de dominio por DNS")**: en
  `/assets`, verificar un activo de tipo dominio abre un modal con
  explicación en lenguaje llano y el registro TXT separado en dos campos
  independientes con su propio botón de copiado — Host (`TXT` / `@`, fijo
  porque hoy no hay un campo de subdominio distinto en el modelo de
  `Asset`) y Valor (`aegis-site-verification=<token>`, con truncado para no
  romper el layout) — en vez de una sola caja con todo el string, más
  fácil de confundir al pegar en Cloudflare/NIC Chile/GoDaddy/AWS. Los 4
  pasos incluyen una nota de propagación DNS (1-5 min), el botón
  "Verificar ahora" muestra un spinner mientras el backend resuelve el TXT,
  y la opción "Enviar instrucciones a mi equipo de TI" sigue siendo el
  mismo diálogo, sin abrir un segundo modal superpuesto. Los activos
  IP/CIDR siguen su verificación directa anterior (autoatestación de un
  `ciso`, sin desafío DNS — no hay un mecanismo equivalente simple para el
  MVP).

### Compliance, trazabilidad y retención (GDPR / ISO 27001)
- **Audit logs inmutables**: `audit_logs` registra automáticamente carga de
  evidencias, cambios de estado de hallazgos, generación/descarga de
  reportes, cambios de rol y de organización, y purgas por retención — con
  actor, IP, user-agent y payload antes/después. RLS habilita solo
  `INSERT`/`SELECT`; sin policy de `UPDATE`/`DELETE`, esas operaciones quedan
  bloqueadas para cualquier rol sujeto a RLS (verificado: un intento de
  `UPDATE`/`DELETE` desde un cliente autenticado normal afecta 0 filas, sin
  error). `organization_id` usa `on delete set null` (no cascade) para que el
  historial sobreviva al borrado de la organización que lo generó. Vistas:
  `/audits/:id/history` (una auditoría) y `/admin/audit-logs` (toda la
  plataforma, solo platform admin).
- **Retención y purga de evidencias**: cada organización configura
  `retention_period_days` en `/settings/retention` (solo `ciso` o platform
  admin). Un worker de BullMQ (`worker:retention`) corre una pasada diaria
  vía Job Scheduler que borra el binario en Storage de las evidencias
  vencidas y marca la fila como `is_purged = true` — la fila y su metadata
  (quién subió, cuándo) se conservan para fines legales, solo se elimina el
  archivo. `POST /admin/retention/run-now` dispara una pasada inmediata sin
  esperar al schedule diario.
- **Falsos positivos / riesgo aceptado**: `PATCH /findings/:id/status` exige
  `justification_notes` (mín. 10 caracteres); `reviewed_by` se toma del
  usuario autenticado, nunca del body. Los hallazgos en `false_positive` o
  `accepted_risk` se excluyen del cálculo de puntaje de riesgo
  (`GET /audits/:id/report`) pero siguen apareciendo en el reporte con su
  justificación, para dejar constancia de la decisión.

### FinOps interno — proyección financiera (`/admin/internal-finops`)
Panel privado para la mesa ejecutiva, separado del panel de costos de
infraestructura (`/admin/costs`): mientras `/admin/costs` mide **gasto real**
de la plataforma, `/admin/internal-finops` simula **ingresos, costos
variables y margen** de negocio a partir de indicadores económicos oficiales
en tiempo real.
- **Indicadores en vivo con resiliencia**: `src/services/economicIndicators.ts`
  consulta `https://mindicador.cl/api` (UF, UTM, Dólar observado) y cachea
  cada valor obtenido en `system_economic_indicators`. Estrategia de caché:
  valores de menos de 1h se sirven directo (no golpea la API pública en cada
  carga del panel); más viejos disparan un fetch en vivo; si Mindicador.cl no
  responde, se cae automáticamente al último valor guardado (marcado `stale`
  en la respuesta, con badge distinto en la UI). Un worker de BullMQ
  (`worker:economic-indicators`) corre además una pasada diaria a las 08:00
  (America/Santiago) como garantía adicional de frescura — adaptación del
  "Vercel Cron o pg_cron" que pedía el prompt original a la misma
  infraestructura de Job Scheduler que ya usa `worker:retention`, ya que este
  proyecto no corre en Vercel ni usa la extensión `pg_cron`.
- **Motor de simulación** (`src/services/finopsProjection.ts`, funciones
  puras): MRR = (clientes Starter × 1,5 UF + clientes Pro × 4,5 UF) × valor
  UF; COGS = clientes totales × (USD 0,25 × valor dólar); OPEX = USD 40 ×
  valor dólar (todos editables desde los sliders del panel, salvo el precio
  por plan). El punto de equilibrio usa el margen de contribución promedio de
  la mezcla Starter/Pro simulada; si esa mezcla nunca cubre el OPEX, se
  muestra explícitamente como "no alcanzable" en vez de un número negativo
  sin sentido. La proyección a 12 meses es un **run-rate constante** (sin
  curva de crecimiento ni churn, que el prompt original no especificaba) —
  muestra hacia dónde converge el escenario actual, no un pronóstico.
- **Acceso**: el prompt original pedía roles `super_admin`/`executive`
  dedicados; se reutiliza `profiles.is_platform_admin` (`requirePlatformAdmin`)
  en vez de introducir un segundo sistema de roles paralelo solo para este
  panel — es el mismo flag de máximo privilegio que ya protege el resto de
  `/admin/*`.
- **UI**: ticker con UF/UTM/Dólar del día + badge de conexión, sliders para
  clientes Starter/Pro, % de penetración del universo de ~10.000 empresas
  afectas a la Ley 21.663 (SII) y OPEX en USD, tarjetas de MRR/ARR/COGS/OPEX/
  margen neto/punto de equilibrio, y un gráfico de líneas (Recharts) con
  Ingresos vs. Costos vs. Utilidad Neta acumulados a 12 meses. Los sliders
  recalculan contra el backend con un debounce de 300ms.

### KPIs reales del negocio (`/admin/kpis`)
Contraparte del panel de simulación (`/admin/internal-finops`): en vez de
proyectar escenarios hipotéticos, consulta las tablas reales de la
plataforma para reportar rendimiento **ya ejecutado** — sin simulación ni
datos inventados. Selector de periodo (mes actual / último trimestre
rolling / año a la fecha) que recalcula todo contra `src/services/realKpiService.ts`.
- **Sin fabricar lo que no existe**: el prompt original asume tablas de
  `suscripciones`/`facturación` que no existen en este proyecto — no hay
  pasarela de pagos conectada (ver "Limitaciones conocidas"). En vez de
  inventar planes o clientes pagos ficticios, los indicadores financieros
  que dependen de facturación real (MRR, ARR, ARPU, margen bruto) se
  calculan honestamente en `0`/`null` con un flag explícito
  `billingConnected: false` en la respuesta — mismo patrón "preparado pero
  no conectado" que ya se usa para el envío de emails. **COGS real sí es un
  dato genuino**: reutiliza `getCostBreakdown()` de `costEngine.ts` (el
  mismo motor de `/admin/costs`), acotado al periodo seleccionado.
- **Embudo comercial real**: organizaciones totales, dominios verificados,
  organizaciones con Piloto Invitado activo o usado (señal real vía
  `profiles.expires_at`, que se conserva incluso después de que el
  Piloto expira y el perfil baja a `viewer`), y clientes pagados (`0` hoy,
  mismo motivo que el punto anterior). Penetración de mercado reutiliza la
  misma constante de 10.000 empresas (Ley 21.663 / SII) que
  `/admin/internal-finops`.
- **Indicadores operativos reales**: % de dominios verificados (sobre
  `assets` tipo `domain`, ver módulo de verificación de dominio),
  auditorías completadas y hallazgos críticos detectados en el periodo, y
  cantidad de correos de delegación a TI enviados
  (`audit_logs.action = 'DOMAIN_VERIFICATION_EMAIL_SENT'`) — reutiliza
  directamente instrumentación que ya existía de fases anteriores.
- **Tabla de organizaciones**: el prompt original pedía una tabla de
  suscripciones por plan (Starter/Pro/Custom) con estado de pago — al no
  existir ningún concepto de plan o pago, se reemplaza por una
  segmentación basada en la única señal de ciclo de vida que sí es real:
  *Piloto Invitado activo*, *Piloto Invitado vencido* o *Cuenta estándar*.
- Ver `DASHBOARD_FINOPS_INTERNO.md` (documentación del panel de
  simulación) para la comparación completa entre ambos paneles.

---

## API — endpoints principales

Todos bajo `/api/v1`, requieren `Authorization: Bearer <token>` salvo donde se indica.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/users/me` | Perfil del usuario autenticado |
| POST | `/onboarding/organization` | Crea organización + primer perfil (solo requiere token, no perfil previo) |
| POST / GET | `/audits` | Crear / listar auditorías |
| GET / PATCH | `/audits/:id` | Detalle / actualizar auditoría |
| POST | `/audits/:id/evidences` | Subir evidencia (multipart) |
| GET | `/audits/:id/evidences` | Listar evidencias + cobertura actual |
| GET | `/frameworks/:framework/requirements` | Checklist de un framework |
| POST / GET | `/assets` | Crear / listar activos (filtros `?type=&criticality=&tag=`) |
| GET / DELETE | `/assets/:id` | Detalle / eliminar un activo |
| POST | `/assets/:id/verify` | Verificar propiedad de un activo (dominio: desafío DNS TXT; IP/CIDR: autoatestación `ciso`) |
| POST | `/assets/:id/delegate-verification` | Envía por correo las instrucciones de verificación DNS a un contacto de TI (`{ email }`) |
| POST | `/audits/:id/run-scan` | Encolar un escaneo asíncrono — `403 UNAUTHORIZED_SCAN_TARGET` si algún activo pedido no está verificado |
| GET | `/audits/:id/findings` | Hallazgos (filtrable por `?severity=`) |
| GET | `/audits/:id/report` | Genera el reporte y devuelve `{ signedUrl, riskScore, coverage }` |
| GET | `/audits/:id/anci-status` | Cumplimiento Ley 21.663: `{ sePercentage, oivPercentage, technicalControls }` |
| GET | `/dashboard/summary` | Métricas agregadas para el dashboard |
| GET | `/admin/organizations` | *(platform admin)* Todas las organizaciones (entidad pura: plan, dominio principal, verificación DNS, storage) |
| PATCH | `/admin/organizations/:id` | *(platform admin)* Edita nombre/plan de una organización |
| PATCH | `/admin/organizations/:id/suspend` | *(platform admin)* Suspende/reactiva (archiva) una organización |
| DELETE | `/admin/organizations/:id` | *(platform admin)* Borra una organización |
| GET | `/admin/organizations/:id/domains` | *(platform admin)* Dominios de una organización con su estado de verificación |
| GET | `/admin/organizations/:id/activity` | *(platform admin)* Actividad reciente |
| GET | `/admin/users` | *(platform admin)* Listado global de usuarios (email real, rol, org, estado de cuenta, último acceso, 2FA — `?organizationId=` filtra) + objeto `stats` con las 4 métricas del dashboard |
| POST | `/admin/users/role` | *(platform admin)* Cambia rol y/o `platform_admin` de un usuario |
| POST | `/admin/users/assign-organization` | *(platform admin)* Reasigna directamente la organización de un usuario existente (`{ userId, organizationId }`), sin invitación ni correo |
| POST | `/admin/users/deactivate` | *(platform admin)* Desactiva/reactiva una cuenta (`{ userId, deactivated }`) — bloquea el login vía ban nativo de Supabase Auth |
| POST | `/admin/users/reset-password` | *(platform admin)* Restablece la contraseña de un usuario (`{ userId, newPassword }`) e invalida sus sesiones activas en otros dispositivos |
| GET | `/admin/system-status` | *(platform admin)* Señales reales de salud (ping a Redis, frescura de indicadores económicos) |
| POST | `/auth/log-failure` | *(público, rate-limited)* Registra un intento de login fallido en `audit_logs` — lo llama `/login` cuando `signInWithPassword` falla |
| GET | `/admin/costs/summary` | *(platform admin)* Costo total estimado del mes, desglosado por servicio |
| GET | `/admin/costs/breakdown` | *(platform admin)* Serie diaria de costo por servicio + costo por organización (`?from=&to=` ISO) |
| GET | `/admin/costs/audits` | *(platform admin)* Auditorías ordenadas por costo total (`?limit=&from=&to=`) |
| GET / PATCH | `/admin/costs/pricing` | *(platform admin)* Lee / actualiza las tarifas unitarias por proveedor |
| GET | `/admin/internal-finops/projection` | *(platform admin)* Proyección financiera interna: indicadores de Mindicador.cl + MRR/ARR/COGS/OPEX/margen/break-even (`?startersCount=&proCount=&opexUsd=&marketPenetrationPct=`) |
| GET | `/admin/kpis/real-metrics` | *(platform admin)* KPIs reales de negocio (financieros, embudo, operativos) del periodo (`?period=current_month\|last_quarter\|year_to_date`) |
| GET | `/audits/:id/history` | Timeline de audit logs de una auditoría (evidencias, hallazgos, reportes) |
| GET | `/admin/audit-logs` | *(platform admin)* Audit logs de toda la plataforma (`?organizationId=&action=&limit=`) |
| PATCH | `/findings/:id/status` | Cambia estado de un hallazgo a `open`/`false_positive`/`accepted_risk` con justificación obligatoria |
| GET / PATCH | `/settings/retention` | Lee / actualiza `retention_period_days` de la propia organización *(PATCH solo `ciso`)* |
| POST | `/admin/retention/run-now` | *(platform admin)* Dispara una pasada de purga inmediata |

---

## Frontend — pantallas

| Ruta | Qué hace |
|---|---|
| `/login`, `/register` | Auth (email/password + Google) |
| `/onboarding` | Paso final de registro: crear la organización propia |
| `/dashboard` | Métricas, distribución de riesgos, alta rápida de auditorías |
| `/assets` | Gestión de activos: tabla con filtros, alta/edición, verificación, borrado |
| `/audits/new` | Creación de auditoría con selección múltiple de activos |
| `/audits/[id]` | Matriz de cobertura + carga de evidencias (drag & drop) + disparo manual de escaneo (estado en vivo cada 3s) |
| `/audits/[id]/report` | Hallazgos filtrables por severidad, acciones de falso positivo/riesgo aceptado, tarjeta de cumplimiento ANCI (Ley 21.663), descarga de PDF |
| `/admin` | *(solo platform admin)* Resumen ejecutivo: 4 KPIs reales, actividad reciente y alertas operativas (dentro del sidebar del Command Center) |
| `/admin/organizations` | *(solo platform admin)* Organizaciones como entidad pura: plan, dominio, verificación DNS, editar/archivar/eliminar, detalle de dominios y actividad |
| `/admin/users` | *(solo platform admin)* Gestión global de usuarios: 4 tarjetas de indicadores, rol, `platform_admin`, reasignar organización, desactivar/reactivar cuenta, restablecer contraseña |
| `/admin/costs` | *(solo platform admin)* Panel FinOps: costo estimado por servicio del stack, tendencia diaria, top auditorías más costosas y edición de tarifas (bajo tabs junto a `/admin/internal-finops`) |
| `/admin/internal-finops` | *(solo platform admin)* FinOps interno: ticker UF/UTM/Dólar en vivo, sliders de simulación de escenario, MRR/ARR/COGS/OPEX/margen/break-even y proyección a 12 meses |
| `/admin/kpis` | *(solo platform admin)* KPIs reales del negocio: selector de periodo, embudo comercial, indicadores operativos, actividad diaria y tabla de organizaciones por segmento |
| `/audits/[id]/history` | Línea de tiempo de audit logs de esa auditoría (evidencias, hallazgos, reportes) |
| `/admin/audit-logs` | *(solo platform admin)* Audit logs de toda la plataforma, filtrables por organización/acción |
| `/settings/retention` | *(`ciso` o platform admin)* Configura días de retención de evidencias y ve estadísticas de purga |
| `/settings/account` | Cualquier usuario autenticado: cambia su propia contraseña sin cerrar la sesión actual |

Selector de idioma (ES neutro / EN) en todas las pantallas, persistido en
`localStorage`.

---

## Limitaciones conocidas / próximos pasos

- El worker de escaneo requiere `nmap` instalado donde corra; si no está, la
  auditoría queda en `failed` (no se inventan resultados). Los chequeos de
  TLS/cabeceras HTTP no dependen de nmap.
- El "log de actividad" que se ve al abrir el detalle de una organización en
  `/admin` sigue siendo una vista liviana basada en `created_at` (últimas
  auditorías/activos/evidencias) — es distinto del audit log real e
  inmutable (`audit_logs`, ver `/admin/audit-logs` y `/audits/[id]/history`),
  que sí instrumenta cada escritura relevante con actor/IP/payload.
- La estimación de almacenamiento en `/admin` suma `audit_evidences.size_bytes`
  (ya se guarda por evidencia); no consulta la Management API de Supabase.
- La suite de tests (`npm test`) necesita un proyecto Supabase **de test**
  separado — no se puede correr sin esa infraestructura.
- No hay ningún flujo de invitación — cada quien crea su propia organización
  al registrarse; un platform admin reorganiza gente después vía `/admin`
  (ver "Gestión directa de usuarios" arriba). El cambio de contraseña
  (propio en `/settings/account`, administrativo en `/admin/users`) sí
  existe — ver "Persistencia de sesión y contraseñas" arriba.
- `npm test` no corre hoy contra `.env.test`: la clave
  `EVIDENCE_ENCRYPTION_KEY` de ese archivo tiene 42 caracteres en vez de los
  64 hex que exige `src/config/env.ts` (falla la validación de Zod antes de
  levantar cualquier suite). Es preexistente — no lo generó ningún cambio
  de esta sesión — y no se corrigió porque implica escribir una clave de
  cifrado nueva en un archivo de config sin que se haya pedido; hay que
  regenerarla (`openssl rand -hex 32`) a mano en `.env.test` para volver a
  correr los tests de integración.
- El panel FinOps (`/admin/costs`) calcula costos **estimados**, no reales:
  no hay integración con las APIs de facturación de Supabase/Upstash/el
  hosting (requerirían tokens de Management API distintos al service_role).
  Storage, escaneos (`scan_runs`, agregada para esto), reportes y miembros
  se miden con datos reales del sistema; el costo de hosting no tiene una
  métrica real disponible y se modela como un costo fijo mensual prorrateado
  por actividad. Las tarifas unitarias (denominadas en USD, como facturan
  los proveedores) son editables desde la propia UI, igual que el tipo de
  cambio USD→CLP usado para mostrar todo el panel en pesos chilenos
  (fila `fx_usd_clp`, valor semilla 950 — hay que ajustarla al tipo de
  cambio real).
- El worker de retención (`worker:retention`) corre como proceso aparte del
  API (igual que `worker:scan`); en producción hace falta levantarlo por
  separado (o migrar a un cron real del hosting) para que la purga diaria
  realmente se ejecute.
- La UI de gestión de riesgo (`/audits/[id]/report`) solo expone las
  transiciones `false_positive`/`accepted_risk`/volver a `open`; el estado
  `remediated` existe en el esquema pero no tiene flujo propio todavía.
- El botón "Ejecutar escaneo" de `/audits/[id]` reutiliza `POST
  /audits/:id/run-scan` sin pasar `asset_ids`: escanea todos los activos
  verificados de la organización, no solo los vinculados a esa auditoría
  puntual (comportamiento heredado del endpoint, no nuevo de este botón).
- La cuota de 3 escaneos del Piloto Invitado cuenta `scan_runs` (escaneos
  ya *completados*), no requests en curso: varias llamadas a
  `POST /run-scan` disparadas antes de que la primera termine podrían
  encolarse por encima de 3 en una ventana muy angosta. No aplica a la
  cuota de storage, que sí se valida contra el tamaño acumulado real antes
  de aceptar cada subida.
- El correo de delegación a TI (`POST /assets/:id/delegate-verification`)
  sigue el mismo patrón "preparado pero no conectado" que el resto de los
  emails del sistema: sin `RESEND_API_KEY`, el asunto/contenido queda en el
  log del servidor en vez de salir por correo real.
- La verificación de activos IP/CIDR es autoatestación de un `ciso` (no hay
  desafío DNS equivalente sencillo para un rango de IPs); no prueba
  criptográficamente la titularidad — a mejorar con RDAP/WHOIS cruzado
  contra el dominio corporativo ya verificado.
- La proyección a 12 meses de `/admin/internal-finops` es un run-rate
  constante del escenario simulado (sin curva de crecimiento ni churn) —
  útil para visualizar el punto de equilibrio dado el escenario actual, no
  como pronóstico real de crecimiento de clientes.
- El worker `worker:economic-indicators` es, igual que `worker:retention` y
  `worker:scan`, un proceso aparte del API; en producción hace falta
  levantarlo por separado para que la actualización diaria de UF/UTM/Dólar
  a las 08:00 realmente corra sola (el endpoint del panel igual se
  autoactualiza al vuelo si nadie lo hace, así que no es estrictamente
  necesario para que el panel funcione, solo para la garantía de frescura
  diaria).
- `/admin/kpis` reporta MRR/ARR/ARPU/margen bruto real en `0`/`null` porque
  no hay pasarela de pagos ni tabla de suscripciones conectada todavía (ver
  `financial.billingConnected: false` en la respuesta) — no es un bug, es
  el estado real hasta que exista facturación. La "tasa de conversión de
  prueba a pago" y el "churn rate" tampoco son calculables por el mismo
  motivo y se devuelven como `null`.
- "Último trimestre" en `/admin/kpis` se interpreta como los últimos 3
  meses corridos desde hoy (rolling), no el trimestre calendario anterior
  — evita ambigüedad de límites de trimestre.
- Reasignar la organización de un usuario (`POST /admin/users/assign-organization`)
  solo cambia su acceso hacia adelante — las auditorías/activos/evidencias
  que ya creó quedan tal como están, asociados a la organización original
  (vía `created_by`), no se migran ni se re-etiquetan.
- `GET /admin/users` trae hasta 1.000 usuarios en una sola página (vía
  `supabaseAdmin.auth.admin.listUsers`) — de sobra para la escala actual,
  pero habría que paginar de verdad si la plataforma creciera mucho más.
- El buscador universal de `/admin` (`Cmd/Ctrl+K`) filtra en el cliente
  contra el mismo límite de 1.000 usuarios + todas las organizaciones ya
  cargadas — no es un índice de búsqueda real ni un command palette con
  atajos de navegación, es un filtro por substring sobre datos que el
  panel ya tiene en memoria.
- El `plan` de una organización (`starter`/`pro`/`custom`) es una etiqueta
  administrativa editable desde `/admin/organizations`, no una suscripción
  real — no hay pasarela de pagos conectada, así que cambiarlo no activa
  ni desactiva ninguna funcionalidad todavía.
