# AppTesoreria

Aplicación web para registrar comprobantes en Google Drive y Google Sheets. La interfaz permite seleccionar un evento, describir el concepto, ingresar el valor y adjuntar la imagen del comprobante. El backend envía el archivo a la carpeta indicada en Drive y registra la operación en la hoja proporcionada.

## Requisitos

- Node.js 18 o superior.
- Una cuenta de servicio de Google Cloud con permisos sobre la hoja de cálculo y la carpeta de Drive.
- Variables de entorno configuradas (ver `.env.example`).

## Configuración

1. Duplica el archivo `.env.example` con el nombre `.env` y rellena los valores:
   - `GOOGLE_CLIENT_EMAIL` y `GOOGLE_PRIVATE_KEY`: datos de la cuenta de servicio.
   - `GOOGLE_SHEETS_ID`: ID de la hoja (por ejemplo `1UtO3_eMR2pmWLl4e1BCZ_2LhNeVBro0bBGhGdmtslBQ`).
   - `GOOGLE_SHEETS_EVENTS_RANGE`: rango con la lista de eventos (columna A = evento, columna B = presupuesto).
   - `GOOGLE_SHEETS_LOG_RANGE`: rango inicial donde se anexarán los nuevos registros (columnas evento, concepto, valor y link).
   - `GOOGLE_DRIVE_FOLDER_ID`: carpeta destino para las imágenes (por ejemplo `1L3tBSDVz70ViiaVA-KuumOR-5hWxANWZ`).
   - Ajusta `MAX_IMAGE_SIZE` si necesitas admitir archivos más grandes.

   > Con la configuración por defecto se espera que la hoja tenga una pestaña llamada `eventos` con las columnas **Evento** y
   > **Ppto**, y otra pestaña llamada `registro` con las columnas **Evento**, **Concepto**, **Valor** y **Link**.

2. Comparte la hoja de cálculo y la carpeta de Drive con el correo de la cuenta de servicio usando permisos de editor.

3. (Opcional) Instala dependencias si agregas librerías adicionales:
   ```bash
   npm install
   ```

## Ejecutar la aplicación

1. (Opcional) Para hacer pruebas rápidas sin conectarte a Google, activa el modo demo en tu `.env`:
   ```bash
   USE_MOCK_DATA=true
   ```

2. Arranca el servidor local:
   ```bash
   npm start
   ```

3. Abre [http://localhost:5173](http://localhost:5173) para utilizar la interfaz.

   - Si `USE_MOCK_DATA=true`, la API responderá con eventos y presupuestos de ejemplo, guardará las imágenes en la carpeta `mock_uploads/` del proyecto y podrás verlas desde los enlaces generados.
   - Si `USE_MOCK_DATA=false`, el servidor contactará a Google Drive y Google Sheets usando las credenciales configuradas.

## Flujo de funcionamiento

1. La página consulta `/api/events` para obtener el catálogo de eventos desde Google Sheets.
2. Al enviar el formulario, la imagen se codifica en base64 y se envía junto con los demás datos a `/api/vouchers`.
3. El servidor valida la información, sube el archivo a Google Drive y guarda un nuevo registro en la hoja de cálculo.
4. La respuesta del backend actualiza la tabla local con el enlace del comprobante y el estado de validación.

## Validación automática

Actualmente se realiza una validación simple que compara el monto ingresado con los números encontrados en el nombre del archivo. Puedes ampliar la función `evaluateImageConsistency` en `server.js` para integrar servicios como Cloud Vision OCR y realizar comprobaciones más avanzadas.

## Modo demo sin credenciales de Google

Cuando necesites mostrar la interfaz sin exponer claves reales, habilita el modo demo (`USE_MOCK_DATA=true`). El servidor devolverá tres eventos de ejemplo (Navidad, Kickoff Q1 y Formación), llevará el historial en memoria y almacenará los archivos en `mock_uploads/`. De esta forma puedes practicar el flujo completo (carga, validación y mensajes de presupuesto disponible) sin depender de los servicios de Google.

## Opciones de despliegue sin costo

- **Frontend estático (sin servidor):** El contenido de `public/` es una página estática. Puedes publicarla en GitHub Pages, Netlify o Cloudflare Pages sin coste. Solo debes construir un repositorio público o privado y apuntar el despliegue a esa carpeta.
- **Backend Node.js gratuito:** Servicios como Render (Web Service Free Tier) o Railway (Starter plan) permiten desplegar este `server.js` sin coste inicial. Basta con crear el servicio, subir el repositorio y definir las variables de entorno (`PORT`, `GOOGLE_*`, `USE_MOCK_DATA`, etc.). Ambos servicios ofrecen HTTPS automático.
- **Alternativa serverless:** Google Cloud Run y Fly.io tienen niveles gratuitos suficientes para demos. Empaqueta la aplicación en un contenedor pequeño, define las variables de entorno y conéctala a las APIs de Google mediante la cuenta de servicio. Para evitar costes inesperados, activa límites de uso mensuales.

En cualquier opción conviene almacenar las credenciales de Google como secretos del proveedor (nunca las publiques en el repositorio) y restringir el acceso a la carpeta de Drive y a la hoja de cálculo solo a la cuenta de servicio utilizada.

## Limitaciones conocidas

- El tamaño máximo del archivo se valida en memoria, por lo que para cargas muy grandes conviene implementar almacenamiento temporal en disco o streaming.
- La aplicación depende de que la estructura de la hoja coincida con los rangos configurados.
