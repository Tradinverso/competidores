# Sincronización Dashboard → Google Sheet y Drive

El script `sync-dashboard.gs` mantiene el Google Sheet como repositorio sin cambiar el orden ni los códigos de `pestaña 1`.

- Lee el estado compartido desde Supabase.
- Actualiza las casillas de Reels y Seguidores y las Notas de `pestaña 1` por código `Cxxx`.
- Crea o refresca la pestaña `Dashboard` con el detalle completo.
- Copia los CSV guardados en Supabase a las carpetas `Reels` o `Seguidores` de Drive.
- Se ejecuta automáticamente cada cinco minutos.

La clave privada de Supabase se guarda únicamente en las propiedades privadas del proyecto de Apps Script y nunca en este repositorio.
