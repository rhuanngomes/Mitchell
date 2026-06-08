require('dotenv').config();

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const SPACE_TRACK_LOGIN = 'https://www.space-track.org/ajaxauth/login';
const SPACE_TRACK_QUERY = 'https://www.space-track.org/basicspacedata/query';

let authCookie = '';

/* ---------- diagnóstico de credenciais ---------- */
const IDENTITY = process.env.SPACE_TRACK_IDENTITY;
const PASSWORD = process.env.SPACE_TRACK_PASSWORD;

if (!IDENTITY || !PASSWORD) {
  console.error('[Mitchell] ERRO: credenciais não encontradas.');
  console.error('  Verifique se o arquivo .env existe na mesma pasta que proxy.js');
  console.error('  e contém SPACE_TRACK_IDENTITY e SPACE_TRACK_PASSWORD.');
  process.exit(1);
}
console.log(`[Mitchell] Credenciais carregadas para: ${IDENTITY}`);

/* ---------- helpers ---------- */
function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

async function loginSpaceTrack() {
  if (authCookie) return authCookie;

  const body = new URLSearchParams({ identity: IDENTITY, password: PASSWORD });
  const response = await fetch(SPACE_TRACK_LOGIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Falha no login Space-Track: HTTP ${response.status}`);
  }

  const cookies = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);

  authCookie = cookies.map(c => c.split(';')[0]).join('; ');
  console.log('[Mitchell] Login Space-Track OK.');
  return authCookie;
}

/* ---------- rota: TLE histórico (usado pelo mitchell-integration.js) ---------- */
async function handleTleHistory(req, res) {
  const url   = new URL(req.url, `http://${req.headers.host}`);
  const norad = url.searchParams.get('norad') || '54776';
  const days  = Number(url.searchParams.get('days') || 30);

  if (!/^\d{1,8}$/.test(norad) || !Number.isInteger(days) || days < 1 || days > 90) {
    send(res, 400, JSON.stringify({ error: 'norad deve ser numérico e days entre 1 e 90.' }));
    return;
  }

  const cookie   = await loginSpaceTrack();
  const queryUrl = `${SPACE_TRACK_QUERY}/class/gp_history/NORAD_CAT_ID/${norad}` +
                   `/EPOCH/%3Enow-${days}/orderby/EPOCH%20asc/format/tle`;

  const response = await fetch(queryUrl, { headers: { Cookie: cookie } });

  if (response.status === 401 || response.status === 403) {
    authCookie = ''; // força re-login na próxima chamada
  }

  const text = await response.text();
  send(res, response.status, text, response.headers.get('content-type') || 'text/plain');
}

/* ---------- rota: proxy genérico (usado pelo spacetrack.js do Leo) ---------- */
async function handleGenericProxy(req, res) {
  const url       = new URL(req.url, `http://${req.headers.host}`);
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl || !targetUrl.startsWith('https://www.space-track.org')) {
    send(res, 400, JSON.stringify({ error: 'Parâmetro url inválido ou não permitido.' }));
    return;
  }

  const cookie = await loginSpaceTrack();

  const isPost = req.method === 'POST';
  let reqBody  = '';

  if (isPost) {
    reqBody = await new Promise(resolve => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
    });
  }

  const fetchOpts = {
    method:  isPost ? 'POST' : 'GET',
    headers: {
      Cookie: cookie,
      ...(isPost ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(isPost && reqBody ? { body: reqBody } : {}),
  };

  const response = await fetch(targetUrl, fetchOpts);

  if (response.status === 401 || response.status === 403) {
    authCookie = '';
  }

  const text = await response.text();
  send(res, response.status, text, response.headers.get('content-type') || 'text/plain');
}

/* ---------- rota: arquivos estáticos ---------- */
function serveStatic(req, res) {
  const url       = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === '/' ? '/MITCHELL.html' : url.pathname;
  const filePath  = path.normalize(path.join(ROOT, requested));

  if (!filePath.startsWith(ROOT)) {
    send(res, 403, 'Forbidden', 'text/plain');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { send(res, 404, 'Not found', 'text/plain'); return; }
    const ext   = path.extname(filePath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js':   'application/javascript; charset=utf-8',
      '.css':  'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.jpg':  'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png':  'image/png',
    };
    send(res, 200, data, types[ext] || 'application/octet-stream');
  });
}

/* ---------- servidor ---------- */
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { send(res, 204, ''); return; }

    if (req.url.startsWith('/api/spacetrack/tle')) {
      await handleTleHistory(req, res);
      return;
    }

    if (req.url.startsWith('/proxy')) {
      await handleGenericProxy(req, res);
      return;
    }

    serveStatic(req, res);
  } catch (err) {
    console.error('[Mitchell] Erro interno:', err.message);
    send(res, 500, JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[Mitchell] Proxy rodando em http://${HOST}:${PORT}`);
  console.log(`[Mitchell] TLE endpoint: /api/spacetrack/tle?norad=54776&days=30`);
});
