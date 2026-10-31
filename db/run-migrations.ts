import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "Falta DATABASE_URL en tu .env.\n" +
      "Buscala en Supabase: Project Settings > Database > Connection string > URI\n" +
      '(usá la conexión directa, no la del pooler, y reemplazá "[YOUR-PASSWORD]" por tu password real).'
  );
  process.exit(1);
}

const files = [
  join(__dirname, "schema.sql"),
  ...readdirSync(join(__dirname, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(__dirname, "migrations", f)),
];

async function main() {
  const client = new pg.Client({
    connectionString: databaseUrl,
    // El stack local de Supabase (CI) no acepta SSL; el proyecto en la nube sí.
    ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl) ? false : { rejectUnauthorized: false },
  });

  await client.connect();

  // Lleva registro de qué archivos ya se aplicaron, para que el script sea
  // seguro de re-correr: cada vez que se agrega una migración nueva, solo
  // se ejecuta esa (schema.sql y las migraciones en sí no son idempotentes).
  await client.query(`
    create table if not exists _migrations_applied (
      filename text primary key,
      applied_at timestamptz not null default now()
    );
  `);
  const { rows } = await client.query<{ filename: string }>("select filename from _migrations_applied");
  const alreadyApplied = new Set(rows.map((r) => r.filename));

  const pending = files.filter((f) => !alreadyApplied.has(f.replace(__dirname, "db")));

  if (pending.length === 0) {
    console.log("Nada para aplicar — ya está todo al día.");
    await client.end();
    return;
  }

  console.log(`Conectado a la base. Voy a ejecutar ${pending.length} archivo(s) pendiente(s):`);
  pending.forEach((f) => console.log(`  - ${f.replace(__dirname, "db")}`));

  for (const file of pending) {
    const label = file.replace(__dirname, "db");
    const sql = readFileSync(file, "utf8");
    process.stdout.write(`\n>>> ${label} ... `);
    try {
      await client.query(sql);
      await client.query("insert into _migrations_applied (filename) values ($1)", [label]);
      console.log("OK");
    } catch (err) {
      console.log("FALLÓ");
      console.error(err instanceof Error ? err.message : err);
      await client.end();
      process.exit(1);
    }
  }

  console.log("\nListo — esquema y migraciones aplicados.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
