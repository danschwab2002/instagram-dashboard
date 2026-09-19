# Fixtures de test

Datos de ejemplo que consumen los tests de punta a punta.

**Son sinteticos a proposito.** No corresponden a ninguna cuenta real de Instagram
ni a datos de ningun cliente. Cualquier fixture que se agregue acá tiene que
cumplir lo mismo: si hace falta un caso con forma de dato real, se inventa el
dato, no se copia uno.

**Viven adentro del repositorio a proposito.** Antes `perfil-instagram.json` se
leia desde `../../apify-documentation/`, una ruta fuera del repo que no existe en
un clon limpio: dos de los tres tests fallaban al importar, antes de correr un
solo escenario. Un test que depende de algo que no viaja con el repositorio no
es un test.

## Que hay

| Archivo | Que es | Quien lo usa |
|---|---|---|
| `perfil-instagram.json` | Un perfil con la forma que devuelve el actor de perfiles de Apify | `scrape-profiles.e2e.ts`, `research-pipeline.e2e.ts` |

El contrato que tiene que cumplir `perfil-instagram.json` esta en
`app/lib/apify/profile-scraper.ts`. Todos los campos son opcionales salvo
`username`, porque Instagram no expone lo mismo para toda cuenta. El fixture
trae el caso completo: los tests que necesitan campos faltantes los sacan
sobreescribiendo, no cambiando este archivo.
