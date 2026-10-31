import { createDnsResolver } from "../dnsResolver.js";
import {
  buildEmailDnsFindings,
  type DnsLookup,
  type EmailDnsPosture,
} from "../findingsNormalization.js";
import { readOsintCache, writeOsintCache } from "./cache.js";
import type { OsintSource } from "./types.js";

/** No se puede listar qué selectores usa un dominio: solo se prueban los habituales. */
const COMMON_DKIM_SELECTORS = ["default", "google", "selector1", "selector2", "k1", "mail", "dkim", "s1", "s2"];

type TxtLookup = DnsLookup | "nxdomain";

function classifyDnsError(err: unknown): TxtLookup {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOTFOUND") return "nxdomain";
  if (code === "ENODATA") return { status: "none", records: [] };
  return { status: "error", records: [] };
}

function asLookup(result: TxtLookup): DnsLookup {
  return result === "nxdomain" ? { status: "none", records: [] } : result;
}

/**
 * SPF, DMARC, DKIM y MX. Son consultas DNS estándar al resolver, sin conexión a
 * los servidores del cliente. Un dominio inexistente no genera hallazgos, y una
 * consulta que falló nunca se informa como "no existe el registro".
 */
export const emailDnsSource: OsintSource = {
  id: "email_dns",
  async run({ organizationId, auditId, assetId, domain }) {
    const cached = await readOsintCache<EmailDnsPosture>(organizationId, "email_dns", domain);
    let posture = cached;

    if (!posture) {
      const resolver = createDnsResolver();
      const lookupTxt = (name: string): Promise<TxtLookup> =>
        resolver
          .resolveTxt(name)
          .then((records): TxtLookup => ({ status: "found", records: records.map((chunks) => chunks.join("")) }))
          .catch(classifyDnsError);

      const root = await lookupTxt(domain);
      if (root === "nxdomain") {
        return { status: "no_data", detail: "El dominio no existe en DNS" };
      }

      const [dmarc, mx, ...dkim] = await Promise.all([
        lookupTxt(`_dmarc.${domain}`),
        resolver
          .resolveMx(domain)
          .then((records): DnsLookup => ({
            status: "found",
            records: records.sort((a, b) => a.priority - b.priority).map((record) => record.exchange),
          }))
          .catch((err): TxtLookup => classifyDnsError(err)),
        ...COMMON_DKIM_SELECTORS.map((selector) => lookupTxt(`${selector}._domainkey.${domain}`)),
      ]);

      posture = {
        spf: root,
        dmarc: asLookup(dmarc),
        mx: asLookup(mx),
        dkimSelectors: COMMON_DKIM_SELECTORS.filter((_, index) => {
          const lookup = dkim[index]!;
          return lookup !== "nxdomain" && lookup.status === "found" && lookup.records.some((record) => /(^|;)\s*p=/.test(record));
        }),
        // Sin selector encontrado y con consultas caídas, no se puede afirmar que no haya DKIM.
        dkimComplete: dkim.every((lookup) => lookup === "nxdomain" || lookup.status !== "error"),
      };
    }

    const incomplete = posture.spf.status === "error" || posture.dmarc.status === "error" || !posture.dkimComplete;
    const allFailed = posture.spf.status === "error" && posture.dmarc.status === "error" && posture.mx.status === "error";

    if (!cached && !incomplete) await writeOsintCache(organizationId, "email_dns", domain, posture);

    const { findings, summary } = buildEmailDnsFindings(auditId, assetId, domain, posture);
    return {
      status: allFailed ? "failed" : incomplete ? "partial" : "ok",
      detail: allFailed ? "El DNS no respondió" : incomplete ? "Algunas consultas DNS no respondieron" : undefined,
      cached: cached !== null,
      findings,
      summary,
    };
  },
};
