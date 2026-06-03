const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const SPACE_TRACK_LOGIN = 'https://www.space-track.org/ajaxauth/login';
const SPACE_TRACK_QUERY = 'https://www.space-track.org/basicspacedata/query';

let authCookie = '';

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

async function loginSpaceTrack() {
  if (authCookie) return authCookie;

  const identity = process.env.SPACE_TRACK_IDENTITY;
  const password = process.env.SPACE_TRACK_PASSWORD;

  if (!identity || !password) {
    throw new Error('Defina SPACE_TRACK_IDENTITY e SPACE_TRACK_PASSWORD antes de iniciar o proxy.');
  }

  const body = new URLSearchParams({ identity, password });
  const response = await fetch(SPACE_TRACK_LOGIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Falha no login do Space-Track: HTTP ${response.status}`);
  }

  const cookies = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);

  authCookie = cookies.map(cookie => cookie.split(';')[0]).join('; ');
  return authCookie;
}

async function fetchTleHistory(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const norad = url.searchParams.get('norad') || '54776';
  const days = Number(url.searchParams.get('days') || 30);

  if (!/^\d{1,8}$/.test(norad) || !Number.isInteger(days) || days < 1 || days > 90) {
    send(res, 400, JSON.stringify({ error: 'Use norad numérico e days entre 1 e 90.' }));
    return;
  }

  const cookie = await loginSpaceTrack();
  const queryUrl =
    `${SPACE_TRACK_QUERY}/class/gp_history/NORAD_CAT_ID/${norad}` +
    `/EPOCH/%3Enow-${days}/orderby/EPOCH%20asc/format/tle`;

  const response = await fetch(queryUrl, { headers: { Cookie: cookie } });

  if (response.status === 401 || response.status === 403) {
    authCookie = '';
  }

  const text = await response.text();
  send(res, response.status, text, response.headers.get('content-type') || 'text/plain');
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === '/' ? '/MITCHELL.html' : url.pathname;
  const filePath = path.normalize(path.join(ROOT, requested));

  if (!filePath.startsWith(ROOT)) {
    send(res, 403, 'Forbidden', 'text/plain');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, 'Not found', 'text/plain');
      return;
    }

    const ext = path.extname(filePath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
    };

    send(res, 200, data, types[ext] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      send(res, 204, '');
      return;
    }

    if (req.url.startsWith('/api/spacetrack/tle')) {
      await fetchTleHistory(req, res);
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    send(res, 500, JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Mitchell proxy: http://${HOST}:${PORT}`);
  console.log('TLE endpoint: /api/spacetrack/tle?norad=54776&days=30');
});
