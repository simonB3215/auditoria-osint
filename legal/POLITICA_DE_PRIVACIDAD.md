# Política de Privacidad
## Aegis CyberAudit

> **Borrador de trabajo — v0.1.** Redactado con asistencia de IA a
> partir de la ficha técnica y factual del producto vigente al **24 de
> agosto de 2026**. No constituye asesoría legal ni un instrumento
> válido para su publicación sin revisión previa. Ver el **Aviso de
> Responsabilidad** al final del documento.

---

## 1. RESPONSABLE DEL TRATAMIENTO

`[PLACEHOLDER: razón social completa, RUT y domicilio de la entidad que
opera Aegis CyberAudit]` (en adelante, **"Aegis"**) es el Responsable del
tratamiento de los datos personales descritos en esta Política, salvo
respecto de los datos que Aegis trata por cuenta de una organización
Cliente en su calidad de Encargado del tratamiento — en ese caso
aplica, además, el Acuerdo de Tratamiento de Datos (DPA) suscrito con
dicha organización.

`[PLACEHOLDER: dirección de contacto / correo electrónico para
consultas de privacidad y para el ejercicio de derechos ARCO+]`.

---

## 2. MARCO NORMATIVO APLICABLE

Esta Política se elabora para satisfacer concurrentemente:

* el **Reglamento General de Protección de Datos** de la Unión Europea
  (RGPD, UE 2016/679), cuando corresponda por la ubicación o
  nacionalidad de los Titulares; y
* la legislación chilena de protección de datos personales, Ley
  N° 19.628, según fue reformada por la **Ley N° 21.719**, cuya entrada
  en vigencia plena está fijada para el **1 de diciembre de 2026**.

Donde ambos marcos usan terminología distinta para el mismo concepto, se
utiliza la siguiente equivalencia:

| RGPD | Ley N° 21.719 (Chile) |
|---|---|
| Data Controller | Responsable del tratamiento |
| Data Processor | Encargado del tratamiento |
| Data Subject | Titular de los datos |
| Data Subject Rights (access, rectification, erasure, objection, portability) | Derechos ARCO+ |
| Supervisory Authority | Agencia de Protección de Datos Personales (APD) |

---

## 3. QUÉ ES AEGIS CYBERAUDIT (CONTEXTO)

Aegis CyberAudit es una plataforma SaaS B2B multi-tenant que permite a
una organización Cliente registrar activos de red (dominios e IPs
públicas), ejecutar auditorías técnicas de perímetro externo sobre esos
activos, y gestionar evidencia documental de cumplimiento normativo. Esta
Política aplica tanto a los **usuarios del Cliente** que acceden
directamente a la plataforma, como, en lo pertinente, a la propia
organización Cliente en cuanto persona jurídica contratante.

---

## 4. DATOS PERSONALES QUE TRATAMOS

### 4.1. Datos de cuenta y usuarios

* Correo electrónico.
* Credenciales de autenticación, gestionadas por nuestro proveedor de
  autenticación (Supabase Auth) — **Aegis no accede a contraseñas en
  texto claro**, solo a su forma hasheada/cifrada gestionada por dicho
  proveedor.
* Identificador de sesión, cuando el usuario opta por iniciar sesión con
  Google OAuth.
* Rol asignado dentro de la organización (`ciso`, `auditor`, `viewer`).

### 4.2. Datos de activos técnicos

* Dominios e IPs públicas que el Cliente registra para su auditoría.
  Estos datos identifican infraestructura técnica, no personas
  naturales, salvo en el caso descrito en el punto 4.3.

### 4.3. Evidencia documental cargada por el Cliente

* Archivos (PDF, Excel, JSON) que el Cliente sube a la plataforma como
  evidencia de cumplimiento normativo. **Aegis no inspecciona ni
  controla el contenido de estos archivos** de forma proactiva — si el
  Cliente incluye datos personales de terceros dentro de dicha
  evidencia, es responsabilidad exclusiva del Cliente contar con base de
  licitud suficiente para ello.

### 4.4. Datos técnicos y de uso de la plataforma

* Registros de auditoría (*audit logs*) de acciones relevantes
  realizadas en la plataforma (creación de activos, ejecución de
  escaneos, cambios de estado de hallazgos, generación de reportes,
  intentos de escaneo no autorizados, entre otros), asociados al usuario
  que las realizó.
* Metadatos técnicos de uso razonables para la operación del Servicio
  (por ejemplo, marcas de tiempo de sesión).

### 4.5. Datos que explícitamente NO recopilamos

* Contraseñas de servidores o sistemas internos del Cliente.
* El Rol Único Tributario (RUT) de personas naturales, en ningún
  formulario de la plataforma.
* Contenido de las bases de datos del Cliente — el análisis técnico solo
  determina, desde el exterior, si un puerto de base de datos está
  expuesto públicamente, sin conectarse ni leer los registros que
  contiene.

---

## 5. FINALIDADES DEL TRATAMIENTO

Tratamos los datos personales descritos exclusivamente para:

* crear y administrar la cuenta del usuario y de su organización;
* controlar el acceso a la plataforma según el rol asignado;
* ejecutar las auditorías técnicas y generar los reportes solicitados
  por el Cliente;
* almacenar y poner a disposición del Cliente la evidencia documental
  que este carga;
* enviar notificaciones operativas relacionadas con el uso del Servicio
  (por ejemplo, al completarse un escaneo, o en particular si arroja
  hallazgos críticos) — **esta funcionalidad de envío de correo
  electrónico transaccional está preparada y sujeta a activación
  operativa**, es decir, el envío real depende de la configuración de un
  proveedor de correo activo;
* mantener el registro de auditoría inmutable de la plataforma con fines
  de trazabilidad y seguridad;
* cumplir obligaciones legales aplicables a Aegis.

No utilizamos los datos personales tratados por cuenta del Cliente para
fines de publicidad propia, ni los vendemos ni cedemos a terceros fuera
de los Subencargados descritos en el punto 7.

---

## 6. BASE DE LICITUD DEL TRATAMIENTO

El tratamiento de los datos de los usuarios del Cliente se sustenta,
según corresponda, en:

* la **ejecución del contrato** de servicio entre el Cliente y Aegis
  (necesario para prestar el Servicio contratado);
* el **interés legítimo** de Aegis en mantener la seguridad e integridad
  técnica de la plataforma (por ejemplo, los registros de auditoría);
* el **cumplimiento de obligaciones legales** aplicables a Aegis.

---

## 7. A QUIÉN COMUNICAMOS LOS DATOS (SUBENCARGADOS)

Para prestar el Servicio, Aegis utiliza los siguientes proveedores de
infraestructura, que actúan como Encargados/Subencargados del
tratamiento bajo instrucciones de Aegis:

| Proveedor | Función | Región |
|---|---|---|
| **Supabase Inc.** | Base de datos, autenticación y almacenamiento cifrado de evidencia. | `[PLACEHOLDER: confirmar región]` |
| **Upstash Inc.** | Gestión de la cola de procesamiento de escaneos. | `[PLACEHOLDER: confirmar región]` |
| **Resend Inc.** | Envío de notificaciones por correo electrónico (preparado y sujeto a activación operativa). | `[PLACEHOLDER: confirmar región]` |
| **`[PLACEHOLDER: Proveedor de Hosting del Worker/API]`** | Ejecución del motor de escaneo técnico. | `[PLACEHOLDER: confirmar región]` |

El detalle completo de estos proveedores, y las obligaciones contractuales
que Aegis les impone, se encuentran en el Anexo I del Acuerdo de
Tratamiento de Datos (DPA).

No comunicamos datos personales a terceros distintos de los indicados,
salvo requerimiento de una autoridad competente conforme a la ley.

### 7.1. Transferencias internacionales

El tratamiento puede implicar el alojamiento de datos en servidores
ubicados fuera de Chile, según la región de cada proveedor listado.
`[PLACEHOLDER: una vez confirmadas las regiones, describir el mecanismo
de transferencia internacional aplicable — Cláusulas Contractuales Tipo
u otro mecanismo habilitado por la Ley N° 21.719].`

---

## 8. PLAZO DE CONSERVACIÓN

* Los datos de cuenta se conservan mientras la cuenta del usuario
  permanezca activa, y por el plazo adicional que exija la ley tras su
  eliminación.
* La evidencia documental se conserva según el **período de retención
  configurable** que cada organización Cliente define en la plataforma;
  transcurrido dicho plazo, se ejecuta una purga automática y programada,
  conservando únicamente el metadato mínimo necesario para trazabilidad
  legal (quién y cuándo).
* Los registros de auditoría (*audit logs*) son inmutables — no admiten
  modificación ni eliminación por ningún rol, y se conservan conforme a
  la política de retención vigente de la plataforma.
  `[PLACEHOLDER: confirmar plazo de retención específico de los audit logs, si difiere del de la evidencia documental]`.

---

## 9. MEDIDAS DE SEGURIDAD

Aegis aplica, entre otras, las siguientes medidas técnicas y
organizativas:

* aislamiento entre organizaciones garantizado a nivel de motor de base
  de datos (Row Level Security de PostgreSQL, filtrando por
  `organization_id`);
* cifrado de la evidencia documental con algoritmo AES-256-GCM antes de
  su almacenamiento;
* enlaces de descarga de reportes mediante URLs firmadas, con
  expiración de 1 hora;
* control de acceso basado en roles, con un privilegio de administración
  de plataforma que **no puede otorgarse desde la interfaz ni desde
  ningún endpoint del Servicio** — se concede únicamente mediante un
  procedimiento técnico local realizado por personal autorizado de
  Aegis;
* limitación de tasa (*rate limiting*) en endpoints críticos;
* verificación obligatoria de titularidad de cada activo antes de
  permitir su escaneo.

El detalle técnico completo de estas medidas se encuentra en el Anexo II
del Acuerdo de Tratamiento de Datos (DPA).

---

## 10. DERECHOS DE LOS TITULARES (ARCO+)

10.1. Todo Titular puede ejercer, respecto de sus propios datos
personales, los siguientes derechos:

* **Acceso**: conocer qué datos personales suyos tratamos.
* **Rectificación**: solicitar la corrección de datos inexactos.
* **Cancelación / Supresión**: solicitar la eliminación de sus datos,
  cuando no exista una obligación legal que exija su conservación.
* **Oposición**: oponerse a un tratamiento concreto, por motivos
  relacionados con su situación particular.
* **Portabilidad**: solicitar la entrega de sus datos en un formato
  estructurado y de uso común.

10.2. Para ejercer estos derechos, el Titular puede contactar a
`[PLACEHOLDER: canal de contacto para ejercicio de derechos ARCO+]`.

10.3. **Titulares cuyos datos son tratados por cuenta de un Cliente.**
Cuando el Titular es un usuario de la organización Cliente (por ejemplo,
personal interno del Cliente con cuenta en la plataforma), Aegis actúa
como Encargado del tratamiento y remitirá la solicitud al Cliente
correspondiente, en su calidad de Responsable, prestando la asistencia
técnica necesaria para que este pueda responderla dentro de los plazos
legales.

10.4. El Titular tiene derecho a presentar un reclamo ante la Agencia de
Protección de Datos Personales (APD) en Chile, o ante la autoridad de
control equivalente que corresponda según su ubicación, si considera que
el tratamiento de sus datos no cumple con la normativa aplicable.

---

## 11. NOTIFICACIÓN DE VULNERACIONES DE SEGURIDAD

En caso de una vulneración de seguridad que afecte datos personales,
Aegis notificará a los Titulares afectados y/o a la autoridad competente
conforme a los plazos legales aplicables (estándar de 72 horas desde que
se tiene conocimiento de la vulneración), cuando dicha notificación sea
exigible conforme al RGPD o a la Ley N° 21.719.

---

## 12. MENORES DE EDAD

El Servicio está dirigido a organizaciones y a los usuarios profesionales
que estas designan; no está dirigido a menores de edad, y Aegis no
recopila deliberadamente datos personales de menores.

---

## 13. CAMBIOS A ESTA POLÍTICA

Aegis podrá actualizar esta Política para reflejar cambios normativos o
del Servicio. `[PLACEHOLDER: definir mecanismo de notificación de
cambios materiales a los usuarios, ej. aviso en la plataforma o correo
electrónico, y plazo de antelación]`.

---

## AVISO DE RESPONSABILIDAD

Este documento es un **borrador de trabajo** generado con asistencia de
inteligencia artificial. **No constituye asesoría legal**, no ha sido
revisado ni validado por un abogado habilitado, y **no debe utilizarse
ni publicarse sin la revisión y validación previa de un profesional del
derecho** especializado en protección de datos personales, tanto en la
jurisdicción chilena como, si corresponde, en la Unión Europea. Los
campos marcados como `[PLACEHOLDER: ...]` identifican información
societaria, técnica o de contacto no confirmada al momento de redactar
este borrador.
