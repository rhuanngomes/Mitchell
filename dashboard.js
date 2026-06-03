/* ============================================================
   MITCHELL — dashboard runtime: clock, bars, alert feed
   ============================================================ */
(function () {
  /* ---------- live UTC clock + epoch ---------- */
  const clockEl = document.getElementById('clock');
  const dateEl  = document.getElementById('date');
  const epochEl = document.getElementById('epoch');
  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

  function pad(n, l = 2) { return String(n).padStart(l, '0'); }

  function tick() {
    const d = new Date();
    const hh = pad(d.getUTCHours()), mm = pad(d.getUTCMinutes()), ss = pad(d.getUTCSeconds());
    clockEl.textContent = `${hh}:${mm}:${ss}`;
    dateEl.textContent = `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    // day-of-year fractional epoch
    const start = Date.UTC(d.getUTCFullYear(), 0, 0);
    const doy = Math.floor((d - start) / 86400000);
    const frac = ((d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()) / 86400);
    epochEl.textContent = `${d.getUTCFullYear()}-${doy}.${pad(Math.floor(frac * 100000), 5)}`;
  }
  tick();
  setInterval(tick, 1000);

  /* ---------- progress bars (animate to target, then subtle drift) ---------- */
  const bars = {
    conf: { fill: document.getElementById('f-conf'), val: document.getElementById('v-conf'), base: 96,  unit: '%',  jitter: 1.5, max: 99 },
    risk: { fill: document.getElementById('f-risk'), val: document.getElementById('v-risk'), base: 71,  unit: '%',  jitter: 6,   max: 100 },
    dev:  { fill: document.getElementById('f-dev'),  val: document.getElementById('v-dev'),  base: 3.4, unit: 'σ',  jitter: 0.5, max: 5, isSigma: true },
  };

  function setBar(b, v) {
    if (b.isSigma) {
      b.val.textContent = v.toFixed(1) + b.unit;
      b.fill.style.width = Math.min(100, (v / b.max) * 100) + '%';
    } else {
      b.val.textContent = Math.round(v) + b.unit;
      b.fill.style.width = Math.min(100, v) + '%';
    }
  }

  // initial draw-in
  setTimeout(() => Object.values(bars).forEach(b => setBar(b, b.base)), 120);

  /* ---------- alert feed ---------- */
  const feed = document.getElementById('feed');
  const feedCount = document.getElementById('feed-count');
  let eventCount = 0;
  const MAX_ALERTS = 26;

  function utcStamp(offsetSec = 0) {
    const d = new Date(Date.now() - offsetSec * 1000);
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }

  function addAlert(sev, sevLabel, msg, ts) {
    const el = document.createElement('div');
    el.className = `alert ${sev}`;
    el.innerHTML =
      `<div class="a-top"><span class="a-sev">${sevLabel}</span>` +
      `<span class="a-ts">${ts || utcStamp()} UTC</span></div>` +
      `<div class="a-msg">${msg}</div>`;
    feed.prepend(el);
    eventCount++;
    feedCount.textContent = `${eventCount} events`;
    while (feed.children.length > MAX_ALERTS) feed.removeChild(feed.lastChild);
  }

  // seed feed with values that can be obtained from TLE/GP data or derived from it.
  const seed = [
    ['blue',  'INFO',    'Space-Track GP history loaded · <b>CAS-7B</b> · 30 day window', 1840],
    ['blue',  'INFO',    'Latest TLE epoch parsed for <b>41</b> catalog objects in LEO volume', 1520],
    ['blue',  'INFO',    'SGP4 propagation complete · expected trajectory generated from previous TLE', 1210],
    ['amber', 'WATCH',   '<b>CAS-7B</b> observed TLE deviated from propagated track by <b>3.4σ</b>', 980],
    ['blue',  'INFO',    'Historical residual baseline updated · sample coverage <b>96%</b>', 760],
    ['red',   'WATCH',   'Close approach window · <b>CAS-7B × Starlink object</b> · lead time 228 min', 540],
    ['amber', 'WATCH',   'Estimated miss distance from propagated TLEs · <b>1.84 km</b>', 360],
    ['blue',  'INFO',    'Mitchell alert created from public catalog data · no operator-private data used', 150],
  ];
  seed.forEach(([sev, lbl, msg, off]) => addAlert(sev, lbl, msg, utcStamp(off)));
  // newest seed should be on top → prepend order already handles via loop (last added = top)

  /* ---------- proximity-driven live events ---------- */
  let lastProx = false;
  let riskDrift = bars.risk.base;
  const anticip = document.getElementById('anticip');
  const orbitReadout = document.getElementById('orbit-readout');

  const driftMsgs = {
    enter: () => addAlert('red', 'WATCH',
      `Close approach threshold crossed · propagated distance <b>${(Math.random()*0.6+1.4).toFixed(2)} km</b>`),
    hold:  () => addAlert('amber', 'WATCH',
      `TLE-derived separation decreasing · sampling next propagated step`),
    exit:  () => addAlert('blue', 'INFO',
      `Propagated paths diverging · close approach score decaying`),
  };

  let holdTimer = 0;
  function pollProximity() {
    const P = window.MITCHELL && window.MITCHELL.getProximity ? window.MITCHELL.getProximity() : null;
    if (!P) return;

    if (P.active && !lastProx) {
      driftMsgs.enter();
      riskDrift = Math.min(98, 78 + Math.random() * 14);
      holdTimer = 0;
    } else if (!P.active && lastProx) {
      driftMsgs.exit();
      riskDrift = bars.risk.base - 8;
    }
    if (P.active) {
      holdTimer++;
      if (holdTimer % 7 === 0) driftMsgs.hold();
      // map TLE-derived proximity → close approach score / lead time
      const closeness = Math.max(0, 1 - P.dist / 0.34);
      riskDrift = 74 + closeness * 22;
      const mins = Math.round(228 - closeness * 96); // closes in → less lead time
      anticip.innerHTML = `${mins}<small>min</small>`;
      orbitReadout.textContent = `CLOSE APPROACH WATCH · EST. MISS ${(P.dist*900).toFixed(0)} M · LEAD ${mins} MIN`;
      orbitReadout.style.color = 'var(--red)';
    } else {
      riskDrift += (bars.risk.base - riskDrift) * 0.08;
      anticip.innerHTML = `228<small>min</small>`;
      orbitReadout.textContent = `ORBITAL PLANE 53.2° · RAAN 198.4° · PERIOD 95.6 MIN`;
      orbitReadout.style.color = '';
    }
    lastProx = P.active;
  }
  setInterval(pollProximity, 1000);

  /* ---------- subtle live drift on bars ---------- */
  setInterval(() => {
    setBar(bars.conf, bars.conf.base + (Math.random() - 0.5) * bars.conf.jitter);
    setBar(bars.risk, Math.max(0, Math.min(100, riskDrift + (Math.random() - 0.5) * 2)));
    setBar(bars.dev,  bars.dev.base + (Math.random() - 0.5) * bars.dev.jitter);
  }, 2200);

  /* ---------- occasional ambient telemetry events ---------- */
  const ambient = [
    ['blue', 'INFO', 'Catalog cross-tag complete · Starlink group objects mapped by NORAD ID'],
    ['blue', 'INFO', 'TLE history cache refreshed · CAS-7B residual series updated'],
    ['amber','WATCH', 'Residual trend above baseline · waiting for next public TLE epoch'],
    ['blue', 'INFO', 'CelesTrak fallback endpoint available for latest GP validation'],
    ['blue', 'INFO', 'Mitchell score recalculated from public TLE history'],
  ];
  setInterval(() => {
    if (lastProx) return; // don't clutter during active conjunction
    const a = ambient[Math.floor(Math.random() * ambient.length)];
    addAlert(a[0], a[1], a[2]);
  }, 9000);

})();
