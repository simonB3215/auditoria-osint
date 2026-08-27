BUILD PROMPT: Parte 2 - Suite de integracion en CI (Redis + Supabase) y cierre del schema de Zod
Rol e instrucciones

Actua como ingeniero senior poniendo la suite de tests de integracion a correr en CI de forma confiable, y cerrando el schema de validacion de entorno. Trabaja en dos fases: primero INVENTARIAR el entorno de test y PROPONER el diseno de CI (sin implementar), luego IMPLEMENTAR tras confirmacion. La suite es de integracion real contra Supabase sin mocks, asi que el CI debe proveer las dependencias reales (Redis y una instancia de Supabase/Postgres que NO sea produccion) sin tocar datos de produccion.

Contexto (leer antes de tocar nada)
Suite: Jest + Supertest, integracion real contra Supabase (sin mocks). Archivos de test existentes, entre ellos tests/scanAndReport.test.ts con TC-10 (usa la cola BullMQ, requiere Redis) y TC-13 (no requiere Redis, ya pasa).
Hoy TC-10 falla con ECONNREFUSED 127.0.0.1:6379 porque no hay Redis local; .env.test apunta a localhost:6379 a proposito, para no tocar el Upstash de produccion.
No existe CI de tests. Si existe ya un workflow de gitleaks (.github/workflows/gitleaks.yml); integrarse limpio con el, sin romperlo.
Stack: Node.js + Express 5 + TypeScript (ESM). Redis via BullMQ. Postgres/Auth/Storage/RLS via Supabase.
Hay trabajo intencionalmente sin commitear en el working tree (sistema de cookies y andamiaje). NO lo toques ni lo incluyas en commits.
Reglas (innegociables)
El CI NUNCA usa credenciales ni instancias de produccion (ni Supabase ni Upstash de prod). Los tests corren contra dependencias efimeras o contra un entorno de test dedicado, nunca contra datos reales.
Ningun secreto hardcodeado en el workflow ni en el repo. Usar GitHub Actions secrets o valores dummy generados. La EVIDENCE_ENCRYPTION_KEY de test es un valor dummy con el formato correcto (64 hex).
No debilitar ni saltear tests para que el pipeline pase en verde. Si un test falla de verdad, se reporta.
No commitear a ciegas: presentar el diseno de CI y esperar confirmacion antes de implementar (la decision de Supabase-en-CI tiene implicancias de costo y datos).
Fase 1 - Inventario y propuesta (sin implementar)
1.1 Dependencias del entorno de test

Determinar TODO lo que la suite necesita para correr, leyendo .env.test, la config de Jest y el codigo de setup de tests:

Redis: como se conecta (confirmar que .env.test apunta a localhost:6379, de modo que un service container de Redis mapeado a 6379 funcione sin cambiar la config).
Supabase/Postgres: a que apunta hoy la suite. Es clave determinar si .env.test usa (a) un proyecto Supabase en la nube (dedicado o, en el peor caso, compartido/prod), o (b) un stack local. De esto depende el diseno del CI.
Cualquier otra variable requerida para arrancar (encryption key, secrets, migraciones a aplicar, seeds a cargar).
1.2 Propuesta de diseno de CI

Proponer un workflow de GitHub Actions que provea las dependencias reales sin tocar produccion:

Redis: como services: (service container) en el job; el modo mas simple. Confirmar que queda accesible en localhost:6379.
Supabase/Postgres: presentar las opciones con su trade-off y recomendar una, esperando decision:
Opcion A: stack local de Supabase via la CLI oficial (supabase start) dentro del runner. Replica Postgres + Auth + Storage + RLS de forma fiel y efimera; nada en la nube. Mas pesado de arrancar.
Opcion B: un proyecto Supabase de test dedicado en la nube, con credenciales en GitHub secrets. Mas simple de conectar, pero es estado compartido entre corridas (riesgo de colisiones) y hay que gestionarlo. Nunca usar el proyecto de produccion. Recomendar la opcion que mejor preserve la fidelidad de "integracion real" sin arriesgar datos, y justificar.
Definir los pasos: checkout, setup de Node, instalacion, provisioning de dependencias (Redis service
Supabase segun opcion), aplicacion de migraciones sobre la DB de test, generacion/inyeccion de las variables de .env.test (dummies o secrets), y ejecucion de la suite completa.

Presentar el diseno y ESPERAR confirmacion antes de implementar.

Fase 2 - Implementacion (tras confirmacion)
Crear el workflow de CI de tests (nuevo job o archivo), que corra la suite completa en cada push y PR.
Asegurar que TC-10 corre en verde contra el Redis provisto, y que toda la suite pasa (11/12 pasa a 12/12; si algun otro test estaba latente por falta de infra, exponerlo y tratarlo honestamente).
No romper el workflow de gitleaks existente; integrarse de forma coherente.
Fase 3 - Cierre del schema de Zod (env.ts)
Agregar al schema de Zod las variables que hoy la app usa pero no valida: DATABASE_URL y RESEND_API_KEY.
Precision importante: RESEND_API_KEY debe ser OPCIONAL en el schema. El envio de emails es best-effort ("preparado pero no conectado"): su ausencia es un estado valido que activa el fallback de log en consola. NO hacerla requerida (romperia ese diseno). DATABASE_URL si es requerida.
Actualizar .env.example / .env.test.example para reflejar ambas variables, con placeholders.
Fase 4 - Verificacion
El workflow corre en verde en un push/PR real (o en su defecto, dejar evidencia de por que no se pudo validar en este entorno y que queda pendiente del primer push).
tsc --noEmit y npm run build limpios en ambos lados.
La suite completa pasa localmente donde haya dependencias, y el diseno garantiza que pasa en CI.
env.ts valida ahora DATABASE_URL (requerida) y RESEND_API_KEY (opcional) al arrancar.
Fase 5 - Commits (presentar plan y esperar confirmacion)
Agrupar en commit(s) tematico(s) de esta tarea (CI de tests; cierre de schema). NO arrastrar el sistema de cookies ni el andamiaje sin commitear.
Presentar el plan de commits y esperar confirmacion antes de crear y pushear.
Fuera de alcance
No usar Supabase ni Upstash de produccion en ningun caso.
No eliminar el valor inerte auditor_guest del enum (esa limpieza de esquema es una tarea posterior, ahora habilitada por tener CI, pero no es parte de esta).
No commitear el sistema de cookies (sin probar) ni el andamiaje.
No modificar la logica de negocio para acomodar el CI; el CI se adapta al codigo, no al reves.
Entregable
Inventario de dependencias del entorno de test (Redis, Supabase/Postgres, variables) y a que apunta hoy cada una.
Diseno de CI propuesto, con la recomendacion de Supabase (Opcion A vs B) y su justificacion.
Tras confirmacion: workflow implementado; resultado de la suite en CI (objetivo 12/12) o evidencia de validacion pendiente del primer push.
Cierre del schema de Zod: DATABASE_URL requerida, RESEND_API_KEY opcional; templates actualizados.
Resultado de tsc/build; plan de commits y, tras confirmacion, commits creados con sus hashes.