import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en tu .env");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const BUCKETS = [
  { id: process.env.EVIDENCE_BUCKET ?? "evidences", fileSizeLimit: "20MB" },
  { id: process.env.REPORTS_BUCKET ?? "reports", fileSizeLimit: "10MB" },
  { id: process.env.DOMAIN_DECLARATION_BUCKET ?? "domain-declarations", fileSizeLimit: "11MB" },
];

async function main() {
  const { data: existing, error: listError } = await admin.storage.listBuckets();
  if (listError) throw new Error(`No se pudieron listar los buckets: ${listError.message}`);
  const existingIds = new Set((existing ?? []).map((b) => b.id));

  for (const bucket of BUCKETS) {
    if (existingIds.has(bucket.id)) {
      console.log(`Bucket "${bucket.id}" ya existe. Sin cambios.`);
      continue;
    }

    // Privados: nunca se exponen directamente al cliente. Las evidencias se
    // sirven descifrándolas vía backend; los reportes vía signed URL de
    // corta duración (ver src/routes/reports.ts).
    const { error } = await admin.storage.createBucket(bucket.id, {
      public: false,
      fileSizeLimit: bucket.fileSizeLimit,
    });
    if (error) throw new Error(`No se pudo crear el bucket "${bucket.id}": ${error.message}`);
    console.log(`✅ Bucket "${bucket.id}" creado (privado, límite ${bucket.fileSizeLimit}).`);
  }
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
