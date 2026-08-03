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
- Registrar el número de seguidores y la fecha de actualización.
- Asociar un CSV de Mailerfind a cada competidor.
- Marcar perfiles como estudiados.
- Filtrar, buscar, importar y exportar una copia del seguimiento.

Los datos de trabajo se guardan localmente en el navegador. Los CSV se almacenan en el mismo dispositivo mediante el almacenamiento interno del navegador.

## Fuente inicial

La primera carga se generó desde `data/competencia-original.xlsx`. No se importaron las columnas de avatar, seguimiento propio ni verificación.
