# Términos de Servicio
## Aegis CyberAudit

> **Borrador de trabajo — v0.1.** Redactado con asistencia de IA a partir
> de la ficha técnica y factual del producto vigente al **24 de agosto
> de 2026**. No constituye asesoría legal ni un instrumento válido para
> su publicación o aceptación por Clientes sin revisión previa. Ver el
> **Aviso de Responsabilidad** al final del documento.

---

## 1. ACEPTACIÓN Y PARTES

1.1. Los presentes Términos de Servicio (en adelante, los **"Términos"**)
regulan el acceso y uso de la plataforma **Aegis CyberAudit** (en
adelante, el **"Servicio"**), operada por
`[PLACEHOLDER: razón social completa, RUT y domicilio de la entidad que
opera Aegis CyberAudit]` (en adelante, **"Aegis"**).

1.2. Al registrarse, acceder o utilizar el Servicio, la organización
contratante (en adelante, el **"Cliente"**) y la persona natural que
actúa en su representación aceptan íntegra e incondicionalmente estos
Términos. Si la persona natural que se registra no cuenta con facultades
suficientes para obligar a la organización que representa, dicha persona
asume responsabilidad personal por el uso del Servicio.

1.3. El tratamiento de datos personales en el marco del Servicio se rige
adicionalmente por el **Acuerdo de Tratamiento de Datos (DPA)** y por la
**Política de Privacidad**, ambos documentos complementarios a estos
Términos y disponibles en la plataforma.

---

## 2. DESCRIPCIÓN DEL SERVICIO

2.1. Aegis CyberAudit es una plataforma SaaS B2B multi-tenant de
auditoría técnica externa **no invasiva** de activos de red registrados
por el Cliente (dominios e IPs públicas) y de gestión de evidencia
documental de cumplimiento frente a marcos normativos (Ley N° 21.663 —
ANCI, ISO 27001, NIST CSF, GDPR y normativa local de protección de datos
aplicable).

2.2. El Servicio se compone, entre otras funciones, de:

* registro y verificación de titularidad de activos de red;
* ejecución de auditorías técnicas de perímetro externo sobre los
  activos verificados del Cliente (Módulo de escaneo técnico);
* carga y gestión de evidencia documental de cumplimiento (Módulo de
  evidencia);
* generación de reportes ejecutivos en formato PDF con puntaje de riesgo
  y matriz de cumplimiento normativo;
* un módulo de simulación ("sandbox") que ejecuta un escaneo real contra
  un objetivo de prueba público, para que el Cliente pueda evaluar el
  funcionamiento del Servicio sin necesidad de tener aún un activo
  propio verificado.

2.3. **Alcance técnico del análisis — declaración vinculante.** El
análisis técnico que presta el Servicio es **exclusivamente perimetral
externo**, limitado a las Capas 3 y 4 del modelo OSI, mediante
verificación de puertos abiertos (Nmap), validación de certificados TLS
y análisis de cabeceras de seguridad HTTP. El Servicio, bajo ninguna
circunstancia:

* accede al código fuente de los sistemas del Cliente;
* ejecuta explotación ofensiva de vulnerabilidades detectadas (no es un
  servicio de *penetration testing* activo ni de explotación);
* se conecta, autentica o lee el contenido de bases de datos del
  Cliente — la detección de un puerto de base de datos expuesto se
  limita a la observación externa de su estado de exposición, sin
  interactuar con los datos que contiene;
* solicita, recibe o almacena contraseñas o credenciales de acceso a los
  sistemas internos del Cliente.

2.4. Aegis podrá modificar, mejorar o discontinuar funcionalidades del
Servicio, notificando al Cliente con una antelación razonable cuando el
cambio sea material.
`[PLACEHOLDER: definir plazo concreto de preaviso para cambios materiales del Servicio]`.

---

## 3. CLÁUSULA DE AUTORIZACIÓN Y DELITOS INFORMÁTICOS (Ley N° 21.459)

3.1. **Declaración obligatoria del Cliente.** Al registrar cualquier
activo de red (dominio o dirección IP pública) en la plataforma y, en
todo caso, antes de solicitar la ejecución de cualquier escaneo técnico,
el Cliente **declara y garantiza** que:

* es el titular legítimo del activo registrado, o
* cuenta con la autorización expresa, vigente y suficiente del titular
  legítimo de dicho activo para someterlo a las pruebas técnicas de
  perímetro que presta el Servicio.

3.2. Esta declaración es una condición esencial y previa para el uso del
módulo de escaneo técnico. El Cliente reconoce que efectuar u ordenar el
escaneo de sistemas informáticos ajenos sin autorización puede
constituir un delito bajo la **Ley N° 21.459 sobre Delitos
Informáticos** de Chile (y bajo normativa equivalente en otras
jurisdicciones), y que la responsabilidad penal, civil y administrativa
derivada de una declaración falsa o de un escaneo no autorizado
**recae exclusivamente sobre el Cliente**.

3.3. **Medidas técnicas de refuerzo.** Sin perjuicio de la declaración
del Cliente, el Servicio exige adicionalmente una verificación técnica
previa de titularidad antes de habilitar cualquier escaneo sobre un
activo:

* **Dominios**: mediante un token único publicado como registro **DNS
  TXT**, con reintentos automáticos en segundo plano (hasta 5 intentos
  distribuidos en 24 horas) y verificación manual inmediata disponible
  para el Cliente.
* **IPs públicas**: mediante **autoatestación** de un usuario con rol
  `ciso` de la organización del Cliente — un mecanismo de **menor rigor
  técnico** que la verificación DNS, al no exigir prueba criptográfica
  de control sobre la infraestructura, lo que el Cliente reconoce y
  acepta expresamente.

3.4. Ningún activo no verificado puede ser objeto de escaneo bajo
ninguna circunstancia: la plataforma bloquea explícitamente la solicitud
y registra el intento en un registro de auditoría inmutable.

3.5. Aegis se reserva el derecho de suspender inmediatamente el acceso
del Cliente al Servicio, sin perjuicio de otras acciones legales
disponibles, ante indicios razonables de que un activo registrado no
pertenece al Cliente o no cuenta con autorización legítima.

---

## 4. REGISTRO DE CUENTA Y ROLES

4.1. El acceso al Servicio requiere la creación de una cuenta asociada a
una organización. Dentro de cada organización, el Cliente puede asignar
a sus usuarios los siguientes roles, cada uno con permisos
diferenciados: `ciso` (control total sobre la organización), `auditor`
y `viewer` (acceso de solo lectura).

4.2. El Cliente es responsable de la exactitud de la información
proporcionada al registrarse, de la gestión de los roles que asigna a
sus propios usuarios, y de la confidencialidad de las credenciales de
acceso de estos.

4.3. Ningún mecanismo del Servicio permite a un usuario auto-otorgarse
un rol de mayor privilegio, ni el privilegio de administración de
plataforma (`is_platform_admin`) — este último es exclusivo del personal
interno de Aegis y se otorga únicamente mediante un procedimiento
técnico local, fuera de la interfaz del Servicio.

4.4. **Límite de activos.** El plan contratado por el Cliente puede
sujetar el número de activos de red registrables a un límite máximo
(actualmente, cinco activos por organización en el nivel de servicio
vigente al momento de redactar este documento).
`[PLACEHOLDER: confirmar si el límite varía por plan comercial y, de ser así, detallar cada nivel]`.

---

## 5. OBLIGACIONES DEL CLIENTE

El Cliente se obliga a:

* utilizar el Servicio exclusivamente sobre activos de red de su
  titularidad o respecto de los cuales cuente con autorización legítima
  (ver Cláusula 3);
* no utilizar el Servicio para fines distintos de la evaluación de
  ciberseguridad y cumplimiento normativo de sus propios activos;
* no intentar vulnerar, sobrecargar o realizar ingeniería inversa sobre
  la infraestructura del Servicio;
* mantener la confidencialidad de las credenciales de sus usuarios y
  notificar a Aegis sin dilación ante cualquier sospecha de acceso no
  autorizado a su cuenta;
* garantizar que cualquier dato personal de terceros incluido en la
  evidencia documental que carga a la plataforma cuenta con base de
  licitud suficiente (ver Política de Privacidad y DPA);
* cumplir con el pago de la contraprestación acordada conforme a la
  Cláusula 7.

---

## 6. PROPIEDAD INTELECTUAL

6.1. El Servicio, su software, diseño, marca y documentación son de
propiedad exclusiva de Aegis o de sus licenciantes. Estos Términos no
transfieren al Cliente derecho de propiedad intelectual alguno sobre el
Servicio, sino únicamente una licencia de uso limitada, no exclusiva e
intransferible, durante la vigencia del contrato.

6.2. El Cliente conserva la propiedad de los datos, activos registrados
y evidencia documental que carga al Servicio.

---

## 7. CONTRAPRESTACIÓN Y FACTURACIÓN

7.1. **Estado actual de facturación — declaración honesta.** El Servicio,
en su versión vigente al momento de redactar este documento, **no cuenta
con una pasarela de pago automatizada integrada**. La contratación,
facturación y cobro se gestionan de forma manual, fuera de la
plataforma, conforme a lo acordado comercialmente entre las Partes. El
"plan" asociado a una organización (por ejemplo, Starter, Pro o Custom)
es actualmente una etiqueta administrativa configurada manualmente por
Aegis, y no activa ni restringe funcionalidades de forma automática
según el plan.
`[PLACEHOLDER: confirmar si esta declaración debe actualizarse cuando se integre un procesador de pagos automatizado, y en tal caso redactar cláusula de cobro recurrente, medios de pago aceptados y política de mora]`.

7.2. `[PLACEHOLDER: definir estructura de precios, periodicidad de facturación y condiciones de pago vigentes, o remitir íntegramente a una Orden de Compra / Cotización comercial separada]`.

---

## 8. DISPONIBILIDAD DEL SERVICIO Y SOPORTE

8.1. Aegis realizará esfuerzos razonables para mantener el Servicio
disponible, pero no garantiza disponibilidad ininterrumpida. Pueden
existir ventanas de mantenimiento programado o interrupciones no
planificadas.
`[PLACEHOLDER: definir si existe un compromiso de nivel de servicio (SLA) con porcentaje de disponibilidad y créditos de servicio, o declarar expresamente que no existe SLA formal en esta etapa]`.

8.2. `[PLACEHOLDER: definir canal y horario de soporte técnico disponible para el Cliente]`.

---

## 9. LIMITACIÓN DE RESPONSABILIDAD Y DECLARACIONES

9.1. El Servicio se provee "tal cual" (*as is*). Aegis no garantiza que
el Servicio detecte la totalidad de las vulnerabilidades o brechas de
seguridad existentes en los activos del Cliente — el análisis realizado
es de alcance perimetral y externo (ver Cláusula 2.3), y no sustituye
una auditoría de seguridad integral, una prueba de penetración activa ni
una revisión de código fuente.

9.2. Aegis no será responsable por daños derivados de: (i) declaraciones
falsas del Cliente sobre la titularidad de un activo escaneado; (ii) uso
del Servicio en infracción de estos Términos; (iii) decisiones de
negocio adoptadas por el Cliente exclusivamente en base a los resultados
del Servicio, sin la debida diligencia adicional que corresponda a su
nivel de riesgo.

9.3. `[PLACEHOLDER: definir tope indemnizatorio (ej. montos pagados en los últimos N meses) y exclusión de daños indirectos/lucro cesante — consistente con la Cláusula 9 del DPA]`.

---

## 10. VIGENCIA Y TERMINACIÓN

10.1. Estos Términos rigen mientras el Cliente mantenga una cuenta
activa en el Servicio.

10.2. Cualquiera de las Partes puede terminar la relación contractual
conforme a lo pactado en la Orden de Compra o Contrato Principal
correspondiente.
`[PLACEHOLDER: definir plazo de preaviso para terminación sin causa y causales de terminación inmediata, ej. incumplimiento de la Cláusula 3 o uso indebido del Servicio]`.

10.3. Al terminar la relación, se aplica el procedimiento de eliminación
o devolución de datos previsto en el Acuerdo de Tratamiento de Datos
(DPA).

---

## 11. LEY APLICABLE Y JURISDICCIÓN

`[PLACEHOLDER: definir ley aplicable y tribunales/jurisdicción competente].`

---

## AVISO DE RESPONSABILIDAD

Este documento es un **borrador de trabajo** generado con asistencia de
inteligencia artificial. **No constituye asesoría legal**, no ha sido
revisado ni validado por un abogado habilitado, y **no debe utilizarse,
publicarse ni hacerse valer frente a un Cliente o tercero sin la
revisión y validación previa de un profesional del derecho**
especializado en contratos de software SaaS y derecho digital en Chile.
Los campos marcados como `[PLACEHOLDER: ...]` identifican información
comercial, técnica o legal no confirmada al momento de redactar este
borrador.
