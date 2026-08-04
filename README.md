# Radar de Competidores

Dashboard de Tradingverso para ordenar, investigar y hacer seguimiento de competidores.

La raíz del proyecto contiene una versión estática lista para GitHub Pages:

- `index.html`
- `styles.css`
- `dashboard.js`
- `competidores-data.js`
- carpeta `public`

Para publicarla en GitHub, sube el contenido de esta carpeta a un repositorio y activa **Settings → Pages → Deploy from a branch**, seleccionando la rama principal y la carpeta raíz.

## Qué permite hacer

- Mantener una cola manual de prioridad.
- Añadir y editar perfiles de Instagram y YouTube.
- Registrar el número visible de seguidores y seguidos.
- Controlar por separado las extracciones de Seguidos, Seguidores, reels de venta y reels de recurso.
- Guardar varias URL de reels y asociar un CSV de Mailerfind a cada extracción.
- Contar automáticamente los emails y teléfonos detectados en cada CSV.
- Marcar perfiles como estudiados.
- Filtrar, buscar, importar y exportar una copia del seguimiento.

Los datos de trabajo se guardan localmente en el navegador. Los CSV se almacenan en el mismo dispositivo mediante el almacenamiento interno del navegador.

Cuando la sesión de nube está activa, el estado se guarda en Supabase y el sincronizador de `google-apps-script/` actualiza el Google Sheet y las carpetas de Drive cada cinco minutos, siempre por código `Cxxx` y sin reordenar la hoja maestra.

Los seguidores de Instagram se comprobaron desde una sesión autenticada el 3 de agosto de 2026. El archivo `data/instagram-followers-2026-08-03.json` conserva el resultado y distingue cifras válidas, cuentas no disponibles y contadores no localizados.

Las cuentas que inicialmente dieron error se buscaron de nuevo en Instagram. Se conservaron únicamente las coincidencias claras relacionadas con trading, se corrigieron sus nombres de usuario cuando fue necesario y se eliminaron las cuentas inexistentes, ambiguas o ajenas al sector. El detalle queda registrado en `data/instagram-cleanup-2026-08-03.json`.

## Fuente inicial

La primera carga se generó desde `data/competencia-original.xlsx`. No se importaron las columnas de avatar, seguimiento propio ni verificación.
