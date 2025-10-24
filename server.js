const http = require('http');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const __dirnameSafe = __dirname;

loadEnvFile();

const PORT = Number.parseInt(process.env.PORT || '5173', 10);
const PUBLIC_DIR = path.join(__dirnameSafe, 'public');
const USE_MOCK_DATA = String(process.env.USE_MOCK_DATA || '').toLowerCase() === 'true';
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL || '';
const GOOGLE_PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID || '';
const GOOGLE_SHEETS_EVENTS_RANGE = process.env.GOOGLE_SHEETS_EVENTS_RANGE || 'eventos!A2:B';
const GOOGLE_SHEETS_LOG_RANGE = process.env.GOOGLE_SHEETS_LOG_RANGE || 'registro!A2:D';
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '';
const MAX_IMAGE_SIZE = Number.parseInt(process.env.MAX_IMAGE_SIZE || `${5 * 1024 * 1024}`, 10);
const MOCK_UPLOADS_DIR = path.join(__dirnameSafe, 'mock_uploads');

const mockRecords = [];
const MOCK_EVENTS = [
  { id: 'navidad', name: 'Navidad', budget: 500, rawBudget: '$500.00' },
  { id: 'kickoff-q1', name: 'Kickoff Q1', budget: 1200, rawBudget: '$1,200.00' },
  { id: 'formacion', name: 'Formación', budget: 800, rawBudget: '$800.00' },
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.heic': 'image/heic',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const tokenCache = new Map();
let eventsCache = { timestamp: 0, events: [] };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (USE_MOCK_DATA && url.pathname.startsWith('/mock/')) {
      await serveMockFile(url, req, res);
      return;
    }
    if (url.pathname === '/api/events' && req.method === 'GET') {
      await handleGetEvents(res);
      return;
    }

    if (url.pathname === '/api/vouchers' && req.method === 'POST') {
      await handleCreateVoucher(req, res);
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStaticFile(url, req, res);
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Método no permitido' }));
  } catch (error) {
    console.error('Error inesperado:', error);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Error interno del servidor' }));
  }
});

server.listen(PORT, () => {
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
  if (USE_MOCK_DATA) {
    console.log('Modo demo activo: se usarán datos simulados y los archivos se guardarán en mock_uploads/.');
  }
});

function loadEnvFile() {
  const envPath = path.join(__dirnameSafe, '.env');
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .forEach((line) => {
        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) return;
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        if (!(key in process.env)) {
          process.env[key] = value;
        }
      });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('No se pudo cargar el archivo .env:', error.message);
    }
  }
}

async function serveStaticFile(url, req, res) {
  let filePath = path.join(PUBLIC_DIR, decodeURIComponent(url.pathname));

  if (url.pathname === '/') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acceso denegado');
    return;
  }

  try {
    const stats = await fsPromises.stat(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const file = await fsPromises.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    if (req.method === 'GET') {
      res.end(file);
    } else {
      res.end();
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Archivo no encontrado');
    } else {
      console.error('Error al servir archivo estático:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error interno del servidor');
    }
  }
}

async function serveMockFile(url, req, res) {
  try {
    const relative = decodeURIComponent(url.pathname.replace(/^\/mock\//, ''));
    if (!relative) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Archivo no encontrado');
      return;
    }

    const filePath = path.join(MOCK_UPLOADS_DIR, relative);
    if (!filePath.startsWith(MOCK_UPLOADS_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Acceso denegado');
      return;
    }

    const stats = await fsPromises.stat(filePath);
    if (!stats.isFile()) {
      throw new Error('not-file');
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const file = await fsPromises.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    if (req.method === 'GET') {
      res.end(file);
    } else {
      res.end();
    }
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Archivo no encontrado');
  }
}

async function handleGetEvents(res) {
  try {
    const events = await fetchEventCatalog();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        events,
        maxImageSize: MAX_IMAGE_SIZE,
        mode: USE_MOCK_DATA ? 'mock' : 'live',
      })
    );
  } catch (error) {
    console.error('Error al cargar eventos:', error);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'No se pudo sincronizar la lista de eventos' }));
  }
}

async function handleCreateVoucher(req, res) {
  try {
    if (
      !USE_MOCK_DATA &&
      (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_SHEETS_ID || !GOOGLE_DRIVE_FOLDER_ID)
    ) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({ error: 'Configuración incompleta: revisa las variables de entorno de Google.' })
      );
      return;
    }

    const bodyBuffer = await readRequestBody(req, MAX_IMAGE_SIZE * 2);
    const payload = JSON.parse(bodyBuffer.toString('utf8'));

    const { eventId, concept, amount, file } = payload;

    if (!eventId || typeof eventId !== 'string') {
      throw new Error('Selecciona un evento válido.');
    }
    if (!concept || typeof concept !== 'string' || !concept.trim()) {
      throw new Error('Ingresa un concepto.');
    }
    const parsedAmount = Number.parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      throw new Error('Ingresa un valor numérico mayor a cero.');
    }
    if (!file || typeof file !== 'object') {
      throw new Error('Adjunta una imagen del comprobante.');
    }
    if (!file.base64 || typeof file.base64 !== 'string') {
      throw new Error('La imagen recibida es inválida.');
    }

    const binary = Buffer.from(file.base64, 'base64');
    if (!binary.length) {
      throw new Error('El archivo está vacío o corrupto.');
    }
    if (binary.length > MAX_IMAGE_SIZE) {
      throw new Error(`El archivo supera el tamaño máximo permitido de ${(MAX_IMAGE_SIZE / (1024 * 1024)).toFixed(1)} MB.`);
    }

    const events = await fetchEventCatalog();
    const selectedEvent = events.find((event) => event.id === eventId);
    if (!selectedEvent) {
      throw new Error('El evento seleccionado ya no está disponible.');
    }

    const validation = evaluateImageConsistency(parsedAmount, file.name || '');

    const previousTotal = await fetchEventAccumulated(selectedEvent.name);
    const projectedTotal = previousTotal + parsedAmount;
    const budgetStatus = buildBudgetStatus({
      budget: selectedEvent.budget,
      totalSpent: projectedTotal,
    });

    const uploadResult = await uploadToDrive({
      buffer: binary,
      originalName: file.name || `comprobante-${Date.now()}`,
      mimeType: file.type || 'application/octet-stream',
    });

    await appendToSheet({
      eventName: selectedEvent.name,
      concept: concept.trim(),
      amount: parsedAmount,
      driveFile: uploadResult,
    });

    res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        message: validation.message,
        budgetStatus,
        mode: USE_MOCK_DATA ? 'mock' : 'live',
        record: {
          eventId,
          eventName: selectedEvent.name,
          concept: concept.trim(),
          amount: parsedAmount,
          validationStatus: validation.status,
          driveFile: {
            id: uploadResult.id,
            name: uploadResult.name,
            webViewLink: uploadResult.webViewLink,
            webContentLink: uploadResult.webContentLink,
          },
          budgetStatus,
        },
      })
    );
  } catch (error) {
    console.error('Error al crear el registro:', error);
    const message = error.message || 'Error al procesar la solicitud.';
    const status =
      message.startsWith('El archivo supera') || message.includes('excede el tamaño') ? 413 : 400;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: message }));
  }
}

async function readRequestBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error('El cuerpo de la solicitud excede el tamaño permitido.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    req.on('error', (error) => {
      reject(error);
    });
  });
}

async function fetchEventCatalog() {
  if (USE_MOCK_DATA) {
    eventsCache = { events: MOCK_EVENTS, timestamp: Date.now() };
    return MOCK_EVENTS;
  }
  const now = Date.now();
  if (eventsCache.events.length && now - eventsCache.timestamp < 5 * 60 * 1000) {
    return eventsCache.events;
  }

  const token = await getAccessToken(['https://www.googleapis.com/auth/spreadsheets.readonly']);
  const range = encodeURIComponent(GOOGLE_SHEETS_EVENTS_RANGE);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_ID}/values/${range}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sheets API error (${response.status}): ${text}`);
  }

  const data = await response.json();
  const rows = Array.isArray(data.values) ? data.values : [];
  const events = rows
    .map((row) => {
      const eventName = (row[0] || '').trim();
      const rawBudget = (row[1] || '').toString().trim();
      const normalizedBudget = rawBudget
        .replace(/[^0-9.,-]/g, '')
        .replace(/(,)(?=[^,]*,)/g, '')
        .replace(/,/g, '.');
      const parsedBudget = Number.parseFloat(normalizedBudget);
      return {
        id: eventName,
        name: eventName,
        budget: Number.isFinite(parsedBudget) ? parsedBudget : null,
        rawBudget,
      };
    })
    .filter((event) => event.id);

  eventsCache = { events, timestamp: now };
  return events;
}

async function fetchEventAccumulated(eventName) {
  if (!eventName) {
    return 0;
  }

  if (USE_MOCK_DATA) {
    return mockRecords
      .filter((record) => record.eventName === eventName)
      .reduce((sum, record) => sum + (Number.isFinite(record.amount) ? record.amount : 0), 0);
  }

  const token = await getAccessToken(['https://www.googleapis.com/auth/spreadsheets.readonly']);
  const range = encodeURIComponent(GOOGLE_SHEETS_LOG_RANGE);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_ID}/values/${range}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sheets API error (${response.status}): ${text}`);
  }

  const data = await response.json();
  const rows = Array.isArray(data.values) ? data.values : [];
  return rows.reduce((sum, row) => {
    if (!Array.isArray(row) || !row.length) {
      return sum;
    }
    const name = (row[0] || '').trim();
    if (!name || name !== eventName) {
      return sum;
    }
    const parsed = parseAmount(row[2]);
    return sum + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);
}

async function uploadToDrive({ buffer, originalName, mimeType }) {
  const safeName = buildSafeFileName(originalName, mimeType);

  if (USE_MOCK_DATA) {
    await fsPromises.mkdir(MOCK_UPLOADS_DIR, { recursive: true });
    const filePath = path.join(MOCK_UPLOADS_DIR, safeName);
    await fsPromises.writeFile(filePath, buffer);
    const publicPath = `/mock/${encodeURIComponent(safeName)}`;
    return {
      id: safeName,
      name: safeName,
      webViewLink: publicPath,
      webContentLink: publicPath,
      localPath: filePath,
    };
  }

  const token = await getAccessToken([
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets',
  ]);

  const metadata = {
    name: safeName,
    parents: GOOGLE_DRIVE_FOLDER_ID ? [GOOGLE_DRIVE_FOLDER_ID] : undefined,
  };

  const boundary = `boundary-${crypto.randomUUID()}`;
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
  );
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([preamble, fileHeader, buffer, closing]);

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`No se pudo subir el archivo a Google Drive (${response.status}): ${text}`);
  }

  return response.json();
}

function parseAmount(value) {
  if (typeof value === 'number') {
    return value;
  }
  if (!value) {
    return NaN;
  }
  const normalized = value
    .toString()
    .trim()
    .replace(/[^0-9.,-]/g, '')
    .replace(/(,)(?=[^,]*,)/g, '')
    .replace(/,/g, '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

async function appendToSheet({ eventName, concept, amount, driveFile }) {
  if (USE_MOCK_DATA) {
    mockRecords.push({ eventName, concept, amount, driveFile });
    return { updatedRange: 'mock' };
  }
  const token = await getAccessToken([
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets',
  ]);

  const values = [
    [
      eventName,
      concept,
      amount,
      driveFile.webViewLink || driveFile.id || '',
    ],
  ];

  const range = encodeURIComponent(GOOGLE_SHEETS_LOG_RANGE);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ values }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`No se pudo registrar la fila en Google Sheets (${response.status}): ${text}`);
  }

  return response.json();
}

function evaluateImageConsistency(amount, fileName) {
  const digits = (fileName || '').replace(/[^0-9]/g, '');
  if (digits && digits.includes(Math.round(amount).toString())) {
    return {
      status: 'Validado automáticamente',
      message: 'El nombre del archivo coincide con el monto ingresado.',
    };
  }

  if (amount < 100) {
    return {
      status: 'Validado',
      message: 'Montos menores a 100 se aprueban automáticamente.',
    };
  }

  return {
    status: 'Revisión manual',
    message: 'No se encontró coincidencia, se marcará para revisión manual.',
  };
}

function buildBudgetStatus({ budget, totalSpent }) {
  if (!Number.isFinite(budget)) {
    return {
      message: 'No hay un presupuesto configurado para este evento.',
      budget: null,
      totalSpent,
      remaining: null,
      exceeded: null,
    };
  }

  const difference = budget - totalSpent;
  if (difference >= 0) {
    return {
      message: `Aún tienes $${difference.toFixed(2)} de ppto disponible.`,
      budget,
      totalSpent,
      remaining: difference,
      exceeded: 0,
    };
  }

  const exceeded = Math.abs(difference);
  return {
    message: `Has superado el ppto en $${exceeded.toFixed(2)}.`,
    budget,
    totalSpent,
    remaining: 0,
    exceeded,
  };
}

function buildSafeFileName(originalName, mimeType) {
  const extension = path.extname(originalName) || '';
  const baseName = path.basename(originalName, extension);
  const safeBase = baseName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const finalExt = extension || guessExtensionFromMime(mimeType);
  return `${timestamp}_${safeBase || 'comprobante'}${finalExt}`;
}

function guessExtensionFromMime(nameOrMime = '') {
  if (nameOrMime.includes('png')) return '.png';
  if (nameOrMime.includes('jpeg') || nameOrMime.includes('jpg')) return '.jpg';
  if (nameOrMime.includes('heic')) return '.heic';
  return '.dat';
}

async function getAccessToken(scopes) {
  const orderedScopes = [...new Set(scopes)].sort();
  const cacheKey = orderedScopes.join(' ');
  const cached = tokenCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiry > now + 60 * 1000) {
    return cached.token;
  }

  if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error('Faltan credenciales de Google.');
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const claimSet = {
    iss: GOOGLE_CLIENT_EMAIL,
    scope: orderedScopes.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp,
    iat,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedClaimSet = base64url(JSON.stringify(claimSet));
  const toSign = `${encodedHeader}.${encodedClaimSet}`;
  const signature = crypto.createSign('RSA-SHA256').update(toSign).sign(GOOGLE_PRIVATE_KEY, 'base64');
  const signedJwt = `${toSign}.${base64ToBase64Url(signature)}`;

  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: signedJwt,
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`No se pudo obtener el token de acceso (${response.status}): ${text}`);
  }

  const data = await response.json();
  const token = data.access_token;
  const expiresInMs = Number.parseInt(data.expires_in, 10) * 1000;

  tokenCache.set(cacheKey, { token, expiry: now + expiresInMs });
  return token;
}

function base64url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64ToBase64Url(base64) {
  return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
