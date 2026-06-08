/* ============================================================
   MITCHELL — integration layer  v2
   Conecta: proxy.js (TLE fetch) → detection.js → todos os
   elementos do dashboard (MITCHELL.html)

   Ordem de carregamento no HTML:
     detection.js  →  globe.js  →  mitchell-integration.js  →  dashboard.js
   ============================================================ */

(function () {

  /* ------------------------------------------------------------------
     CONFIGURAÇÃO
     ------------------------------------------------------------------ */
  const CONFIG = {
    norad:         '54776',   // CAS-7B
    days:          30,        // janela de histórico TLE
    thresholdKm:   25,        // limiar detecção de manobra (km)
    pollInterval:  60_000,    // re-busca a cada 60 s
    apiBase:       '',        // vazio = mesmo origin (proxy.js local)

    // Calibração sigma: 25 km de desvio = 3.4σ (baseline do projeto)
    sigmaBaseKm:   25,
    sigmaBase:     3.4,
  };

  /* ------------------------------------------------------------------
     ESTADO INTERNO
     ------------------------------------------------------------------ */
  const state = {
    tlePairs:    [],   // [["1 ...", "2 ..."], ...]
    lastResult:  null, // último detectManeuver()
    lastFetch:   null, // Date do último fetch OK
    loading:     false,
  };

  /* ------------------------------------------------------------------
     1. PARSEAR TEXTO TLE → array de pares
     Suporta formato com e sem linha de nome do satélite.
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
     2. BUSCAR TLE DO PROXY (proxy.js)
     ------------------------------------------------------------------ */
  async function fetchTle() {
    const url = `${CONFIG.apiBase}/api/spacetrack/tle?norad=${CONFIG.norad}&days=${CONFIG.days}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
    return parseTleText(await res.text());
  }

  /* ------------------------------------------------------------------
     3. RODAR DETECÇÃO (detection.js do Leo)
     Usa os dois TLEs mais recentes do histórico.
     ------------------------------------------------------------------ */
  function runDetection(pairs) {
    if (!window.MitchellDetector) {
      console.warn('[Mitchell] detection.js não carregado ainda.');
      return null;
    }
    if (pairs.length < 2) {
      console.warn('[Mitchell] Histórico insuficiente (< 2 TLEs).');
      return null;
    }
    const prev = pairs[pairs.length - 2];
    const obs  = pairs[pairs.length - 1];
    try {
      return window.MitchellDetector.detectManeuver(prev, obs, { thresholdKm: CONFIG.thresholdKm });
    } catch (e) {
      console.error('[Mitchell] Erro na detecção:', e.message);
      return null;
    }
  }

  /* ------------------------------------------------------------------
     4. HELPERS DE CÁLCULO
     ------------------------------------------------------------------ */

  // km → sigma (calibrado: 25 km = 3.4σ)
  function toSigma(km) {
    return (km / CONFIG.sigmaBaseKm) * CONFIG.sigmaBase;
  }

  // Cobertura de TLE: quantos dos últimos 30 dias têm pelo menos 1 TLE
  // (estimativa simples baseada na densidade de pares)
  function coverage(pairs) {
    if (!pairs.length) return 0;
    // ~2 TLEs/dia é considerado cobertura total
    const ideal = CONFIG.days * 2;
    return Math.min(99, Math.round((pairs.length / ideal) * 100));
  }

  // Close approach score: mapeia sigma para 0–100%
  function approachScore(sigma) {
    // >5σ → 100%, baseline 3.4σ → ~68%, 0σ → 0%
    return Math.min(100, Math.round((sigma / 5) * 100));
  }

  // Formata Date para exibição no painel
  function fmtDate(d) {
    if (!(d instanceof Date) || isNaN(d)) return '—';
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  }

  /* ------------------------------------------------------------------
     5. ATUALIZAR ELEMENTOS DO FRONT
     Cada função sabe exatamente qual id/elemento atualizar.
     ------------------------------------------------------------------ */

  // --- Painel 01 · Target ---

  // kv-alt: altitude em km (derivada do TLE linha 2, campo mean motion)
  // mean motion (rev/dia) → período (min) → semi-eixo maior → altitude
  function updateAltitude(observedTleLine2) {
    const el = document.getElementById('kv-alt');
    if (!el || !observedTleLine2) return;
    try {
      const mm  = parseFloat(observedTleLine2.slice(52, 63)); // rev/dia
      const n   = (mm * 2 * Math.PI) / 86400;                // rad/s
      const mu  = 398600.4418;                                // km³/s²
      const a   = Math.cbrt(mu / (n * n));                   // semi-eixo maior (km)
      const alt = (a - 6371).toFixed(1);
      el.innerHTML = `${alt}<small>KM</small>`;
    } catch (_) { /* mantém valor anterior */ }
  }

  // kv-man: timestamp da última manobra detectada
  function updateLastManeuver(epoch) {
    const el = document.getElementById('kv-man');
    if (!el) return;
    el.textContent = fmtDate(epoch);
  }

  // --- Painel 02 · Detection Result ---

  // anticip: lead time em minutos
  // Lead time = diferença entre o TLE mais antigo e o mais recente do histórico
  // (proxy para "quanto antes do TLE público Mitchell já tinha os dados")
  function updateLeadTime(pairs) {
    const el = document.getElementById('anticip');
    if (!el || pairs.length < 2) return;
    try {
      // Extrai epochs das linhas 1 (campo 18-32: YYDDD.DDDDDDDD)
      function epochFromLine1(line) {
        const yy  = parseInt(line.slice(18, 20), 10);
        const day = parseFloat(line.slice(20, 32));
        const yr  = yy < 57 ? 2000 + yy : 1900 + yy;
        const d   = new Date(Date.UTC(yr, 0, 1));
        d.setTime(d.getTime() + (day - 1) * 86400000);
        return d;
      }
      const oldest  = epochFromLine1(pairs[0][0]);
      const newest  = epochFromLine1(pairs[pairs.length - 1][0]);
      const mins    = Math.round((newest - oldest) / 60000);
      const h       = Math.floor(mins / 60);
      const m       = mins % 60;
      const label   = h > 0 ? `${h}<small>h</small>${m}<small>m</small>` : `${m}<small>min</small>`;
      el.innerHTML  = label;
    } catch (_) { /* mantém */ }
  }

  // Barras de métricas
  function setBar(fillId, valId, value, unit, max) {
    const fill = document.getElementById(fillId);
    const val  = document.getElementById(valId);
    if (!fill || !val) return;
    const pct  = Math.min(100, Math.max(0, (value / max) * 100));
    fill.style.width = pct + '%';
    val.textContent  = (unit === 'σ') ? value.toFixed(1) + unit : Math.round(value) + unit;
  }

  // v-conf / f-conf: cobertura TLE (%)
  function updateCoverage(pct) {
    setBar('f-conf', 'v-conf', pct, '%', 100);
  }

  // v-risk / f-risk: close approach score (%)
  function updateRiskScore(score) {
    setBar('f-risk', 'v-risk', score, '%', 100);
  }

  // v-dev / f-dev: desvio em sigma
  function updateSigma(sigma) {
    setBar('f-dev', 'v-dev', sigma, 'σ', 5);
  }

  // obj-count: número de TLEs carregados
  function updateObjCount(n) {
    const el = document.getElementById('obj-count');
    if (el) el.textContent = `${n} TRACKED`;
  }

  /* ------------------------------------------------------------------
     6. INJETAR ALERTAS NO FEED (dashboard.js expõe addAlert via
        window.MITCHELL.addAlert se disponível; caso contrário,
        construímos o elemento diretamente)
     ------------------------------------------------------------------ */
  function addFeedAlert(sev, label, msg) {
    const feed = document.getElementById('feed');
    const countEl = document.getElementById('feed-count');
    if (!feed) return;

    const el = document.createElement('div');
    el.className = `alert ${sev}`;
    const ts = (() => {
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
    })();
    el.innerHTML =
      `<div class="a-top"><span class="a-sev">${label}</span>` +
      `<span class="a-ts">${ts} UTC</span></div>` +
      `<div class="a-msg">${msg}</div>`;
    feed.prepend(el);

    // atualiza contagem
    if (countEl) {
      const cur = parseInt(countEl.textContent) || 0;
      countEl.textContent = `${cur + 1} events`;
    }

    // limite de 26 alertas
    while (feed.children.length > 26) feed.removeChild(feed.lastChild);
  }

  /* ------------------------------------------------------------------
     7. PUBLICAR TUDO
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
    updateCoverage(pct);
    updateRiskScore(score);
    updateSigma(sigma);

    // Expõe resultado completo pro dashboard.js e globe.js
    window.MITCHELL = window.MITCHELL || {};
    window.MITCHELL.detectionResult = result;
    window.MITCHELL.lastFetch       = state.lastFetch;

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

    console.info(
      `[Mitchell] ✓ ${pairs.length} TLEs · cobertura ${pct}% · ` +
      `desvio ${result ? result.deviationKm.toFixed(2) + ' km' : 'N/A'} · ${sigma.toFixed(1)}σ`
    );
  }

  /* ------------------------------------------------------------------
     8. CICLO PRINCIPAL
     ------------------------------------------------------------------ */
  async function poll() {
    if (state.loading) return;
    state.loading = true;
    try {
      const pairs     = await fetchTle();
      state.tlePairs  = pairs;
      state.lastFetch = new Date();
      const result    = runDetection(pairs);
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
     window.MITCHELL.integration.refresh()  → força novo ciclo
     window.MITCHELL.integration.getState() → estado atual
     window.MITCHELL.integration.parseTleText(raw) → util p/ testes
     ------------------------------------------------------------------ */
  window.MITCHELL = window.MITCHELL || {};
  window.MITCHELL.integration = {
    refresh:      poll,
    getState:     () => ({ ...state }),
    parseTleText,
    config:       CONFIG,
  };

  /* ------------------------------------------------------------------
     INICIALIZAÇÃO
     ------------------------------------------------------------------ */
  function init() {
    poll();
    setInterval(poll, CONFIG.pollInterval);
    console.info('[Mitchell] Integration layer v2 · NORAD', CONFIG.norad);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
