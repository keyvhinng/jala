# Preferencias de viaje

En **Cuenta**, la persona puede elegir si suele reservar el taxi y cuándo suele salir. Al guardar, Atomic Memory conserva solo esas dos opciones para la cuenta autenticada. Inicio y el formulario `/ride` las usan como valores iniciales; siempre pueden cambiarse antes de buscar grupo. No se guardan direcciones ni ubicaciones en Atomic Memory.

**Olvidar mis preferencias** elimina el registro y vuelve a los valores habituales. Un guardado o borrado fallido muestra un aviso y conserva el estado anterior. Los enlaces que ya especifican una hora tienen prioridad sobre el valor guardado. Una respuesta tardía no reemplaza una elección que la persona ya hizo en Inicio.

## Activar

Configura `ATOMICMEMORY_API_URL` y `ATOMICMEMORY_API_KEY` solo en el servidor, con un proyecto independiente para Jala. Sin ambas variables no aparece la tarjeta y el planificador sigue funcionando como antes. Nunca uses variables `NEXT_PUBLIC_` para la clave.

La identidad viene de la sesión de Jala. Se usa un sujeto `jala-user:<id de cuenta>`, sin thread ni namespace. Las escrituras requieren el mismo origen y tienen una cuota por cuenta. Las lecturas abandonan a los 1,5 segundos y las escrituras a los 4 segundos. Configura además límites de consumo en el proveedor.

Se usa la API HTTP de Atomic Memory: ingesta verbatim con `content_class=summary` y un `metadata.externalId` estable, consulta y borrado del registro. Se verifica la confirmación de guardado o borrado, no solo el estado HTTP. La clave solo viaja por HTTPS; HTTP se permite exclusivamente para una prueba local en loopback.

## Reproducir la demo

Las capturas y el video muestran la aplicación real con una cuenta ficticia, PostgreSQL local y un proveedor HTTP simulado. No son una validación del servicio alojado de Atomic Memory.

1. Completa la configuración local de PostgreSQL y las migraciones descritas en README.
2. Ejecuta `ATOMICMEMORY_API_KEY=fixture-key ATOMICMEMORY_FIXTURE_PORT=4821 bun scripts/atomic-memory-fixture.ts`.
3. Inicia la app con `ATOMICMEMORY_API_URL=http://127.0.0.1:4821`, `ATOMICMEMORY_API_KEY=fixture-key` y `NEXT_PUBLIC_APP_URL=http://localhost:4820`: `bun dev --hostname 127.0.0.1 --port 4820`.
4. Crea una cuenta ficticia, abre Cuenta y guarda una preferencia. Recarga y comprueba que se conserva. Abre el formulario de viaje y comprueba que empieza con esa opción. Corrígela o elimínala desde Cuenta.

El proveedor de prueba dura solo mientras vive el proceso. `--fail` permite observar el aviso de indisponibilidad sin usar credenciales reales.

Referencias: [identidad y scope](https://docs.atomicstrata.ai/sdk/concepts/scopes-and-identity), [API de Atomic Memory](https://docs.atomicstrata.ai/api-reference/http).
