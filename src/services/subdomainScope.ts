import { Resolver } from "node:dns/promises";

const MAX_CNAME_DEPTH = 8;

export type SubdomainScope =
  | { ok: true }
  | { ok: false; reason: "third_party_cname"; target: string }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "dns_unavailable" };

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

/** `app.empresa.cl` es subdominio de `empresa.cl`; `otraempresa.cl` no, aunque termine igual. */
export function isSubdomainOf(host: string, parent: string): boolean {
  return normalizeHost(host).endsWith(`.${normalizeHost(parent)}`);
}

/**
 * Sigue la cadena de CNAME: si sale del dominio padre, esa infraestructura es de
 * un tercero (SaaS, CDN) y verificar el padre no autoriza a escanearla. Falla
 * cerrado: sin una respuesta clara de DNS, el subdominio no se considera propio.
 */
export async function checkSubdomainScope(subdomain: string, parentDomain: string): Promise<SubdomainScope> {
  const resolver = new Resolver({ timeout: 5_000, tries: 2 });
  if (process.env.DNS_RESOLVER_SERVER) resolver.setServers([process.env.DNS_RESOLVER_SERVER]);

  let current = normalizeHost(subdomain);
  for (let depth = 0; depth < MAX_CNAME_DEPTH; depth++) {
    let targets: string[];
    try {
      targets = await resolver.resolveCname(current);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // ENODATA: el nombre existe y no es un CNAME, la cadena termina acá.
      if (code === "ENODATA") return { ok: true };
      if (code === "ENOTFOUND") return { ok: false, reason: "not_found" };
      return { ok: false, reason: "dns_unavailable" };
    }

    const target = normalizeHost(targets[0] ?? "");
    if (!isSubdomainOf(target, parentDomain) && target !== normalizeHost(parentDomain)) {
      return { ok: false, reason: "third_party_cname", target };
    }
    current = target;
  }
  return { ok: false, reason: "dns_unavailable" };
}
