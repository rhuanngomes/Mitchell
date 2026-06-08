/* ============================================================
   MITCHELL — integration layer  v3
   Conecta: proxy.js → detection.js → dashboard (MITCHELL.html)

   Ordem de carregamento no HTML:
     satellite.min.js → detection.js → globe.js
     → mitchell-integration.js → dashboard.js
   ============================================================ */

(function () {

  // Configurações de integração e parâmetros do mock/API
  const CONFIG = {
    norad:        '54776',  // NORAD ID do objeto alvo (CAS-7B)
    days:         30,       // janela de histórico em dias
    thresholdKm:  25,       // limiar de detecção de manobra em km
    pollInterval: 60_000,   // intervalo de atualização em ms
    apiBase:      '',       // base da API, vazio = mesmo origin do proxy
    mockMode:     true,     // se true, usa TLE de mock em vez de chamada real

    sigmaBaseKm:  25,       // base de desvio para conversão em sigma
    sigmaBase:    3.4,      // valor sigma correspondente à base de 25 km
  };

  // Texto TLE de exemplo usado quando mockMode está ativo
  const MOCK_TLE_TEXT = `
1 54776U 23124B   24159.00000000  .00022635  00000+0  12477-2 0  9993
2 54776  97.5628 288.7068 0012750  64.0536  26.1183 15.19836918  3771
1 54776U 23124B   24158.95000000  .00022640  00000+0  12480-2 0  9994
2 54776  97.5625 288.7089 0012751  64.0532  26.1189 15.19837419  3760
1 54776U 23124B   24158.90000000  .00022645  00000+0  12483-2 0  9995
2 54776  97.5623 288.7109 0012752  64.0529  26.1194 15.19837920  3750
1 54776U 23124B   24158.85000000  .00022650  00000+0  12486-2 0  9996
2 54776  97.5621 288.7129 0012753  64.0526  26.1199 15.19838421  3740
1 54776U 23124B   24158.80000000  .00022655  00000+0  12489-2 0  9997
2 54776  97.5618 288.7149 0012754  64.0523  26.1204 15.19838922  3730
1 54776U 23124B   24158.75000000  .00022660  00000+0  12492-2 0  9998
2 54776  97.5616 288.7169 0012755  64.0520  26.1209 15.19839423  3720
1 54776U 23124B   24158.70000000  .00022665  00000+0  12495-2 0  9999
2 54776  97.5613 288.7190 0012756  64.0517  26.1215 15.19839924  3711
1 54776U 23124B   24158.65000000  .00022670  00000+0  12498-2 0  9990
2 54776  97.5611 288.7210 0012757  64.0514  26.1220 15.19840425  3701
1 54776U 23124B   24158.60000000  .00022675  00000+0  12501-2 0  9991
2 54776  97.5608 288.7230 0012758  64.0511  26.1225 15.19840926  3691
1 54776U 23124B   24158.55000000  .00022680  00000+0  12504-2 0  9992
2 54776  97.5605 288.7260 0012759  64.0508  26.1230 15.19841427  3681
`;

  const state = {
    tlePairs:   [],   // pares TLE analisados [linha1, linha2]
    lastResult: null, // resultado da detecção de manobra
    lastFetch:  null, // timestamp da última chamada de API/mock
    lastRawTle: '',   // texto TLE original recebido da API/mock
    data:       null, // objeto de dados estruturados exposto ao front-end
    loading:    false,// flag de carregamento para evitar chamadas concorrentes
  };

  /* ------------------------------------------------------------------
     1. PARSEAR TEXTO TLE → array de pares ["linha1", "linha2"]
     ------------------------------------------------------------------ */
  function parseTleText(raw) {
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const pairs = [];
    let i = 0;
    while (i < lines.length) {
      if (!lines[i].startsWith('1 ') && !lines[i].startsWith('2 ')) { i++; continue; }
      if (lines[i].startsWith('1 ') && i + 1 < lines.length && lines[i + 1].startsWith('2 ')) {
        pairs.push([lines[i], lines[i + 1]]);
        i += 2;
      } else { i++; }
    }
    return pairs;
  }

  /* ------------------------------------------------------------------
     2. BUSCAR TLE DO PROXY
     ------------------------------------------------------------------ */
  async function fetchTle() {
    if (CONFIG.mockMode) {
      console.info('[Mitchell] Mock mode ativado — usando TLE fake');
      state.lastRawTle = MOCK_TLE_TEXT;
      return parseTleText(MOCK_TLE_TEXT);
    }

    const url = `${CONFIG.apiBase}/api/spacetrack/tle?norad=${CONFIG.norad}&days=${CONFIG.days}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
    const text = await res.text();
    if (!text || text.trim().length === 0) throw new Error('Proxy retornou resposta vazia');
    state.lastRawTle = text;
    return parseTleText(text);
  }

  /* ------------------------------------------------------------------
     3. DETECÇÃO DE MANOBRA (detection.js do Leo)
     ------------------------------------------------------------------ */
  function runDetection(pairs) {
    if (!window.MitchellDetector) {
      console.warn('[Mitchell] detection.js não carregado.');
      return null;
    }
    if (pairs.length < 2) {
      console.warn('[Mitchell] Menos de 2 TLEs — impossível detectar manobra.');
      return null;
    }
    try {
      return window.MitchellDetector.detectManeuver(
        pairs[pairs.length - 2],
        pairs[pairs.length - 1],
        { thresholdKm: CONFIG.thresholdKm }
      );
    } catch (e) {
      console.error('[Mitchell] Erro na detecção:', e.message);
      return null;
    }
  }

  /* ------------------------------------------------------------------
     4. HELPERS
     ------------------------------------------------------------------ */
  function toSigma(km)       { return (km / CONFIG.sigmaBaseKm) * CONFIG.sigmaBase; }
  function approachScore(s)  { return Math.min(100, Math.round((s / 5) * 100)); }
  function fmtDate(d)        { return (d instanceof Date && !isNaN(d)) ? d.toISOString().replace('T',' ').slice(0,19) + ' UTC' : '—'; }

  function coverage(pairs) {
    if (!pairs.length) return 0;
    return Math.min(99, Math.round((pairs.length / (CONFIG.days * 2)) * 100));
  }

  function epochFromLine1(line) {
    const yy  = parseInt(line.slice(18, 20), 10);
    const day = parseFloat(line.slice(20, 32));
    const yr  = yy < 57 ? 2000 + yy : 1900 + yy;
    const d   = new Date(Date.UTC(yr, 0, 1));
    d.setTime(d.getTime() + (day - 1) * 86400000);
    return d;
  }

  function latestTlePair(pairs) {
    return pairs.length ? pairs[pairs.length - 1] : null;
  }

  function oldestTlePair(pairs) {
    return pairs.length ? pairs[0] : null;
  }

  function line2AltitudeKm(line2) {
    if (!line2) return null;
    const mm = parseFloat(line2.slice(52, 63));
    if (Number.isNaN(mm)) return null;
    const n   = (mm * 2 * Math.PI) / 86400;
    const mu  = 398600.4418;
    return Math.round((Math.cbrt(mu / (n * n)) - 6371) * 10) / 10;
  }

  function leadTimeMinutes(pairs) {
    if (pairs.length < 2) return null;
    const oldest = epochFromLine1(pairs[0][0]);
    const newest = epochFromLine1(pairs[pairs.length - 1][0]);
    return Math.round((newest - oldest) / 60000);
  }

  function buildData(pairs, result) {
    const latestPair = latestTlePair(pairs);
    const oldestPair = oldestTlePair(pairs);
    const latestEpoch = latestPair ? epochFromLine1(latestPair[0]) : null;
    const oldestEpoch = oldestPair ? epochFromLine1(oldestPair[0]) : null;
    const altitudeKm = latestPair ? line2AltitudeKm(latestPair[1]) : null;
    const sigma = result ? toSigma(result.deviationKm) : CONFIG.sigmaBase;
    const score = approachScore(sigma);

    return {
      request: {
        norad: CONFIG.norad,                 // ID NORAD consultado
        days: CONFIG.days,                   // janela temporal usada na API
        apiBase: CONFIG.apiBase,             // base da API proxy
        mockMode: CONFIG.mockMode,           // modo mock ativado/desativado
        url: CONFIG.mockMode
          ? 'mock://local'
          : `${CONFIG.apiBase}/api/spacetrack/tle?norad=${CONFIG.norad}&days=${CONFIG.days}`,
      },
      raw: {
        tleText: state.lastRawTle,           // texto TLE original retornado pela API/mock
      },
      parsed: {
        tleCount: pairs.length,              // número de pares TLE parseados
        tlePairs: pairs,                     // pares TLE completos
        latestTle: latestPair ? { line1: latestPair[0], line2: latestPair[1] } : null,
        oldestTle: oldestPair ? { line1: oldestPair[0], line2: oldestPair[1] } : null,
      },
      metrics: {
        coveragePct: coverage(pairs),         // cobertura de amostra do histórico
        altitudeKm,                          // altitude derivada do último TLE
        leadTimeMin: leadTimeMinutes(pairs), // intervalo entre o TLE mais antigo e o mais recente
        riskScorePct: score,                 // pontuação de proximidade/risco
        deviationKm: result ? result.deviationKm : null, // desvio residual em km
        deviationSigma: sigma,               // desvio convertido em sigma
        maneuverDetected: result ? Boolean(result.detected) : false, // flag de manobra detectada
      },
      time: {
        lastFetch: state.lastFetch,          // última hora de fetch
        latestEpoch,                         // epoch do último par TLE
        oldestEpoch,                         // epoch do primeiro par TLE
        lastManeuverEpoch: result ? result.observedEpoch : null, // epoch da última manobra detectada
      },
      formatted: {
        latestEpoch: latestEpoch ? latestEpoch.toISOString() : null, // último epoch formatado
        oldestEpoch: oldestEpoch ? oldestEpoch.toISOString() : null, // primeiro epoch formatado
        lastManeuver: result && result.observedEpoch ? fmtDate(result.observedEpoch) : '—', // string pronta para exibir
      },
    };
  }

  /* ------------------------------------------------------------------
     5. ATUALIZAR ELEMENTOS DO FRONT
     ------------------------------------------------------------------ */

  // Painel 01 — altitude derivada do mean motion (linha 2, col 52-63)
  function updateAltitude(line2) {
    const el = document.getElementById('kv-alt');
    if (!el || !line2) return;
    try {
      const mm  = parseFloat(line2.slice(52, 63));   // rev/dia
      const n   = (mm * 2 * Math.PI) / 86400;        // rad/s
      const mu  = 398600.4418;                        // km³/s²
      const alt = (Math.cbrt(mu / (n * n)) - 6371).toFixed(1);
      el.innerHTML = `${alt}<small>KM</small>`;
    } catch (_) {}
  }

  // Painel 01 — timestamp da última manobra detectada
  function updateLastManeuver(epoch) {
    const el = document.getElementById('kv-man');
    if (el) el.textContent = fmtDate(epoch);
  }

  // Painel 01 — contagem de TLEs no histórico
  function updateObjCount(n) {
    const el = document.getElementById('obj-count');
    if (el) el.textContent = `${n} TRACKED`;
  }

  // Painel 02 — lead time (span entre TLE mais antigo e mais recente)
  function updateLeadTime(pairs) {
    const el = document.getElementById('anticip');
    if (!el || pairs.length < 2) return;
    try {
      const oldest = epochFromLine1(pairs[0][0]);
      const newest = epochFromLine1(pairs[pairs.length - 1][0]);
      const mins   = Math.round((newest - oldest) / 60000);
      const h = Math.floor(mins / 60), m = mins % 60;
      el.innerHTML = h > 0
        ? `${h}<small>h</small>${m}<small>m</small>`
        : `${m}<small>min</small>`;
    } catch (_) {}
  }

  // Barras de progresso genéricas
  function setBar(fillId, valId, value, unit, max) {
    const fill = document.getElementById(fillId);
    const val  = document.getElementById(valId);
    if (!fill || !val) return;
    fill.style.width = Math.min(100, Math.max(0, (value / max) * 100)) + '%';
    val.textContent  = unit === 'σ' ? value.toFixed(1) + unit : Math.round(value) + unit;
  }

  /* ------------------------------------------------------------------
     6. INJETAR ALERTAS NO FEED
     ------------------------------------------------------------------ */
  function addFeedAlert(sev, label, msg) {
    const feed    = document.getElementById('feed');
    const countEl = document.getElementById('feed-count');
    if (!feed) return;

    const d  = new Date();
    const p  = n => String(n).padStart(2, '0');
    const ts = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;

    const el = document.createElement('div');
    el.className = `alert ${sev}`;
    el.innerHTML =
      `<div class="a-top"><span class="a-sev">${label}</span>` +
      `<span class="a-ts">${ts} UTC</span></div>` +
      `<div class="a-msg">${msg}</div>`;
    feed.prepend(el);

    if (countEl) {
      const cur = parseInt(countEl.textContent) || 0;
      countEl.textContent = `${cur + 1} events`;
    }
    while (feed.children.length > 26) feed.removeChild(feed.lastChild);
  }

  /* ------------------------------------------------------------------
     7. PUBLICAR TODOS OS DADOS NO FRONT
     ------------------------------------------------------------------ */
  function publish(pairs, result) {
    const pct   = coverage(pairs);
    const sigma = result ? toSigma(result.deviationKm) : CONFIG.sigmaBase;
    const score = approachScore(sigma);

    // Painel 01
    if (pairs.length > 0) updateAltitude(pairs[pairs.length - 1][1]);
    if (result && result.detected) updateLastManeuver(result.observedEpoch);
    updateObjCount(pairs.length);

    // Painel 02
    updateLeadTime(pairs);
    setBar('f-conf', 'v-conf', pct,   '%', 100);
    setBar('f-risk', 'v-risk', score, '%', 100);
    setBar('f-dev',  'v-dev',  sigma, 'σ', 5);

    // Expõe para dashboard.js e para o front-end que precisa imprimir dados
    state.data = buildData(pairs, result); // estrutura de dados pronta para renderização
    window.MITCHELL             = window.MITCHELL || {};
    window.MITCHELL.data          = state.data;      // dados de API e métricas acessíveis globalmente
    window.MITCHELL.detectionResult = result;        // resultado bruto da detecção de manobra
    window.MITCHELL.lastFetch       = state.lastFetch; // timestamp do último fetch

    // Feed
    if (result) {
      if (result.detected) {
        addFeedAlert('red', 'WATCH',
          `Manobra detectada · <b>CAS-7B</b> · desvio <b>${result.deviationKm.toFixed(2)} km</b> · ${sigma.toFixed(1)}σ`);
      } else {
        addFeedAlert('blue', 'INFO',
          `TLE atualizado · CAS-7B nominal · desvio <b>${result.deviationKm.toFixed(2)} km</b> (${sigma.toFixed(1)}σ)`);
      }
    }

    console.info(`[Mitchell] ✓ ${pairs.length} TLEs · cobertura ${pct}% · desvio ${result ? result.deviationKm.toFixed(2) + ' km' : 'N/A'} · ${sigma.toFixed(1)}σ`);
  }

  /* ------------------------------------------------------------------
     8. CICLO DE POLL
     ------------------------------------------------------------------ */
  async function poll() {
    if (state.loading) return;
    state.loading = true;
    try {
      const pairs      = await fetchTle();
      state.tlePairs   = pairs;
      state.lastFetch  = new Date();
      const result     = runDetection(pairs);
      state.lastResult = result;
      publish(pairs, result);
    } catch (e) {
      console.error('[Mitchell] Falha no ciclo:', e.message);
      addFeedAlert('amber', 'WARN', `Falha ao buscar TLEs: ${e.message}`);
    } finally {
      state.loading = false;
    }
  }

  /* ------------------------------------------------------------------
     9. API PÚBLICA
     ------------------------------------------------------------------ */
  window.MITCHELL = window.MITCHELL || {};
  window.MITCHELL.integration = {
    refresh:      poll,                 // atualiza os dados imediatamente
    getState:     () => ({ ...state }), // estado interno bruto da integração
    getData:      () => state.data,     // dados estruturados prontos para o frontend
    parseTleText,                       // utilitário para parsear texto TLE
    config:       CONFIG,               // configurações e opções ativas
  };

  /* ------------------------------------------------------------------
     INICIALIZAÇÃO
     ------------------------------------------------------------------ */
  function init() {
    poll();
    setInterval(poll, CONFIG.pollInterval);
    console.info('[Mitchell] Integration layer v3 · NORAD', CONFIG.norad);
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();

})();