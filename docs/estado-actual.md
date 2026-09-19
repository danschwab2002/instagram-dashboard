# Estado actual del sistema

> Fecha de corte: **2026-09-19**. Medido contra el código, no contra la memoria.
> Último commit de producto: `7dd2169` (2026-08-17).

Este documento dice **qué existe hoy, con qué grado de terminación, y qué no existe**.
Es el punto de partida del desarrollo y se actualiza cuando una brecha se cierra.

---

## 1. Salud técnica

Verificado el 19/09 sobre un clon limpio de `main`.

| Chequeo | Resultado |
|---|---|
| `npm install` | correcto |
| `npm run typecheck` | sin errores |
| `npm run build` | correcto |
| Archivos de entorno en el historial de git | ninguno, nunca |
| Tamaño | ~12.600 líneas, 61 commits |

**Stack.** Next.js 16 (App Router) · React 19 · TypeScript en modo estricto · Tailwind 4 ·
PostgreSQL 17 con `pg` y SQL crudo, sin ORM · GoTrue standalone para autenticación ·
Apify como proveedor de datos · `zod` para validar respuestas externas.

**Prerrequisito de desarrollo.** La base local se levanta con `npm run db:local`, que
necesita **Docker corriendo**. Sin eso no arranca nada que toque datos.

---

## 2. Lo que funciona hoy

### Ingesta
Sólida y con control de costo explícito, que es lo caro de construir y ya está hecho.

- **Dos actores de Apify a propósito**: el oficial para perfiles, `apidojo` para posts.
  El motivo está documentado en `app/lib/apify/post-scraper.ts:7-22`: sólo el segundo
  devuelve reproducciones de video, veces compartidas, duración y si el post es pauteado.
- **Errores tipados** y reintentos con espera creciente: autenticación y falta de crédito
  abortan la corrida entera en vez de quemar llamadas condenadas.
- **Filtro de fecha del lado de Apify**, que es lo que evita pagar por contenido viejo.
- **Reserva atómica de trabajo** contra doble gasto: la misma sentencia que selecciona
  la cuenta la marca como en curso. Con recuperación de reservas huérfanas.
- **Concurrencia limitada** a 3 perfiles y 2 feeds, para que el gasto sea legible.
- Persistencia por inserción con actualización ante conflicto, sin duplicar.

### Métricas que se calculan y se usan
- **Tasa de interacción**: `(likes + comentarios + veces compartidas) / seguidores`.
- **Puntaje de desempeño**: para video, reproducciones normalizadas al 60 por ciento más
  interacción al 40; para imagen y carrusel, interacción pura.
- **Métricas agregadas por conjunto curado**: mediana, mínimo y máximo, recalculadas al
  agregar o quitar contenido.

### Pantallas
- **Listado de contenidos**: 18 columnas configurables, 17 filtros, ordenamiento por 10
  columnas con lista blanca del lado del servidor, selección masiva, ficha de contenido.
- **Investigaciones**: alta con nombre, ventana de días y pegado de cuentas; detalle con
  estado de recolección por etapa y por cuenta.
- **Conjuntos curados**: alta, metadata editable, métricas agregadas, descarga en JSON.
- **Análisis conversacional**: un agente de aperturas, en dos fases.
- **Configuración**: credenciales por usuario y selector de proveedor de IA.

---

## 3. Brechas verificadas

Ordenadas por severidad. Cada una tiene su evidencia en el código.

### 3.1 Escrito pero nunca ejecutado

| Qué | Dónde | Consecuencia |
|---|---|---|
| **Rendimiento contra el promedio del propio autor** | `db/migrations/012_add_outlier_scores.sql:40` | La función existe. `run_full_scoring()` en `db/functions.sql:107` **no la llama**. Las columnas quedan vacías. **La interfaz ya muestra esas columnas y su filtro**, así que hoy se ven siempre en blanco |
| **Índice de confianza** | misma función | Mismo caso. Se calcula adentro de la anterior |
| **Puntuación del contenido propio** | `013_add_ig_media_scores.sql` | Cuatro funciones pensadas para dispararse desde fuera del repo |

Es la brecha de mejor relación entre valor y esfuerzo: el trabajo difícil está hecho y
nadie aprieta el botón.

### 3.2 Se captura pero no se muestra

| Qué | Dónde | Consecuencia |
|---|---|---|
| **Evolución de seguidores de las cuentas monitoreadas** | `account_snapshots`, escrita en cada recolección de perfil | Ninguna consulta la lee y ninguna pantalla la grafica. La serie histórica se está acumulando en silencio |
| **Contenido pauteado** | `posts.is_paid_partnership` | Se recolecta y se guarda. No se lee, no se filtra, no se muestra |
| **Auditoría de corridas** | `scrape_runs` | Guarda qué se recolectó y cuándo. Nadie la lee. Además no se guarda el identificador de la corrida de Apify ni su costo |

### 3.3 Delegado a un sistema externo que no está en este repositorio

Tres capacidades dependen de flujos de n8n que viven afuera:

1. **Análisis de aperturas con IA.** `app/api/posts/analyze/route.ts:38` publica contra un
   webhook. Todo el procesamiento de video, transcripción y modelo ocurre fuera.
2. **Chat de agentes.** `app/api/ai/chat/route.ts:61`, mismo patrón. **No hay una sola
   llamada directa a un proveedor de IA en todo el repositorio.**
3. **Todo el módulo de cuenta propia.** Ocho tablas que ninguna línea de TypeScript
   escribe. La pantalla lo dice literalmente: *"Ejecuta la carga historica desde n8n"*.

También queda pendiente la descarga de video a almacenamiento propio
(`app/lib/jobs/research-pipeline.ts:75`), sin la cual la ficha no reproduce nada.

### 3.4 No existe

- **Exportación a CSV y XLSX.** Búsqueda de csv, xlsx, excel y de las librerías habituales
  en todo el repositorio: cero resultados. Lo único que hay es descarga en JSON de un
  conjunto curado.
- **Panel de consumo y costo por corrida.**
- **Inferencia de idioma.** Se consume el campo si un sistema externo lo manda.
- **Pisos mínimos configurables** para descartar ruido estadístico.

### 3.5 Control de acceso, parcial y desparejo

Hay aislamiento por usuario en investigaciones, conjuntos curados y sesiones de IA. **No lo
hay donde más importa:**

- `getPosts()` y `getStats()`, las consultas principales del listado, **no filtran por
  usuario**. Cualquiera que entre ve el contenido recolectado por todos.
- `getOwners()` expone la lista de correos de todos los usuarios.
- `app/api/ig/stories/[id]/snapshots/route.ts` **no verifica sesión en absoluto**.
- No hay políticas de seguridad a nivel de fila en la base, ni roles.

### 3.6 Verificación

- **Dos de los tres conjuntos de prueba no arrancan.** Leen un archivo de ejemplo desde
  una ruta fuera del repositorio, en `apify-documentation/`, que no existe. Fallan al
  importar, antes de correr un solo escenario. Sólo el de recolección de contenido es
  autocontenido.
- **No hay integración continua.** No existe `.github/`.
- Sin cobertura: los diez manejadores de API, autenticación, control de acceso, conjuntos
  curados, sesiones de IA y toda la interfaz.

### 3.7 Inconsistencia de documentación

La ayuda en pantalla del puntaje de desempeño (`app/components/Dashboard.tsx:126`) describe
una fórmula de cuatro factores ponderados. El SQL que realmente corre implementa otra. Una
de las dos miente al usuario.

---

## 4. Acoplamiento al origen

Lo que ata el sistema a su primera implementación. **Es trabajo obligatorio antes de
cualquier cesión de código.**

| Qué | Alcance |
|---|---|
| **Nombre de marca en la interfaz** | 16 archivos, como texto literal. No hay variable de marca, ni configuración, ni tema |
| **Cuentas de Instagram reales** | Tres identificadores en el texto de ayuda de un campo, `app/researches/ResearchesPage.tsx:224` |
| **Dirección del servidor de despliegue** | `scripts/db-deploy.sh:8,9,102`, con usuario administrador |
| **Nombres de servicios de infraestructura** | En el script de despliegue y en la guía |
| **Referencias a un sistema de trazabilidad externo** | Códigos de decisiones, lecciones y flujos en 11 archivos, más menciones a un registro y a archivos que no existen acá |
| **Comentarios en primera persona nombrando al autor** | `app/lib/apify/profile-scraper.ts:8` |

### Historial de git

El commit `7dd2169` limpió el árbol de trabajo. **Diecinueve commits anteriores conservan
la dirección del servidor anterior y una clave de demostración**, recuperables con un
`git checkout`. Limpiar el presente no alcanza.

La consecuencia es de diseño, no de limpieza: **un repositorio que se cede parte de un
historial nuevo**, no de una reescritura del existente.

---

## 5. Resumen

Lo caro ya está hecho: la ingesta con control de costo, el modelo de datos y el listado con
sus filtros. Lo que falta se reparte en cuatro grupos, de menor a mayor esfuerzo.

1. **Apretar botones que ya existen.** Ejecutar la puntuación de valores atípicos y su
   índice de confianza.
2. **Mostrar lo que ya se guarda.** Evolución de seguidores, contenido pauteado, auditoría
   de corridas.
3. **Construir lo que no está.** Exportación, panel de consumo, pisos mínimos, idioma.
4. **Traer adentro lo que vive afuera.** El análisis de aperturas, hoy en un sistema
   externo, es la capacidad que convierte el tablero en material de producción.

Transversal a todo: cerrar el aislamiento entre usuarios, hacer que la verificación corra,
y despersonalizar.
