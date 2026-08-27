# Acuerdo de Tratamiento de Datos (Data Processing Agreement)
## Aegis CyberAudit

> **Borrador de trabajo — v0.1.** Este documento fue redactado con
> asistencia de IA a partir de la ficha técnica y factual del producto
> vigente al **24 de agosto de 2026**. No constituye asesoría legal ni un
> instrumento válido para su firma sin revisión previa. Ver el **Aviso de
> Responsabilidad** al final del documento.

---

## PREÁMBULO

El presente Acuerdo de Tratamiento de Datos (en adelante, el **"Acuerdo"**
o el **"DPA"**) se celebra entre:

**(A)** `[PLACEHOLDER: razón social completa, RUT y domicilio de la
entidad que opera Aegis CyberAudit]` (en adelante, **"Aegis"** o el
**"Encargado del Tratamiento"**), y

**(B)** la organización cliente identificada en el respectivo contrato de
servicio o formulario de registro de la plataforma (en adelante, el
**"Cliente"** o el **"Responsable del Tratamiento"**),

en conjunto referidos como las **"Partes"**.

Este Acuerdo complementa y forma parte integrante del contrato de
servicio, términos de servicio o acuerdo marco entre las Partes que rige
el uso de la plataforma Aegis CyberAudit (en adelante, el **"Contrato
Principal"**), y regula específicamente el tratamiento de datos
personales que Aegis realiza por cuenta del Cliente en la prestación del
Servicio.

---

## 1. DEFINICIONES

Para efectos de este Acuerdo, y con el objeto de satisfacer
concurrentemente el Reglamento General de Protección de Datos de la
Unión Europea (UE 2016/679, **"RGPD"**) y la legislación chilena de
protección de datos personales (Ley N° 19.628, según fue reformada por
la Ley N° 21.719, cuya entrada en vigencia plena está fijada para el
**1 de diciembre de 2026**), los siguientes términos se entienden
equivalentes:

| Terminología RGPD | Terminología Ley N° 21.719 (Chile) | Rol en este Acuerdo |
|---|---|---|
| *Data Controller* | Responsable del tratamiento | El Cliente |
| *Data Processor* | Encargado del tratamiento | Aegis |
| *Data Subject* | Titular de los datos | Usuarios del Cliente cuyos datos se tratan en la plataforma |
| *Sub-processor* | Subencargado del tratamiento | Proveedores de infraestructura de Aegis (ver Anexo I) |
| *Personal Data Breach* | Vulneración de seguridad de los datos personales | Ver Cláusula 8 |
| *Supervisory Authority* | Agencia de Protección de Datos Personales (APD) | Autoridad competente en Chile bajo la Ley N° 21.719 |
| *Data Subject Rights* (access, rectification, erasure, objection, portability) | Derechos ARCO+ (acceso, rectificación, cancelación, oposición, y portabilidad) | Ver Cláusula 7 |

**"Servicio"**: la plataforma Aegis CyberAudit, un SaaS B2B multi-tenant
de auditoría técnica externa no invasiva de activos de red registrados
por el Cliente (dominios e IPs públicas) y de gestión de evidencia
documental de cumplimiento normativo (Ley N° 21.663 — ANCI, ISO 27001,
NIST CSF, GDPR y normativa local de protección de datos aplicable).

**"Datos Personales"**: toda información relativa a una persona natural
identificada o identificable que Aegis trate por cuenta del Cliente en
el marco de la prestación del Servicio, según se detalla en el Anexo III.

---

## 2. OBJETO Y ALCANCE

2.1. Mediante este Acuerdo, el Cliente instruye a Aegis, y Aegis se
obliga, a tratar los Datos Personales exclusivamente para los fines de
prestar el Servicio conforme al Contrato Principal, y de acuerdo con las
instrucciones documentadas del Cliente, salvo que una norma legal
imperativa exija a Aegis otro tratamiento, caso en el cual Aegis
informará al Cliente de dicho requerimiento legal antes de proceder,
salvo que la ley prohíba dicha comunicación por razones de interés
público.

2.2. Aegis actúa exclusivamente como **Encargado del Tratamiento**
respecto de los Datos Personales que el Cliente carga, registra o genera
al usar el Servicio. Aegis **no determina** los fines ni los medios
esenciales del tratamiento de esos datos — el Cliente decide qué activos
de red registrar, qué escaneos ejecutar y qué evidencia documental
cargar a la plataforma.

2.3. Este Acuerdo no altera ni sustituye las obligaciones que cada Parte
tenga como responsable de sus propios tratamientos independientes (por
ejemplo, los datos de la cuenta y facturación del propio Cliente como
persona jurídica contratante, que se rigen por la Política de Privacidad
de Aegis, documento distinto de este DPA).

---

## 3. NATURALEZA Y FINALIDAD DEL TRATAMIENTO

3.1. **Naturaleza del tratamiento**: almacenamiento, organización,
consulta y eliminación de datos ingresados por el Cliente en la
plataforma, en servidores de los Subencargados listados en el Anexo I.

3.2. **Finalidad**: exclusivamente la prestación del Servicio, esto es:

* gestión de cuentas de usuario y control de acceso basado en roles
  (`ciso`, `auditor`, `viewer`) dentro de la organización del Cliente;
* registro y verificación de propiedad de activos de red (dominios e
  IPs públicas) antes de cualquier escaneo (ver Cláusula 5);
* ejecución de auditorías técnicas de perímetro externo (Nmap, TLS,
  cabeceras HTTP) sobre los activos verificados del Cliente;
* almacenamiento y validación de evidencia documental de cumplimiento
  cargada por el Cliente;
* generación de reportes ejecutivos en PDF con puntaje de riesgo y
  matriz de cumplimiento normativo;
* registro de trazabilidad inmutable (*audit logs*) de las acciones
  relevantes realizadas en la plataforma.

3.3. **Aegis no realiza, bajo ninguna circunstancia**:

* explotación ofensiva de vulnerabilidades (el análisis es
  exclusivamente perimetral externo, a nivel de Capas 3 y 4 del modelo
  OSI, mediante Nmap, verificación de certificados TLS y cabeceras HTTP);
* acceso al código fuente de los sistemas del Cliente;
* lectura, consulta o acceso al contenido de las bases de datos del
  Cliente — el escaneo perimetral solo determina, desde el exterior, si
  un puerto de base de datos está expuesto públicamente o carece de
  cifrado en tránsito, sin conectarse ni autenticarse contra dicha base
  de datos;
* solicitud o almacenamiento de contraseñas o credenciales de acceso a
  los sistemas internos del Cliente.

---

## 4. TIPOS DE DATOS PERSONALES Y CATEGORÍAS DE TITULARES

Ver el detalle completo en el **Anexo III**. En resumen:

* **Usuarios del Cliente** (personal del Cliente con cuenta en la
  plataforma): correo electrónico; credenciales de autenticación
  gestionadas por Supabase Auth (hasheadas/cifradas — Aegis no tiene
  acceso a contraseñas en texto claro); identificador de sesión de
  Google OAuth cuando corresponda; rol asignado dentro de la
  organización.
* **Datos de activos técnicos**: dominios e IPs públicas registrados por
  el Cliente. Por su naturaleza, estos datos identifican infraestructura
  técnica y no, en sí mismos, a personas naturales — salvo que el propio
  Cliente incluya datos personales en la evidencia documental que carga
  (ver punto siguiente).
* **Evidencia documental**: archivos subidos por el Cliente (PDF, Excel,
  JSON) para acreditar cumplimiento normativo. **Aegis no inspecciona ni
  controla el contenido de estos archivos** — si el Cliente incluye
  datos personales de terceros dentro de esa evidencia, es de exclusiva
  responsabilidad del Cliente contar con base de licitud para ello.

**Datos explícitamente excluidos del tratamiento**: Aegis no solicita el
RUT de personas naturales en ningún formulario de la plataforma, no
recopila contraseñas de servidores internos del Cliente, y no lee
información contenida dentro de bases de datos del Cliente.

---

## 5. VERIFICACIÓN PREVIA DE TITULARIDAD DE ACTIVOS

5.1. Como medida de licitud y de prevención de escaneos no autorizados a
infraestructura de terceros, ningún activo de red puede ser escaneado
sin verificación previa de propiedad:

* **Dominios**: mediante un token único publicado como registro **DNS
  TXT**, con reintentos automáticos programados en segundo plano (hasta
  5 intentos distribuidos en un plazo de 24 horas) y opción de
  verificación manual inmediata por el Cliente.
* **IPs públicas**: mediante **autoatestación** — una declaración
  realizada por un usuario con rol `ciso` de la organización del
  Cliente. Se deja constancia expresa de que este mecanismo tiene **un
  rigor técnico menor** que la verificación por DNS TXT, al no exigir
  prueba criptográfica ni control sobre infraestructura de red — no debe
  equipararse a la verificación de dominios para efectos de valorar la
  robustez de esta medida.

5.2. Un activo no verificado **no puede** ser objeto de escaneo bajo
ninguna circunstancia: la plataforma bloquea explícitamente la solicitud
(código de error 403) y registra el intento en los *audit logs*
inmutables de la organización.

5.3. El Cliente reconoce y declara, mediante la cláusula correspondiente
de los Términos de Servicio (documento separado de este DPA, conforme al
requisito de la Ley N° 21.459 sobre Delitos Informáticos), que es
titular o cuenta con autorización legítima expresa sobre cada dominio e
IP que registra y somete a escaneo en la plataforma. Esta declaración es
una condición de uso del Servicio y no exime a Aegis de las medidas
técnicas descritas en esta cláusula.

---

## 6. OBLIGACIONES DE AEGIS COMO ENCARGADO DEL TRATAMIENTO

Aegis se obliga a:

**a) Tratar los datos solo por instrucción documentada.** Aegis trata
los Datos Personales únicamente conforme a las instrucciones
documentadas del Cliente (expresadas a través del uso normal de la
plataforma) y para los fines descritos en la Cláusula 3, salvo
obligación legal en contrario (ver Cláusula 2.1).

**b) Confidencialidad.** Garantizar que las personas autorizadas para
tratar los Datos Personales se hayan comprometido a respetar la
confidencialidad o estén sujetas a una obligación legal de
confidencialidad. El acceso administrativo interno a datos de clientes
está restringido: el panel de administración de la plataforma
(`/admin`) requiere un privilegio ortogonal a los roles de organización
(`is_platform_admin`) que **se otorga únicamente de forma manual y local
mediante un script ejecutado con la clave `service_role`** —
explícitamente, no existe ningún botón, endpoint ni flujo de
autoservicio dentro de la plataforma que permita auto-otorgarse o
delegar ese privilegio.

**c) Medidas técnicas y organizativas (TOMs).** Implementar y mantener
las medidas descritas en el **Anexo II**, incluyendo — sin limitarse a
ellas — aislamiento multi-tenant a nivel de motor de base de datos,
cifrado de evidencia documental, control de acceso basado en roles, y
registro de auditoría inmutable.

**d) Subencargados.** No subcontratar el tratamiento de Datos Personales
a un tercero sin autorización previa, general o específica, del Cliente.
El Cliente otorga, mediante este Acuerdo, **autorización general** para
la utilización de los Subencargados listados en el **Anexo I**, sujeto a
que Aegis les imponga por contrato obligaciones de protección de datos
equivalentes a las de este Acuerdo. Aegis informará al Cliente de
cualquier cambio previsto en la incorporación o sustitución de
Subencargados, dando al Cliente la oportunidad de oponerse por motivos
razonables relacionados con la protección de datos.
`[PLACEHOLDER: definir plazo de preaviso concreto para cambios de subencargados, ej. 30 días, y canal de notificación]`.

**e) Asistencia en el ejercicio de derechos ARCO+.** Considerando la
naturaleza del tratamiento, asistir al Cliente mediante medidas técnicas
y organizativas apropiadas para que este pueda cumplir con su obligación
de responder a solicitudes de ejercicio de los derechos de acceso,
rectificación, cancelación, oposición y portabilidad (ARCO+) de los
Titulares.

**f) Notificación de vulneraciones de seguridad.** Notificar al Cliente,
sin dilación indebida y en todo caso dentro de un plazo que permita al
Cliente cumplir con su propio deber de notificar a la Agencia de
Protección de Datos Personales (APD) dentro de las **72 horas**
siguientes a que tenga constancia de la vulneración (estándar
equivalente al del artículo 33 RGPD), tan pronto Aegis tenga conocimiento
de una vulneración de seguridad que afecte Datos Personales tratados en
la plataforma. La notificación incluirá, en la medida en que la
información esté disponible: naturaleza de la vulneración, categorías y
volumen aproximado de datos y Titulares afectados, medidas ya adoptadas
o propuestas, y datos de contacto para más información.
`[PLACEHOLDER: definir canal/dirección de contacto formal para notificaciones de incidentes]`.

**g) Asistencia en evaluaciones de impacto.** Proporcionar al Cliente,
si corresponde y dentro de lo razonable, la información necesaria para
que este pueda realizar evaluaciones de impacto relativas a la
protección de datos, en la medida en que el tratamiento realizado por
Aegis sea relevante para dicha evaluación.

**h) Eliminación o devolución de datos.** A elección del Cliente,
eliminar o devolver todos los Datos Personales al finalizar la
prestación del Servicio, y eliminar las copias existentes, salvo que una
norma legal exija su conservación por Aegis — en cuyo caso dicha
conservación se limita al mínimo necesario y a los plazos legales
aplicables. La purga de evidencia documental vencida según la política
de retención configurada por el Cliente ya opera de forma autónoma y
programada durante la vigencia del Servicio (ver Anexo II).

**i) Disponibilidad para auditorías.** Poner a disposición del Cliente
la información necesaria para demostrar el cumplimiento de las
obligaciones de este Acuerdo, y permitir y contribuir a auditorías,
incluidas inspecciones, realizadas por el Cliente o por un auditor
autorizado por este.
`[PLACEHOLDER: definir modalidad concreta — informe de cumplimiento vs. auditoría in situ —, preaviso mínimo y frecuencia máxima anual]`.

---

## 7. OBLIGACIONES DEL CLIENTE COMO RESPONSABLE DEL TRATAMIENTO

El Cliente declara y se obliga a:

7.1. Contar con base de licitud suficiente para el tratamiento de los
Datos Personales de sus propios usuarios y, en su caso, de terceros cuyos
datos pudiera incluir en la evidencia documental que carga a la
plataforma (ver Cláusula 4).

7.2. Impartir a Aegis únicamente instrucciones lícitas, y responder ante
los Titulares y ante la autoridad competente por la licitud del
tratamiento que origina las instrucciones dadas a Aegis.

7.3. Ser el único responsable de certificar, conforme a la cláusula
correspondiente de los Términos de Servicio, la titularidad o
autorización legítima sobre cada activo de red (dominio o IP) que
registra y somete a escaneo (ver Cláusula 5.3) — obligación cuyo
incumplimiento puede constituir un ilícito bajo la Ley N° 21.459 y
exceder el alcance de responsabilidad de Aegis como Encargado.

7.4. Gestionar adecuadamente las credenciales de acceso de sus propios
usuarios y los roles asignados dentro de su organización.

---

## 8. TRANSFERENCIAS INTERNACIONALES DE DATOS

8.1. El tratamiento de los Datos Personales puede implicar su alojamiento
o procesamiento en servidores ubicados fuera de Chile, según la región de
infraestructura de cada Subencargado listado en el Anexo I.

8.2. `[PLACEHOLDER: una vez confirmadas las regiones de cada
Subencargado (Anexo I), completar aquí el mecanismo de transferencia
internacional aplicable — p. ej. Cláusulas Contractuales Tipo de la
Comisión Europea si aplica RGPD, y/o el mecanismo habilitado bajo la Ley
N° 21.719 para transferencias internacionales de datos personales desde
Chile — citando la decisión de adecuación o el instrumento contractual
específico utilizado con cada Subencargado].`

---

## 9. RESPONSABILIDAD

9.1. Cada Parte responde por los daños y perjuicios causados por su
propio incumplimiento de las obligaciones establecidas en el RGPD, en la
Ley N° 19.628 (según reformada por la Ley N° 21.719) y en este Acuerdo.

9.2. `[PLACEHOLDER: definir régimen de limitación de responsabilidad
(topes indemnizatorios, exclusión de daños indirectos/lucro cesante,
etc.) — normalmente remitido al Contrato Principal / Términos de
Servicio, verificar consistencia entre ambos documentos].`

---

## 10. VIGENCIA Y TERMINACIÓN

10.1. Este Acuerdo entra en vigor en la fecha de aceptación del Contrato
Principal por el Cliente y permanece vigente mientras Aegis trate Datos
Personales por cuenta del Cliente en el marco del Servicio.

10.2. La terminación del Contrato Principal, por cualquier causa,
implica la terminación automática de este Acuerdo, sin perjuicio de la
obligación de eliminación o devolución de datos prevista en la Cláusula
6.h) y de aquellas disposiciones que por su naturaleza deban sobrevivir
a la terminación (confidencialidad, responsabilidad).

---

## 11. LEY APLICABLE Y JURISDICCIÓN

`[PLACEHOLDER: definir ley aplicable y tribunales/jurisdicción
competente — presumiblemente Chile, a confirmar con el domicilio legal
de la entidad que opera Aegis, punto (A) del Preámbulo].`

---

## ANEXO I — SUBENCARGADOS DEL TRATAMIENTO (SUB-PROCESSORS)

| Subencargado | Función | Región / Ubicación de los datos | Naturaleza del tratamiento |
|---|---|---|---|
| **Supabase Inc.** | Base de datos PostgreSQL (con Row Level Security), autenticación de usuarios y almacenamiento cifrado de evidencia documental. | `[PLACEHOLDER: confirmar región del proyecto Supabase]` | Almacenamiento y procesamiento de Datos Personales. |
| **Upstash Inc.** | Gestión de la cola de procesamiento asíncrono de escaneos y verificaciones (Redis / BullMQ) — datos operativos de la ejecución de jobs, no contenido de evidencia. | `[PLACEHOLDER: confirmar región]` | Procesamiento operativo, exposición limitada a Datos Personales. |
| **Resend Inc.** | Envío de notificaciones transaccionales por correo electrónico. **Estado operativo actual: preparado y sujeto a activación operativa** — la integración de código existe, pero el envío real no está activo hasta que se configure la credencial del proveedor. | `[PLACEHOLDER: confirmar región]` | Direcciones de correo electrónico de los destinatarios de la notificación. |
| **`[PLACEHOLDER: Proveedor de Hosting del Worker/API]`** | Ejecución del motor de escaneo (Nmap) y de la API del Servicio en un entorno aislado. | `[PLACEHOLDER: confirmar proveedor y región]` | Procesamiento operativo. |

**Nota de clasificación — `scanme.nmap.org` no es un Subencargado bajo
este Acuerdo.** Este host es un activo de prueba público, mantenido y
publicado por el propio proyecto Nmap como objetivo explícitamente
autorizado para fines de prueba
(https://nmap.org/book/testing.html). Se utiliza **exclusivamente**
dentro del módulo de simulación/sandbox de la plataforma, con el fin de
que un Cliente pueda probar el flujo de escaneo sin necesidad de
disponer todavía de un dominio propio verificado. **No se le transfiere
ningún Dato Personal del Cliente** ni de sus Titulares — no procesa
datos por cuenta de Aegis ni del Cliente, y por tanto queda fuera del
alcance de la definición de Subencargado de este Acuerdo. Se incluye esta
nota únicamente para transparencia técnica, corrigiendo su inclusión
como "subencargado de infraestructura" en la ficha factual base de este
documento.

---

## ANEXO II — MEDIDAS TÉCNICAS Y ORGANIZATIVAS (TOMs)

1. **Aislamiento multi-tenant a nivel de motor de base de datos**:
   Row Level Security (RLS) de PostgreSQL, filtrando el acceso a los
   datos de cada organización por `organization_id` — el aislamiento
   entre Clientes está garantizado por el propio motor de base de datos,
   no únicamente por lógica de la capa de aplicación.
2. **Cifrado de evidencia documental**: algoritmo AES-256-GCM, aplicado
   antes de subir los archivos a buckets de almacenamiento privados.
3. **Enlaces de descarga con expiración**: los reportes ejecutivos en
   PDF se sirven mediante URLs firmadas con una expiración de **1 hora**.
4. **Registro de auditoría inmutable**: los *audit logs* de la
   plataforma no admiten operaciones de modificación (`UPDATE`) ni
   eliminación (`DELETE`) bajo ningún rol — quedan como un registro
   histórico verificable de las acciones relevantes (carga de evidencia,
   cambios de estado de hallazgos, generación de reportes, cambios de
   rol u organización, intentos de escaneo no autorizados, entre otros).
5. **Verificación de integridad de reportes**: cada reporte ejecutivo
   incluye un hash SHA-256 calculado sobre su contenido. **Esta medida
   constituye exclusivamente una verificación de integridad del
   documento** (permite comprobar que no fue alterado después de
   emitido) **y en ningún caso debe interpretarse ni representarse como
   una Firma Electrónica Avanzada (FEA)** en los términos de la
   legislación chilena sobre firma electrónica (Ley N° 19.799), al no
   requerir un certificado calificado emitido por un prestador acreditado.
6. **Verificación previa de titularidad de activos**: ver Cláusula 5 —
   ningún activo puede escanearse sin verificación de propiedad (DNS TXT
   para dominios, autoatestación de rol `ciso` para IPs).
7. **Control de acceso basado en roles (RBAC)**: roles de organización
   (`ciso`, `auditor`, `viewer`) con permisos diferenciados; el acceso
   administrativo de plataforma
   (`is_platform_admin`) es un privilegio ortogonal otorgado únicamente
   de forma local y manual (ver Cláusula 6.b).
8. **Limitación de tasa (*rate limiting*)**: aplicada de forma general y,
   con mayor severidad, en endpoints críticos — carga de evidencia,
   lanzamiento de escaneos, reseteo de contraseñas.
9. **Purga de retención configurable**: eliminación autónoma y
   programada de evidencia documental vencida, según el período de
   retención que configure cada Cliente, conservando únicamente el
   metadato necesario (quién, cuándo) para fines de trazabilidad legal.
10. **Alcance estrictamente perimetral del motor de escaneo**: el
    análisis técnico se limita a Capas 3 y 4 del modelo OSI mediante
    Nmap, verificación de certificados TLS y cabeceras de seguridad
    HTTP — sin explotación ofensiva de vulnerabilidades, sin acceso a
    código fuente del Cliente y sin conexión ni lectura de contenido de
    bases de datos del Cliente.

---

## ANEXO III — DESCRIPCIÓN DETALLADA DEL TRATAMIENTO

| Elemento | Descripción |
|---|---|
| **Objeto** | Prestación del Servicio Aegis CyberAudit al Cliente. |
| **Duración** | Mientras se mantenga vigente el Contrato Principal, más el plazo de conservación post-terminación que resulte aplicable (ver Cláusula 6.h). |
| **Naturaleza del tratamiento** | Almacenamiento, organización, consulta, análisis técnico automatizado (escaneo perimetral) y eliminación programada. |
| **Finalidad** | Ver Cláusula 3.2. |
| **Categorías de Titulares** | Usuarios del Cliente con cuenta en la plataforma (personal interno del Cliente, según los roles que este les asigne). Eventualmente, terceros cuyos datos el Cliente incluya en la evidencia documental que carga (fuera del control de Aegis, ver Cláusula 4). |
| **Categorías de Datos Personales** | Correo electrónico; credenciales de autenticación (hasheadas/cifradas por el proveedor de autenticación); identificador de sesión OAuth; rol de organización asignado. Ver Cláusula 4 para el detalle completo, incluyendo datos explícitamente excluidos. |
| **Datos Personales especialmente protegidos** | No se tratan de forma deliberada. `[PLACEHOLDER: confirmar y declarar expresamente si la evidencia documental cargada por Clientes podría, en la práctica, contener categorías especiales de datos — de ser así, evaluar si corresponde una cláusula adicional]`. |

---

## AVISO DE RESPONSABILIDAD

Este documento es un **borrador de trabajo** generado con asistencia de
inteligencia artificial a partir de una ficha técnica y factual
proporcionada sobre el producto Aegis CyberAudit. **No constituye
asesoría legal**, no ha sido revisado ni validado por un abogado
habilitado, y **no debe utilizarse, firmarse ni hacerse valer frente a
un Cliente, autoridad o tercero sin la revisión y validación previa de
un profesional del derecho** especializado en protección de datos
personales y contratos de software SaaS, tanto en la jurisdicción
chilena como, si corresponde, en la Unión Europea. Los campos marcados
como `[PLACEHOLDER: ...]` identifican información societaria, técnica o
de negocio que no estaba confirmada al momento de redactar este borrador
y que debe completarse antes de cualquier uso formal del documento.
