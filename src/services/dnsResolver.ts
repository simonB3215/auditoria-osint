import { Resolver } from "node:dns/promises";

/**
 * Resolver con límites explícitos. `DNS_RESOLVER_SERVER` permite apuntar a otro
 * servidor: los tests lo usan para resolver de verdad contra un DNS local.
 */
export function createDnsResolver(options: { timeout?: number; tries?: number } = {}): Resolver {
  const resolver = new Resolver({ timeout: options.timeout ?? 5_000, tries: options.tries ?? 2 });
  if (process.env.DNS_RESOLVER_SERVER) resolver.setServers([process.env.DNS_RESOLVER_SERVER]);
  return resolver;
}
