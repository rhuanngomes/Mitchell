(function () {
  function tleEpoch(line1) {
    const year = Number(line1.slice(18, 20));
    const day = Number(line1.slice(20, 32));
    const fullYear = year < 57 ? 2000 + year : 1900 + year;
    const date = new Date(Date.UTC(fullYear, 0, 1));
    date.setUTCDate(date.getUTCDate() + Math.floor(day) - 1);
    date.setTime(date.getTime() + (day % 1) * 86400000);
    return date;
  }

  function positionKm(tle, date) {
    const sat = window.satellite.twoline2satrec(tle[0], tle[1]);
    const state = window.satellite.propagate(sat, date);
    if (!state.position) throw new Error('TLE propagation failed');
    return state.position;
  }

  function distanceKm(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  function detectManeuver(previousTle, observedTle, options) {
    if (!window.satellite) throw new Error('satellite.js is required');

    const thresholdKm = options && options.thresholdKm ? options.thresholdKm : 25;
    const observedEpoch = tleEpoch(observedTle[0]);
    const expected = positionKm(previousTle, observedEpoch);
    const observed = positionKm(observedTle, observedEpoch);
    const deviationKm = distanceKm(expected, observed);

    return {
      detected: deviationKm >= thresholdKm,
      deviationKm,
      thresholdKm,
      observedEpoch,
      expected,
      observed,
    };
  }

  window.MitchellDetector = { detectManeuver };
})();
