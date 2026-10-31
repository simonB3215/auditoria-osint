import type { OpenPort, TlsCertFinding, HeaderFinding } from "../jobs/scanEngine.js";

export type FindingSeverity = "critical" | "high" | "medium" | "low";

export interface NormalizedFinding {
  audit_id: string;
  asset_id: string;
  source_engine: string;
  title: string;
  severity: FindingSeverity;
  detail: string;
  remediation: string;
}

/**
 * Heurística de severidad por puerto/servicio expuesto. Es una aproximación
 * razonable para un MVP (protocolos en texto plano o de administración
 * remota se consideran de mayor riesgo); no reemplaza un análisis de
 * vulnerabilidades real (CVE matching, versión exacta del servicio, etc.).
 */
const SEVERITY_BY_PORT: Record<number, { severity: FindingSeverity; label: string; remediation: string }> = {
  21: { severity: "high", label: "FTP en texto plano expuesto", remediation: "Reemplazar por SFTP/FTPS o restringir el acceso por firewall." },
  23: { severity: "critical", label: "Telnet (texto plano) expuesto", remediation: "Deshabilitar Telnet; usar SSH." },
  25: { severity: "medium", label: "SMTP expuesto", remediation: "Restringir a IPs conocidas y verificar que no permita relay abierto." },
  445: { severity: "high", label: "SMB expuesto a la red", remediation: "Restringir SMB a la red interna; nunca exponerlo a Internet." },
  3306: { severity: "high", label: "MySQL expuesto a la red", remediation: "Restringir el acceso a la base de datos solo a hosts de aplicación conocidos." },
  3389: { severity: "high", label: "RDP expuesto a la red", remediation: "Colocar detrás de VPN/bastion host y exigir MFA." },
  5432: { severity: "high", label: "PostgreSQL expuesto a la red", remediation: "Restringir el acceso a la base de datos solo a hosts de aplicación conocidos." },
  6379: { severity: "critical", label: "Redis expuesto sin autenticación por defecto", remediation: "Habilitar `requirepass`/ACLs y restringir por firewall." },
  27017: { severity: "high", label: "MongoDB expuesto a la red", remediation: "Restringir el acceso a la base de datos solo a hosts de aplicación conocidos." },
};

function classifyPort(port: number): { severity: FindingSeverity; label: string; remediation: string } {
  return (
    SEVERITY_BY_PORT[port] ?? {
      severity: "medium" as const,
      label: "Puerto abierto no clasificado",
      remediation: "Confirmar que el servicio expuesto es intencional y necesario; cerrar si no lo es.",
    }
  );
}

export function normalizeOpenPorts(
  auditId: string,
  assetId: string,
  assetValue: string,
  openPorts: OpenPort[]
): NormalizedFinding[] {
  return openPorts.map((p) => {
    const classification = classifyPort(p.port);
    return {
      audit_id: auditId,
      asset_id: assetId,
      source_engine: "nmap",
      title: `${classification.label}: puerto ${p.port}/${p.protocol} (${p.service}) en ${assetValue}`,
      severity: classification.severity,
      detail: `Nmap detectó el puerto ${p.port}/${p.protocol} abierto ejecutando "${p.service}" en ${assetValue}.`,
      remediation: classification.remediation,
    };
  });
}

const TLS_SEVERITY: Record<TlsCertFinding["kind"], FindingSeverity> = {
  expired_cert: "critical",
  untrusted_cert: "high",
  weak_protocol: "high",
  expiring_soon_cert: "medium",
};

const TLS_TITLE: Record<TlsCertFinding["kind"], string> = {
  expired_cert: "Certificado TLS vencido",
  untrusted_cert: "Certificado TLS no confiable",
  weak_protocol: "Protocolo TLS débil habilitado",
  expiring_soon_cert: "Certificado TLS por vencer",
};

const TLS_REMEDIATION: Record<TlsCertFinding["kind"], string> = {
  expired_cert: "Renovar el certificado TLS inmediatamente.",
  untrusted_cert: "Instalar un certificado emitido por una CA reconocida (evitar self-signed en producción).",
  weak_protocol: "Deshabilitar TLSv1/TLSv1.1/SSLv3 en el servidor; exigir TLSv1.2 o superior.",
  expiring_soon_cert: "Renovar el certificado antes de que venza; considerar renovación automática.",
};

export function normalizeTlsFindings(
  auditId: string,
  assetId: string,
  assetValue: string,
  port: number,
  findings: TlsCertFinding[]
): NormalizedFinding[] {
  return findings.map((f) => ({
    audit_id: auditId,
    asset_id: assetId,
    source_engine: "tls-check",
    title: `${TLS_TITLE[f.kind]} en ${assetValue}:${port}`,
    severity: TLS_SEVERITY[f.kind],
    detail: f.detail,
    remediation: TLS_REMEDIATION[f.kind],
  }));
}

export function normalizeHeaderFindings(
  auditId: string,
  assetId: string,
  assetValue: string,
  port: number,
  useHttps: boolean,
  findings: HeaderFinding[]
): NormalizedFinding[] {
  return findings.map((f) => ({
    audit_id: auditId,
    asset_id: assetId,
    source_engine: "http-headers",
    title: `Cabecera de seguridad faltante (${f.header}) en ${assetValue}:${port}`,
    severity: "low",
    detail: `${useHttps ? "https" : "http"}://${assetValue}:${port}/ no incluye la cabecera "${f.header}".`,
    remediation: `Agregar la cabecera "${f.header}" a las respuestas del servidor web.`,
  }));
}

// ------------------------------------------------------------
// Módulo C (OSINT). Ninguno es `critical`: son señales indirectas de fuentes
// públicas, no hallazgos confirmados. Los títulos no llevan datos variables,
// porque identifican al hallazgo al repetir una corrida en la misma auditoría.
// ------------------------------------------------------------

export interface DnsLookup {
  status: "found" | "none" | "error";
  records: string[];
}

export interface EmailDnsPosture {
  spf: DnsLookup;
  dmarc: DnsLookup;
  mx: DnsLookup;
  dkimSelectors: string[];
  /** Todas las consultas de selectores respondieron. */
  dkimComplete: boolean;
}

const MAX_SPF_LOOKUPS = 10;

function dmarcTag(record: string, tag: string): string | undefined {
  return new RegExp(`(?:^|;)\\s*${tag}\\s*=\\s*([^;]+)`, "i").exec(record)?.[1]?.trim().toLowerCase();
}

/**
 * Solo cuenta `status: "none"` como registro ausente: una consulta caída no
 * permite afirmar nada. Las consultas SPF se cuentan en el registro raíz, sin
 * seguir cada `include`, así que el conteo real puede ser mayor.
 */
export function buildEmailDnsFindings(
  auditId: string,
  assetId: string,
  domain: string,
  posture: EmailDnsPosture
): { findings: NormalizedFinding[]; summary: Record<string, unknown> } {
  const findings: NormalizedFinding[] = [];
  const add = (title: string, severity: FindingSeverity, detail: string, remediation: string) =>
    findings.push({ audit_id: auditId, asset_id: assetId, source_engine: "osint-email-dns", title, severity, detail, remediation });

  const spfRecords = posture.spf.records.filter((record) => /^v=spf1(\s|$)/i.test(record.trim()));
  const spf = spfRecords[0];
  if (posture.spf.status !== "error") {
    if (spfRecords.length === 0) {
      add(
        "Sin registro SPF",
        "high",
        `${domain} no publica SPF: cualquiera puede enviar correo a su nombre sin que los destinatarios puedan comprobarlo.`,
        'Publicar un registro TXT SPF con los servidores autorizados, terminado en "-all" o "~all".'
      );
    } else if (spfRecords.length > 1) {
      add(
        "Más de un registro SPF",
        "medium",
        `${domain} publica ${spfRecords.length} registros SPF, y con más de uno SPF falla en la validación.`,
        "Unificar todo en un solo registro SPF."
      );
    } else if (/(^|\s)\+all(\s|$)/i.test(spf!)) {
      add(
        "SPF permite enviar desde cualquier servidor",
        "high",
        `El SPF de ${domain} termina en "+all", así que autoriza a cualquier servidor.`,
        'Reemplazar "+all" por "-all" o "~all", listando los servidores autorizados.'
      );
    } else if (!/(^|\s)[-~]all(\s|$)/i.test(spf!)) {
      add(
        "SPF no bloquea remitentes no autorizados",
        "medium",
        `El SPF de ${domain} no termina en "-all" ni "~all", así que no indica qué hacer con otros remitentes.`,
        'Terminar el registro SPF en "-all" o "~all".'
      );
    } else {
      const lookups = spf!.match(/(^|\s)[+?~-]?(include:|a(:|\s|$)|mx(:|\s|$)|ptr(:|\s|$)|exists:|redirect=)/gi)?.length ?? 0;
      if (lookups > MAX_SPF_LOOKUPS) {
        add(
          "SPF con más de 10 consultas DNS",
          "medium",
          `El SPF de ${domain} usa ${lookups} mecanismos con consulta DNS. Por encima de 10, la validación SPF falla.`,
          "Reducir los mecanismos include, a y mx del registro SPF."
        );
      }
    }
  }

  const dmarc = posture.dmarc.records.find((record) => /^v=DMARC1/i.test(record.trim()));
  const dmarcPolicy = dmarc ? dmarcTag(dmarc, "p") : undefined;
  if (posture.dmarc.status !== "error") {
    if (!dmarc) {
      add(
        "Sin registro DMARC",
        "high",
        `${domain} no publica DMARC: los destinatarios no saben qué hacer con correo falsificado a su nombre.`,
        'Publicar DMARC en _dmarc con "p=none" y "rua" para recibir reportes, y avanzar a "p=quarantine" y luego "p=reject".'
      );
    } else if (dmarcPolicy === "none" || !dmarcPolicy) {
      add(
        "DMARC solo observa y no bloquea",
        "medium",
        `El DMARC de ${domain} no pide rechazar ni aislar el correo que falla la validación.`,
        'Revisar los reportes y avanzar a "p=quarantine" y luego "p=reject".'
      );
    } else {
      const pct = Number(dmarcTag(dmarc, "pct") ?? 100);
      if (pct < 100) {
        add(
          "DMARC se aplica solo a parte del correo",
          "low",
          `El DMARC de ${domain} se aplica al ${pct} % del correo.`,
          'Subir "pct" a 100 o quitarlo.'
        );
      }
      if (!dmarcTag(dmarc, "rua")) {
        add(
          "DMARC sin dirección de reportes",
          "low",
          `El DMARC de ${domain} no tiene "rua", así que no se reciben reportes de quién envía a su nombre.`,
          'Agregar "rua=mailto:" con una casilla para recibir reportes.'
        );
      }
    }
  }

  if (posture.dkimComplete && posture.dkimSelectors.length === 0) {
    add(
      "No se encontró DKIM en los selectores habituales",
      "low",
      `No apareció una clave DKIM en los selectores habituales de ${domain}. Puede usar otro selector: esto no prueba que no tenga DKIM.`,
      "Confirmar con el proveedor de correo que DKIM esté activo."
    );
  }

  return {
    findings,
    summary: {
      spf: spf ?? null,
      dmarcPolicy: dmarcPolicy ?? null,
      dkimSelectors: posture.dkimSelectors,
      mx: posture.mx.records,
    },
  };
}

const SENSITIVE_SUBDOMAIN_LABEL = /^(dev|staging|test|admin|vpn|jenkins|git)(?:[-0-9]|$)/i;
const MAX_HOSTS_IN_FINDING = 20;

function listHosts(hosts: string[]): string {
  const shown = hosts.slice(0, MAX_HOSTS_IN_FINDING).join(", ");
  return hosts.length > MAX_HOSTS_IN_FINDING ? `${shown} y ${hosts.length - MAX_HOSTS_IN_FINDING} más` : shown;
}

/** Un hallazgo por dominio y tipo, en vez de uno por nombre: una lista larga no debe inundar el reporte. */
export function buildCtFindings(
  auditId: string,
  assetId: string,
  domain: string,
  unregisteredHosts: string[]
): NormalizedFinding[] {
  if (unregisteredHosts.length === 0) return [];
  const base = { audit_id: auditId, asset_id: assetId, source_engine: "osint-ct" };

  const findings: NormalizedFinding[] = [
    {
      ...base,
      title: "Subdominios públicos fuera del inventario",
      severity: "low",
      detail: `${unregisteredHosts.length} subdominio(s) de ${domain} aparecen en registros públicos de certificados y no están registrados como activos: ${listHosts(unregisteredHosts)}.`,
      remediation: "Revisar cuáles siguen en uso, registrarlos como activos y dar de baja los que sobren.",
    },
  ];

  const sensitive = unregisteredHosts.filter((host) =>
    host
      .slice(0, -(domain.length + 1))
      .split(".")
      .some((label) => SENSITIVE_SUBDOMAIN_LABEL.test(label))
  );
  if (sensitive.length > 0) {
    findings.push({
      ...base,
      title: "Subdominios con nombre sensible",
      severity: "medium",
      detail: `Estos nombres sugieren entornos internos o de administración visibles públicamente: ${listHosts(sensitive)}.`,
      remediation: "Confirmar que no deban ser públicos y restringir su acceso. Registrarlos como activos permite medir su exposición con el Módulo A.",
    });
  }
  return findings;
}

export interface ArchivedUrl {
  /** Host y ruta, sin query. */
  url: string;
  pattern: string;
  kind: "sensitive_file" | "access_panel";
}

const ARCHIVED_PATH_PATTERNS: Array<{ pattern: string; kind: ArchivedUrl["kind"]; regex: RegExp }> = [
  { pattern: ".env", kind: "sensitive_file", regex: /(^|\/)\.env(\.[^/]*)?$/ },
  { pattern: ".git", kind: "sensitive_file", regex: /(^|\/)\.git(\/|$)/ },
  { pattern: "wp-config", kind: "sensitive_file", regex: /(^|\/)wp-config(\.[^/]*)?$/ },
  { pattern: ".sql", kind: "sensitive_file", regex: /\.sql(\.(gz|zip|bak))?$/ },
  { pattern: ".bak", kind: "sensitive_file", regex: /\.bak$/ },
  { pattern: ".zip", kind: "sensitive_file", regex: /\.zip$/ },
  { pattern: "backup", kind: "sensitive_file", regex: /(^|[/._-])backups?([/._-]|$)/ },
  { pattern: "admin", kind: "access_panel", regex: /(^|\/)(wp-)?admin(istrator)?(\/|\.[^/]*)?$/ },
  { pattern: "login", kind: "access_panel", regex: /(^|\/)(wp-)?login(\/|\.[^/]*)?$/ },
];

/** Compara solo la ruta, para que un dominio como `admin.empresa.cl` no marque todas sus URLs. */
export function classifyArchivedPath(pathname: string): Pick<ArchivedUrl, "pattern" | "kind"> | null {
  const path = pathname.toLowerCase();
  const match = ARCHIVED_PATH_PATTERNS.find(({ regex }) => regex.test(path));
  return match ? { pattern: match.pattern, kind: match.kind } : null;
}

const MAX_ARCHIVED_EXAMPLES = 20;
const MAX_ARCHIVED_URL_LENGTH = 120;

function truncateUrl(url: string): string {
  return url.length > MAX_ARCHIVED_URL_LENGTH ? `${url.slice(0, MAX_ARCHIVED_URL_LENGTH)}…` : url;
}

/** Que una URL esté archivada no prueba que siga expuesta, y el texto lo deja claro. */
export function buildArchiveFindings(
  auditId: string,
  assetId: string,
  domain: string,
  urls: ArchivedUrl[]
): { findings: NormalizedFinding[]; summary: Record<string, unknown> } {
  const base = { audit_id: auditId, asset_id: assetId, source_engine: "osint-archive" };
  const listOf = (kind: ArchivedUrl["kind"]) => {
    const matching = urls.filter((archived) => archived.kind === kind).map((archived) => truncateUrl(archived.url));
    const shown = matching.slice(0, MAX_ARCHIVED_EXAMPLES).join(", ");
    return {
      count: matching.length,
      shown: matching.length > MAX_ARCHIVED_EXAMPLES ? `${shown} y ${matching.length - MAX_ARCHIVED_EXAMPLES} más` : shown,
    };
  };

  const findings: NormalizedFinding[] = [];
  const files = listOf("sensitive_file");
  if (files.count > 0) {
    findings.push({
      ...base,
      title: "Archivos sensibles en el archivo web",
      severity: "medium",
      detail: `${files.count} URL(s) de ${domain} con nombre de configuración, base de datos o respaldo quedaron archivadas públicamente. No prueba que sigan expuestas: ${files.shown}.`,
      remediation: "Confirmar que ya no respondan, cambiar cualquier credencial que hayan contenido y pedir su retiro del archivo si corresponde.",
    });
  }
  const panels = listOf("access_panel");
  if (panels.count > 0) {
    findings.push({
      ...base,
      title: "Paneles de acceso en el archivo web",
      severity: "low",
      detail: `${panels.count} URL(s) de paneles de acceso de ${domain} quedaron archivadas públicamente: ${panels.shown}.`,
      remediation: "Confirmar si siguen en uso y restringir su acceso a redes o usuarios autorizados.",
    });
  }

  const byPattern: Record<string, number> = {};
  for (const archived of urls) byPattern[archived.pattern] = (byPattern[archived.pattern] ?? 0) + 1;

  return {
    findings,
    summary: {
      total: urls.length,
      byPattern,
      examples: urls.slice(0, MAX_ARCHIVED_EXAMPLES).map((archived) => truncateUrl(archived.url)),
    },
  };
}
