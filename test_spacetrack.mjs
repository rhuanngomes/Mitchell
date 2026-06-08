import { authenticateSpaceTrack, fetchCAS7TLEHistory } from './spacetrack.js';

function makeMockFetch(scenario) {
  return async (url, opts = {}) => {
    try {
      const u = new URL(url);
      const target = u.searchParams.get('url') ? decodeURIComponent(u.searchParams.get('url')) : url;

      // Login endpoint
      if (target.includes('/ajaxauth/login')) {
        return {
          status: 200,
          ok: true,
          text: async () => 'OK',
        };
      }

      // TLE history endpoint
      if (target.includes('/basicspacedata/query/class/gp_history')) {
        if (scenario === '401') {
          return { status: 401, ok: false, text: async () => 'Unauthorized' };
        }

        const data = [
          { EPOCH: '2025-12-15 12:00:00', TLE_LINE1: '1 44443U 19042C   25349.50000000  .00000123  00000-0  10000-4 0  9991', TLE_LINE2: '2 44443  97.0000 100.0000 0012345 200.0000 160.0000 15.00000000 12345', NORAD_CAT_ID: '44443' },
          { EPOCH: '2025-11-01 00:00:00', TLE_LINE1: '1 44443U 19042C   25301.00000000  .00000123  00000-0  10000-4 0  9992', TLE_LINE2: '2 44443  97.0000 100.0000 0012345 200.0000 160.0000 15.00000000 12346', NORAD_CAT_ID: '44443' },
        ];

        return {
          status: 200,
          ok: true,
          json: async () => data,
        };
      }

      return { status: 404, ok: false, text: async () => 'Not Found' };
    } catch (e) {
      return { status: 500, ok: false, text: async () => 'Error' };
    }
  };
}

async function run() {
  console.log('=== test_spacetrack: começando testes ===');

  // Mock fetch: success path
  global.fetch = makeMockFetch('ok');

  try {
    const auth = await authenticateSpaceTrack('test@example.com', 'password');
    if (auth !== true) throw new Error('authenticateSpaceTrack não retornou true');
    console.log('Auth: OK');
  } catch (e) {
    console.error('Auth: Falhou', e);
    process.exit(1);
  }

  try {
    const tles = await fetchCAS7TLEHistory();
    if (!Array.isArray(tles) || tles.length !== 2) throw new Error('fetchCAS7TLEHistory retornou tamanho inesperado');

    if (!(tles[0].epoch instanceof Date)) throw new Error('epoch não é Date');
    if (tles[0].epoch > tles[1].epoch) throw new Error('TLEs não estão ordenados por epoch crescente');

    console.log('Fetch TLEs: OK —', tles.map(t => t.epoch.toISOString()));
  } catch (e) {
    console.error('Fetch TLEs: Falhou', e);
    process.exit(1);
  }

  // Mock fetch: 401 session expired
  global.fetch = makeMockFetch('401');

  try {
    await fetchCAS7TLEHistory();
    console.error('Fetch TLEs (401): esperado erro, mas não ocorreu');
    process.exit(1);
  } catch (e) {
    if (String(e).includes('Sessão expirada')) {
      console.log('Fetch TLEs (401): erro esperado recebido:', e.message || e);
    } else {
      console.error('Fetch TLEs (401): erro inesperado:', e);
      process.exit(1);
    }
  }

  console.log('=== test_spacetrack: todos os testes passaram ===');
}

run();
