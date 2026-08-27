import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CORS_ORIGIN: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  // Publishable key (sb_publishable_...) o, en proyectos viejos, la anon key legacy.
  SUPABASE_ANON_KEY: z.string().min(1),
  // Secret key (sb_secret_...) o, en proyectos viejos, la service_role key legacy.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  REDIS_URL: z.string().min(1),
  // Conexión directa a Postgres — hoy solo la lee `db/run-migrations.ts`
  // (npm run db:migrate), la API no la usa en runtime. Se valida acá de
  // todas formas, como requerida (prompts.md, "Parte 2 - Cierre del
  // schema de Zod"): antes no estaba en este schema y su ausencia recién
  // se notaba al correr una migración, en vez de al arrancar cualquier
  // cosa — falla rápido y en un solo lugar en vez de tarde y disperso.
  DATABASE_URL: z.string().min(1),
  EVIDENCE_BUCKET: z.string().default("evidences"),
  REPORTS_BUCKET: z.string().default("reports"),
  // Límite duro de activos por organización (plan MVP). Configurable sin
  // tocar la lógica de negocio; el valor por defecto no cambió (Fase de
  // auditoría pre-venta, a.md sección 2.2).
  MAX_ASSETS_PER_ORG: z.coerce.number().int().positive().default(5),
  // Techo de escaneos simultáneos (queued/running) por organización, para
  // que un solo tenant no pueda monopolizar los slots de `concurrency`
  // del scanWorker en perjuicio de las demás (a.md, hardening del motor
  // de escaneo, sección 1.4). Con concurrency=4 en el worker, 2 asegura
  // que ninguna organización ocupe más de la mitad de los slots globales.
  MAX_CONCURRENT_SCANS_PER_ORG: z.coerce.number().int().positive().default(2),
  // Cuántos puertos más comunes escanea nmap (--top-ports). Configuración
  // GLOBAL por entorno (no por auditoría): hacerlo por auditoría exigiría
  // una columna nueva en `audits`/`audit_assets` — una migración, fuera de
  // lo que corresponde a un "arreglo a aplicar" de esta fase (a.md,
  // seguimiento del motor de escaneo, Tarea 3). Tope máximo duro en 5000:
  // deja margen por sobre el default sin acercarse a un barrido casi
  // completo (65535) por configuración — para eso hace falta un flag
  // aparte que hoy no existe.
  SCAN_TOP_PORTS: z.coerce
    .number()
    .int()
    .positive()
    .max(5000, "SCAN_TOP_PORTS no puede superar 5000 (evita un barrido casi completo por configuración)")
    .default(1000),
  // Clave AES-256 (32 bytes) en hex, para cifrar evidencias antes de subirlas a Storage.
  EVIDENCE_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "Debe ser una clave hexadecimal de 64 caracteres (32 bytes)"),
  // OPCIONAL a propósito (prompts.md, "Parte 2 - Cierre del schema de
  // Zod"): el envío de emails es best-effort ("preparado pero no
  // conectado" — ver emailTemplates.ts). Su ausencia es un estado válido
  // que activa el fallback de log en consola, no un error de
  // configuración — hacerla requerida rompería ese diseño.
  RESEND_API_KEY: z.string().min(1).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variables de entorno inválidas:", parsed.error.flatten().fieldErrors);
  throw new Error("Configuración de entorno inválida. Revisa tu archivo .env contra .env.example");
}

export const env = parsed.data;
