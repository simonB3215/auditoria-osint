export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

/**
 * Delegación a TI (a.md, sección "Flujo de Delegación a TI"): quien pide la
 * auditoría a menudo no tiene acceso al panel DNS de su propio dominio.
 * Este correo le da al equipo técnico todo lo necesario para crear el
 * registro sin tener que crear una cuenta en Aegis ni entender qué es una
 * "verificación de propiedad".
 */
export interface DomainDelegationEmailParams {
  requesterName: string;
  organizationName: string;
  domain: string;
  verificationToken: string;
  verifyUrl: string;
}

export function buildDomainDelegationEmail(params: DomainDelegationEmailParams): EmailTemplate {
  const txtValue = `aegis-site-verification=${params.verificationToken}`;
  const subject = "Requerimiento técnico: Validación de dominio para auditoría en Aegis CyberAudit";
  const text =
    `Hola,\n\n` +
    `${params.requesterName}, de ${params.organizationName}, solicitó una auditoría de ciberseguridad en Aegis CyberAudit ` +
    `y necesita demostrar la propiedad del dominio ${params.domain} para poder autorizar los escaneos técnicos ` +
    `(Ley N° 21.663 exige esta comprobación antes de escanear infraestructura de terceros).\n\n` +
    `Para autorizarlo, agregá el siguiente registro DNS en el panel de administración del dominio (Cloudflare, NIC Chile, GoDaddy, AWS, etc.):\n\n` +
    `  Tipo:   TXT\n` +
    `  Nombre: @ (raíz de ${params.domain})\n` +
    `  Valor:  ${txtValue}\n\n` +
    `Una vez creado el registro (puede tardar unos minutos en propagarse), ${params.requesterName} puede confirmar la verificación desde: ${params.verifyUrl}\n\n` +
    `— El equipo de Aegis CyberAudit`;
  const html =
    `<p>Hola,</p>` +
    `<p><strong>${params.requesterName}</strong>, de <strong>${params.organizationName}</strong>, solicitó una auditoría de ciberseguridad en Aegis CyberAudit ` +
    `y necesita demostrar la propiedad del dominio <strong>${params.domain}</strong> para poder autorizar los escaneos técnicos ` +
    `(la Ley N° 21.663 exige esta comprobación antes de escanear infraestructura de terceros).</p>` +
    `<p>Para autorizarlo, agregá el siguiente registro DNS en el panel de administración del dominio (Cloudflare, NIC Chile, GoDaddy, AWS, etc.):</p>` +
    `<table cellpadding="4" style="border-collapse:collapse;border:1px solid #ddd">` +
    `<tr><td><strong>Tipo</strong></td><td>TXT</td></tr>` +
    `<tr><td><strong>Nombre</strong></td><td>@ (raíz de ${params.domain})</td></tr>` +
    `<tr><td><strong>Valor</strong></td><td><code>${txtValue}</code></td></tr>` +
    `</table>` +
    `<p>Una vez creado el registro (puede tardar unos minutos en propagarse), ${params.requesterName} puede confirmar la verificación desde: <a href="${params.verifyUrl}">${params.verifyUrl}</a></p>` +
    `<p>— El equipo de Aegis CyberAudit</p>`;
  return { subject, html, text };
}

/**
 * Patrón "preparado pero no conectado": sin `RESEND_API_KEY` no hay
 * proveedor real, así que se registra en consola para poder verificar el
 * contenido sin depender de infraestructura de correo. Devuelve la
 * plantilla renderizada para que la ruta pueda auditarla (payload del
 * evento) sin volver a construirla.
 */
export async function sendDomainDelegationEmail(to: string, params: DomainDelegationEmailParams): Promise<EmailTemplate> {
  const template = buildDomainDelegationEmail(params);

  if (!process.env.RESEND_API_KEY) {
    console.log(`[email:not-configured] Para: ${to} | Asunto: ${template.subject}`);
    return template;
  }

  // TODO: integrar Resend (o el SMTP que se elija) acá.
  console.log(`[email] Envío pendiente de implementar. Para: ${to} | Asunto: ${template.subject}`);
  return template;
}

/**
 * Notificación de escaneo completado (a.md, "MVP: REGLAS DE NEGOCIO,
 * AUTENTICACIÓN Y MEJORAS DE UX/UI" — "enviar un correo únicamente
 * cuando: 1. el escaneo pase a Completado, 2. se detecte al menos un
 * hallazgo Crítico"). Un solo correo cubre ambas condiciones: se envía
 * siempre que un audit termina `completed` (nunca en `failed`, no hay
 * nada que reportar todavía) y el contenido cambia según haya o no
 * hallazgos críticos — evita mandar dos correos separados por el mismo
 * evento cuando ambas condiciones se cumplen a la vez.
 */
export interface ScanCompletedEmailParams {
  recipientName: string;
  auditTitle: string;
  findingsCount: number;
  criticalCount: number;
  auditUrl: string;
}

export function buildScanCompletedEmail(params: ScanCompletedEmailParams): EmailTemplate {
  const hasCritical = params.criticalCount > 0;
  const subject = hasCritical
    ? `⚠️ ${params.criticalCount} hallazgo(s) crítico(s) en "${params.auditTitle}"`
    : `Escaneo completado: "${params.auditTitle}"`;

  const criticalLineText = hasCritical
    ? `Se detectaron ${params.criticalCount} hallazgo(s) de severidad CRÍTICA — te recomendamos revisarlos cuanto antes.\n\n`
    : "";
  const criticalLineHtml = hasCritical
    ? `<p style="color:#b91c1c"><strong>⚠️ Se detectaron ${params.criticalCount} hallazgo(s) de severidad CRÍTICA</strong> — te recomendamos revisarlos cuanto antes.</p>`
    : "";

  const text =
    `Hola ${params.recipientName},\n\n` +
    `El escaneo técnico de la auditoría "${params.auditTitle}" terminó con ${params.findingsCount} hallazgo(s) detectado(s).\n\n` +
    criticalLineText +
    `Ver el reporte completo: ${params.auditUrl}\n\n` +
    `— El equipo de Aegis CyberAudit`;
  const html =
    `<p>Hola ${params.recipientName},</p>` +
    `<p>El escaneo técnico de la auditoría <strong>"${params.auditTitle}"</strong> terminó con <strong>${params.findingsCount}</strong> hallazgo(s) detectado(s).</p>` +
    criticalLineHtml +
    `<p><a href="${params.auditUrl}">Ver el reporte completo</a></p>` +
    `<p>— El equipo de Aegis CyberAudit</p>`;
  return { subject, html, text };
}

/**
 * Mismo patrón "preparado pero no conectado" que el resto de los emails
 * del sistema — ver `sendDomainDelegationEmail`.
 */
export async function sendScanCompletedEmail(to: string, params: ScanCompletedEmailParams): Promise<EmailTemplate> {
  const template = buildScanCompletedEmail(params);

  if (!process.env.RESEND_API_KEY) {
    console.log(`[email:not-configured] Para: ${to} | Asunto: ${template.subject}`);
    return template;
  }

  // TODO: integrar Resend (o el SMTP que se elija) acá.
  console.log(`[email] Envío pendiente de implementar. Para: ${to} | Asunto: ${template.subject}`);
  return template;
}
