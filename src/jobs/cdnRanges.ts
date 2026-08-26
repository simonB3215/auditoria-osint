export interface CdnRange {
  provider: string;
  cidr: string;
}

/**
 * Rangos de IP publicados oficialmente por proveedores de CDN/proxy
 * conocidos. Se usa para detectar cuando un dominio verificado resuelve a
 * infraestructura de un tercero (Regla de alcance 1: "solo activos
 * verificados y dentro del alcance" — a.md, hardening del motor de
 * escaneo, sección 1.1) — en ese caso el escaneo NO se ejecuta contra esa
 * IP, porque el resultado describiría la postura del proxy, no la del
 * cliente.
 *
 * Fuente: Cloudflare publica sus rangos oficialmente en
 * https://www.cloudflare.com/ips-v4/ y https://www.cloudflare.com/ips-v6/
 * (última verificación manual contra esa fuente: 2026-08-25). Son rangos
 * estables que rara vez cambian, pero conviene revisarlos periódicamente
 * contra la fuente oficial — no hay una tarea automática que los
 * refresque todavía.
 *
 * Cobertura actual: solo Cloudflare (el mínimo que pedía a.md). No se
 * agregaron otros proveedores (Akamai, Fastly, AWS CloudFront, etc.)
 * porque no había una fuente de datos igual de confiable/verificable
 * disponible en este momento — mejor dejarlo afuera que inventar rangos
 * no confirmados. Ver el reporte de esta fase para el detalle.
 */
export const CDN_PROXY_RANGES: CdnRange[] = [
  // Cloudflare — IPv4 (https://www.cloudflare.com/ips-v4/)
  { provider: "cloudflare", cidr: "173.245.48.0/20" },
  { provider: "cloudflare", cidr: "103.21.244.0/22" },
  { provider: "cloudflare", cidr: "103.22.200.0/22" },
  { provider: "cloudflare", cidr: "103.31.4.0/22" },
  { provider: "cloudflare", cidr: "141.101.64.0/18" },
  { provider: "cloudflare", cidr: "108.162.192.0/18" },
  { provider: "cloudflare", cidr: "190.93.240.0/20" },
  { provider: "cloudflare", cidr: "188.114.96.0/20" },
  { provider: "cloudflare", cidr: "197.234.240.0/22" },
  { provider: "cloudflare", cidr: "198.41.128.0/17" },
  { provider: "cloudflare", cidr: "162.158.0.0/15" },
  { provider: "cloudflare", cidr: "104.16.0.0/13" },
  { provider: "cloudflare", cidr: "104.24.0.0/14" },
  { provider: "cloudflare", cidr: "172.64.0.0/13" },
  { provider: "cloudflare", cidr: "131.0.72.0/22" },
  // Cloudflare — IPv6 (https://www.cloudflare.com/ips-v6/)
  { provider: "cloudflare", cidr: "2400:cb00::/32" },
  { provider: "cloudflare", cidr: "2606:4700::/32" },
  { provider: "cloudflare", cidr: "2803:f800::/32" },
  { provider: "cloudflare", cidr: "2405:b500::/32" },
  { provider: "cloudflare", cidr: "2405:8100::/32" },
  { provider: "cloudflare", cidr: "2a06:98c0::/29" },
  { provider: "cloudflare", cidr: "2c0f:f248::/32" },
];
