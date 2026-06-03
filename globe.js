/* ============================================================
   MITCHELL — 3D wireframe Earth + orbital satellite tracking
   Orthographic projection, ECI-style frame, slow auto-rotation.
   ============================================================ */
(function () {
  const canvas = document.getElementById('globe');
  const ctx = canvas.getContext('2d');

  const COL = {
    cyan:  '#86EFAC',
    amber: '#C4B5FD',
    red:   '#FCA5A5',
    grid:  '214,211,209',
  };

  let W = 0, H = 0, DPR = 1;
  let cx = 0, cy = 0, R = 0, baseR = 0;
  let zoom = 1;

  const tooltip = document.createElement('div');
  tooltip.setAttribute('role', 'status');
  tooltip.style.cssText = [
    'position:fixed',
    'z-index:20',
    'display:none',
    'min-width:178px',
    'padding:10px 11px',
    'border:1px solid rgba(255,255,255,0.12)',
    'border-radius:8px',
    'background:rgba(10,10,11,0.92)',
    'box-shadow:0 16px 40px rgba(0,0,0,0.32)',
    'backdrop-filter:blur(14px)',
    'color:#f4f4f5',
    'font:12px Inter, system-ui, sans-serif',
    'line-height:1.35',
    'pointer-events:none',
  ].join(';');
  document.body.appendChild(tooltip);

  function setRadius() {
    baseR = Math.min(W, H) * 0.30;
    R = baseR * zoom;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width; H = rect.height;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx = W * 0.5;
    cy = H * 0.5;
    setRadius();
  }
  window.addEventListener('resize', resize);

  /* ---------- math: rotation helpers ---------- */
  function rotX(p, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
  }
  function rotY(p, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
  }
  function rotZ(p, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z };
  }

  let tilt = -0.41; // ~23.5deg axial tilt + viewing angle
  let spin = -0.5;

  // apply camera/view transform (shared by all geometry)
  function view(p) {
    return rotX(rotY(p, spin), tilt);
  }
  function project(p) {
    const v = view(p);
    return { x: cx + v.x, y: cy - v.y, z: v.z };
  }
  // unit-sphere surface points (grid, coastlines) are scaled to globe radius R here
  function vScale(p) { return { x: p.x * R, y: p.y * R, z: p.z * R }; }

  /* ---------- interaction: drag, zoom, hover tooltip ---------- */
  const pointer = { x: -9999, y: -9999, clientX: 0, clientY: 0, inside: false };
  let dragging = false;
  let lastDrag = null;
  let hoverTargets = [];

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function updatePointer(ev) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ev.clientX - rect.left;
    pointer.y = ev.clientY - rect.top;
    pointer.clientX = ev.clientX;
    pointer.clientY = ev.clientY;
    pointer.inside = true;
  }

  function formatDeg(v, pos, neg) {
    const hemi = v >= 0 ? pos : neg;
    return `${Math.abs(v).toFixed(2)}°${hemi}`;
  }

  function satCoordinates(p) {
    const r = Math.hypot(p.x, p.y, p.z) || 1;
    const lat = Math.asin(p.y / r) / DEG;
    const lon = Math.atan2(p.z, p.x) / DEG;
    return { lat, lon };
  }

  function showTooltip(target) {
    const c = satCoordinates(target.p);
    tooltip.innerHTML =
      `<strong style="display:block;margin-bottom:5px;font-size:12px;">${target.s.name}</strong>` +
      `<span style="display:block;color:#a1a1aa;">` +
      `${formatDeg(c.lat, 'N', 'S')} · ${formatDeg(c.lon, 'E', 'W')}</span>` +
      `<span style="display:block;color:#a1a1aa;">Altitude ${target.s.altKm.toFixed(0)} km · NORAD ${target.s.norad}</span>`;
    tooltip.style.left = `${Math.min(window.innerWidth - 210, pointer.clientX + 14)}px`;
    tooltip.style.top = `${Math.min(window.innerHeight - 84, pointer.clientY + 14)}px`;
    tooltip.style.display = 'block';
  }

  function updateHover() {
    if (!pointer.inside || dragging) {
      tooltip.style.display = 'none';
      return;
    }

    let hit = null;
    let best = Infinity;
    hoverTargets.forEach(target => {
      if (target.occluded) return;
      const d = Math.hypot(target.pr.x - pointer.x, target.pr.y - pointer.y);
      if (d < 14 && d < best) {
        hit = target;
        best = d;
      }
    });

    canvas.style.cursor = hit ? 'pointer' : 'grab';
    if (hit) showTooltip(hit);
    else tooltip.style.display = 'none';
  }

  canvas.addEventListener('pointerdown', ev => {
    dragging = true;
    lastDrag = { x: ev.clientX, y: ev.clientY };
    canvas.setPointerCapture(ev.pointerId);
    canvas.style.cursor = 'grabbing';
    tooltip.style.display = 'none';
  });

  canvas.addEventListener('pointermove', ev => {
    updatePointer(ev);
    if (!dragging || !lastDrag) return;

    const dx = ev.clientX - lastDrag.x;
    const dy = ev.clientY - lastDrag.y;
    spin += dx * 0.006;
    tilt = clamp(tilt + dy * 0.004, -1.15, 1.15);
    lastDrag = { x: ev.clientX, y: ev.clientY };
  });

  canvas.addEventListener('pointerup', ev => {
    dragging = false;
    lastDrag = null;
    canvas.releasePointerCapture(ev.pointerId);
    canvas.style.cursor = 'grab';
  });

  canvas.addEventListener('pointerleave', () => {
    pointer.inside = false;
    dragging = false;
    tooltip.style.display = 'none';
    canvas.style.cursor = 'default';
  });

  canvas.addEventListener('wheel', ev => {
    ev.preventDefault();
    zoom = clamp(zoom * (ev.deltaY > 0 ? 0.92 : 1.08), 0.68, 1.75);
    setRadius();
  }, { passive: false });

  /* ---------- build Earth wireframe ---------- */
  const DEG = Math.PI / 180;
  const latLines = [];
  const lonLines = [];

  function buildEarth() {
    latLines.length = 0; lonLines.length = 0;
    // latitude circles every 20deg
    for (let lat = -80; lat <= 80; lat += 20) {
      const ring = [];
      const r = Math.cos(lat * DEG);
      const y = Math.sin(lat * DEG);
      for (let lon = 0; lon <= 360; lon += 6) {
        ring.push({ x: r * Math.cos(lon * DEG), y: y, z: r * Math.sin(lon * DEG) });
      }
      latLines.push({ pts: ring, major: lat === 0 });
    }
    // longitude meridians every 20deg
    for (let lon = 0; lon < 360; lon += 20) {
      const line = [];
      for (let lat = -90; lat <= 90; lat += 4) {
        const r = Math.cos(lat * DEG);
        line.push({ x: r * Math.cos(lon * DEG), y: Math.sin(lat * DEG), z: r * Math.sin(lon * DEG) });
      }
      lonLines.push({ pts: line, major: false });
    }
  }
  buildEarth();

  /* ---------- real Earth coastlines (Natural Earth 110m land) ---------- */
  // Each landmass becomes a ring of unit-sphere vectors, projected like the grid.
  let land = null;
  function lonLatToVec(lon, lat) {
    const la = lat * DEG, lo = lon * DEG;
    const r = Math.cos(la);
    return { x: r * Math.cos(lo), y: Math.sin(la), z: r * Math.sin(lo) };
  }
  (function loadLand() {
    const URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson';
    fetch(URL).then(r => r.json()).then(gj => {
      const rings = [];
      (gj.features || []).forEach(f => {
        const g = f.geometry; if (!g) return;
        const polys = g.type === 'Polygon' ? [g.coordinates]
                    : g.type === 'MultiPolygon' ? g.coordinates : [];
        polys.forEach(poly => poly.forEach(ring => {
          rings.push(ring.map(c => lonLatToVec(c[0], c[1])));
        }));
      });
      land = rings;
    }).catch(() => { land = null; });
  })();

  function drawLand() {
    if (!land) return;
    ctx.lineWidth = 0.9;
    for (const ring of land) {
      let prev = null, prevFront = false;
      for (let i = 0; i < ring.length; i++) {
        const v = view(vScale(ring[i]));
        const sx = cx + v.x, sy = cy - v.y, front = v.z > 0;
        if (prev) {
          const both = prevFront && front;
          const neither = !prevFront && !front;
          if (!(neither && false)) {
            const alpha = both ? 0.62 : neither ? 0.10 : 0.30;
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(sx, sy);
            ctx.strokeStyle = `rgba(150,178,186,${alpha})`;
            ctx.stroke();
          }
        }
        prev = { x: sx, y: sy }; prevFront = front;
      }
    }
  }

  /* ---------- satellites ---------- */
  // altitude as fraction of R above surface
  function mkSat(opts) {
    return Object.assign({
      inc: 53 * DEG,      // inclination
      raan: 0,            // right ascension of ascending node
      alt: 0.34,          // orbit radius factor above surface (R*(1+alt))
      phase: 0,           // current anomaly
      speed: 0.0042,      // angular velocity
      type: 'starlink',
      name: 'STARLINK OBJECT',
      norad: '—',
      altKm: 550,
    }, opts);
  }

  const sats = [];
  // Several Starlink shells (53deg + 70deg + 97deg planes)
  const shells = [
    { inc: 53,  count: 11, alt: 0.30, speed: 0.0040, altKm: 540 },
    { inc: 53.2,count: 10, alt: 0.33, speed: 0.0038, altKm: 550 },
    { inc: 70,  count: 9,  alt: 0.37, speed: 0.0035, altKm: 570 },
    { inc: 97.6,count: 9,  alt: 0.41, speed: 0.0033, altKm: 560 },
  ];
  shells.forEach((sh, si) => {
    for (let i = 0; i < sh.count; i++) {
      const ordinal = si * 100 + i + 1;
      sats.push(mkSat({
        inc: sh.inc * DEG,
        raan: (i / sh.count) * Math.PI * 2 + si * 0.6,
        alt: sh.alt + (i % 3) * 0.006,
        altKm: sh.altKm + (i % 3) * 4,
        phase: Math.random() * Math.PI * 2,
        speed: sh.speed,
        type: 'starlink',
        name: `STARLINK-${String(6079 + ordinal).padStart(4, '0')}`,
        norad: String(53000 + ordinal),
      }));
    }
  });

  // CAS-7B — the non-cooperative target (retrograde-ish polar, off-nominal)
  const cas = mkSat({
    inc: 97.6 * DEG,
    raan: 1.2,
    alt: 0.355,
    phase: 0.4,
    speed: 0.0036,
    type: 'cas',
    name: 'CAS-7B',
    norad: '54776',
    altKm: 512.4,
  });

  function satPos(s) {
    const rr = R * (1 + s.alt);
    // orbit in XY plane
    let p = { x: rr * Math.cos(s.phase), y: rr * Math.sin(s.phase), z: 0 };
    p = rotX(p, s.inc);    // tilt by inclination
    p = rotZ(p, s.raan);   // rotate ascending node
    return p;
  }

  /* ---------- drawing ---------- */
  function drawPolyline(pts, baseAlpha, color, major) {
    // draw segment-by-segment, fading by depth, hiding occluded back arcs softly
    for (let i = 0; i < pts.length - 1; i++) {
      const a = project(vScale(pts[i]));
      const b = project(vScale(pts[i + 1]));
      const zMid = (a.z + b.z) * 0.5;
      // front hemisphere brighter; back hemisphere very faint
      const front = zMid > 0;
      let alpha = baseAlpha * (front ? (0.6 + 0.4 * (zMid / R)) : 0.22 * (1 + zMid / R));
      if (alpha <= 0.012) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = `rgba(${color},${alpha.toFixed(3)})`;
      ctx.lineWidth = major ? 1.1 : 0.8;
      ctx.stroke();
    }
  }

  function drawEarth() {
    // soft limb halo
    const grad = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.18);
    grad.addColorStop(0, 'rgba(10,30,55,0.0)');
    grad.addColorStop(0.82, 'rgba(20,60,110,0.10)');
    grad.addColorStop(1, 'rgba(20,60,110,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.18, 0, Math.PI * 2); ctx.fill();

    // disc fill (very subtle, makes back lines read as "through" the globe)
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(5,12,24,0.55)';
    ctx.fill();

    lonLines.forEach(l => drawPolyline(l.pts, 0.5, COL.grid, l.major));
    latLines.forEach(l => drawPolyline(l.pts, 0.55, COL.grid, l.major));

    // real Earth landmasses
    drawLand();

    // limb circle
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${COL.grid},0.62)`;
    ctx.lineWidth = 1.2; ctx.stroke();
  }

  function drawOrbitPath(s, alpha) {
    ctx.beginPath();
    let started = false;
    for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.08) {
      const rr = R * (1 + s.alt);
      let p = { x: rr * Math.cos(a), y: rr * Math.sin(a), z: 0 };
      p = rotX(p, s.inc); p = rotZ(p, s.raan);
      const pr = project(p);
      if (!started) { ctx.moveTo(pr.x, pr.y); started = true; }
      else ctx.lineTo(pr.x, pr.y);
    }
    ctx.strokeStyle = `rgba(${COL.grid},${alpha})`;
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }

  function isOccluded(pr) {
    // behind globe if projected inside limb AND depth negative
    const d = Math.hypot(pr.x - cx, pr.y - cy);
    return pr.z < 0 && d < R;
  }

  function drawSatDot(pr, color, radius, glow, occluded) {
    const a = occluded ? 0.22 : 1;
    if (glow && !occluded) {
      ctx.beginPath(); ctx.arc(pr.x, pr.y, radius + glow, 0, Math.PI * 2);
      ctx.fillStyle = hexA(color, 0.18); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(pr.x, pr.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = hexA(color, a); ctx.fill();
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /* ---------- proximity / conjunction ---------- */
  let proximityState = { active: false, dist: 999, target: null };

  function dist3(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  /* ---------- main loop ---------- */
	  let pulse = 0;
	  function frame() {
	   try {
	    if (!dragging) spin += 0.00115;
	    pulse += 0.05;

    sats.forEach(s => s.phase += s.speed);
    cas.phase += cas.speed;

	    ctx.clearRect(0, 0, W, H);
	    hoverTargets = [];

    drawEarth();

    // faint orbit guide for CAS-7B
    drawOrbitPath(cas, 0.12);

	    // compute positions
	    const casP = satPos(cas);
	    const casPr = project(casP);

    // find nearest starlink in 3D
    let nearest = null, nd = Infinity;
    const drawn = [];
    sats.forEach(s => {
      const p = satPos(s);
      const pr = project(p);
      drawn.push({ s, p, pr });
      const d = dist3(p, casP);
      if (d < nd) { nd = d; nearest = { s, p, pr }; }
    });

    const PROX = R * 0.34; // proximity threshold
    proximityState.active = nd < PROX;
    proximityState.dist = nd / R; // normalized
    proximityState.target = nearest ? nearest.s : null;

    // conjunction link (draw under dots)
    if (proximityState.active && nearest) {
      const t = (pulse * 1.4) % 1;
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -pulse * 6;
      ctx.beginPath();
      ctx.moveTo(casPr.x, casPr.y);
      ctx.lineTo(nearest.pr.x, nearest.pr.y);
      const closeness = 1 - (nd / PROX); // 0..1
      ctx.strokeStyle = hexA(COL.red, 0.35 + 0.45 * closeness);
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.restore();
      // midpoint marker
      const mx = (casPr.x + nearest.pr.x) / 2, my = (casPr.y + nearest.pr.y) / 2;
      ctx.beginPath(); ctx.arc(mx, my, 2 + 2 * Math.sin(pulse * 2), 0, Math.PI * 2);
      ctx.fillStyle = hexA(COL.red, 0.6); ctx.fill();
    }

    // draw starlink dots (sorted back-to-front)
	    drawn.sort((a, b) => a.pr.z - b.pr.z);
	    drawn.forEach(({ s, p, pr }) => {
	      const occ = isOccluded(pr);
	      const isNear = proximityState.active && nearest && s === nearest.s;
	      drawSatDot(pr, isNear ? COL.red : COL.cyan, 1.9, isNear ? 5 : 3, occ);
	      hoverTargets.push({ s, p, pr, occluded: occ });
	    });

    // CAS-7B — pulsing amber, drawn on top
    const occCas = isOccluded(casPr);
    const ring = 6 + 4 * (0.5 + 0.5 * Math.sin(pulse * 1.6));
    if (!occCas) {
      ctx.beginPath(); ctx.arc(casPr.x, casPr.y, ring, 0, Math.PI * 2);
      ctx.strokeStyle = hexA(COL.amber, 0.5 - 0.3 * (ring - 6) / 4);
      ctx.lineWidth = 1; ctx.stroke();
	    }
	    drawSatDot(casPr, COL.amber, 3, 7, occCas);
	    hoverTargets.push({ s: cas, p: casP, pr: casPr, occluded: occCas });
    // crosshair on CAS-7B
    if (!occCas) {
      ctx.strokeStyle = hexA(COL.amber, 0.45);
      ctx.lineWidth = 0.8;
      const g = 9;
      ctx.beginPath();
      ctx.moveTo(casPr.x - g - 4, casPr.y); ctx.lineTo(casPr.x - g, casPr.y);
      ctx.moveTo(casPr.x + g, casPr.y); ctx.lineTo(casPr.x + g + 4, casPr.y);
      ctx.moveTo(casPr.x, casPr.y - g - 4); ctx.lineTo(casPr.x, casPr.y - g);
      ctx.moveTo(casPr.x, casPr.y + g); ctx.lineTo(casPr.x, casPr.y + g + 4);
	      ctx.stroke();
	    }
	    updateHover();
	   } catch(e) { console.error('FRAME ERROR:', e.message); }
	  }

  // expose proximity to dashboard
  window.MITCHELL = window.MITCHELL || {};
  window.MITCHELL.getProximity = () => proximityState;

  resize();
  frame();                       // immediate first paint
  setInterval(frame, 33);        // ~30fps driver (robust vs rAF throttling)
})();
