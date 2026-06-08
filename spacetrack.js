import { CONFIG } from './config.js';

// NORAD ID identificado como CAS-7B em referências públicas (44443).
// Se o time confirmar outro ID, atualize esta constante.
export const CAS7_NORAD_ID = 44443;

function buildProxyUrl(targetUrl) {
  return `${CONFIG.PROXY_BASE_URL}?url=${encodeURIComponent(targetUrl)}`;
}

export async function authenticateSpaceTrack(identity, password) {
  try {
    console.log('Iniciando autenticação no Space-Track (via proxy)...');

    const target = `${CONFIG.SPACETRACK_BASE_URL}/ajaxauth/login`;
    const proxyUrl = buildProxyUrl(target);

    const body = new URLSearchParams({ identity, password }).toString();

    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      credentials: 'include',
    });

    console.log('Request de login enviado ao proxy. Status:', res.status);

    if (res.status === 401) {
      throw new Error('Falha na autenticação: credenciais inválidas');
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Falha na autenticação: ${res.status} ${text}`);
    }

    // Considerar sucesso se o proxy retornou ok. Space-Track normalmente devolve 200.
    console.log('Autenticação bem-sucedida (proxy retornou OK).');
    return true;
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error('Proxy offline. Verifique se o servidor local está rodando.');
    }
    throw err;
  }
}

export async function fetchCAS7TLEHistory(startDate, endDate) {
  const sDate = startDate || CONFIG.DEFAULT_START_DATE;
  const eDate = endDate || CONFIG.DEFAULT_END_DATE;

  try {
    console.log('Buscando TLEs históricos do CAS-7 no Space-Track (via proxy)...');

    const endpoint = `${CONFIG.SPACETRACK_BASE_URL}/basicspacedata/query/class/gp_history/NORAD_CAT_ID/${CAS7_NORAD_ID}/orderby/EPOCH asc/EPOCH/${sDate}--${eDate}/format/json`;
    const proxyUrl = buildProxyUrl(endpoint);

    console.log('Requisição GET enviada ao proxy para:', endpoint);

    const res = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      credentials: 'include',
    });

    if (res.status === 401) {
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Falha na requisição: ${res.status} ${text}`);
    }

    const data = await res.json().catch(() => null);

    if (!Array.isArray(data)) {
      throw new Error('Resposta inesperada do Space-Track.');
    }

    if (data.length === 0) {
      throw new Error('Nenhum TLE encontrado para o CAS-7 no intervalo informado.');
    }

    console.log(`Quantidade de TLEs recebidos: ${data.length}`);

    const parsed = data.map((raw) => {
      // EPOCH pode vir no formato 'YYYY-MM-DDTHH:MM:SS' ou 'YYYY-MM-DD HH:MM:SS'
      const epochStr = raw.EPOCH ? String(raw.EPOCH).replace(' ', 'T') : null;
      const epoch = epochStr ? new Date(epochStr) : new Date(NaN);

      return {
        epoch,
        line1: raw.TLE_LINE1 || raw.tle_line1 || '',
        line2: raw.TLE_LINE2 || raw.tle_line2 || '',
        noradId: Number(raw.NORAD_CAT_ID) || Number(raw.norad_cat_id) || CAS7_NORAD_ID,
        raw,
      };
    });

    parsed.sort((a, b) => a.epoch - b.epoch);

    return parsed;
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error('Proxy offline. Verifique se o servidor local está rodando.');
    }
    throw err;
  }
}
