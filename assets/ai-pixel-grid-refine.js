/** 伪像素规整 — 网格检测：G3 峰值格点拟合周期精化（黄金分割替代 L-BFGS-B） */
(function (global) {
  "use strict";
  var M = global.AiPixelMath;

  // 简化峰值检测（局部极大 + 简化 prominence）
  function findPeaksSimple(prof, threshold) {
    var peaks = [];
    for (var i = 1; i < prof.length - 1; i++) {
      if (prof[i] >= threshold && prof[i] > prof[i - 1] && prof[i] > prof[i + 1]) {
        var leftVal = prof[i];
        for (var l = i - 1; l >= 0; l--) { if (prof[l] <= leftVal) leftVal = prof[l]; else break; }
        var rightVal = prof[i];
        for (var r = i + 1; r < prof.length; r++) { if (prof[r] <= rightVal) rightVal = prof[r]; else break; }
        peaks.push({ pos: i, prom: prof[i] - Math.max(leftVal, rightVal) });
      }
    }
    return peaks;
  }

  function goldenMin(fn, a, b, tol) {
    var gr = (Math.sqrt(5) - 1) / 2;
    var c = b - gr * (b - a), d = a + gr * (b - a);
    var fc = fn(c), fd = fn(d);
    while (Math.abs(b - a) > tol) {
      if (fc < fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = fn(c); }
      else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = fn(d); }
    }
    return (a + b) / 2;
  }

  function refinePeriodPeakLattice(profile, initialP, minP, maxP) {
    var p0 = initialP;
    if (p0 <= 0 || profile.length < 8) return p0;
    var profMax = M.max(profile);
    if (profMax <= 1e-12) return p0;
    var peakIdx = null;
    var ratios = [0.05, 0.02, 0.01];
    for (var pr = 0; pr < ratios.length; pr++) {
      var pk = findPeaksSimple(profile, ratios[pr] * profMax);
      if (pk.length >= 4) { peakIdx = pk; break; }
    }
    if (!peakIdx) return p0;
    peakIdx.sort(function (a, b) { return b.prom - a.prom; });
    var nPeaks = peakIdx.length;
    var ks = [];
    if (nPeaks <= 24) { for (var k = 4; k <= nPeaks; k++) ks.push(k); }
    else {
      for (var k2 = 4; k2 < 15; k2++) ks.push(k2);
      var stride = Math.max(2, ((nPeaks - 14) / 6) | 0);
      for (var k3 = 15; k3 < nPeaks; k3 += stride) ks.push(k3);
      ks.push(nPeaks);
    }
    var bestS = null, bestJ = Infinity;
    for (var ki = 0; ki < ks.length; ki++) {
      var k = ks[ki];
      if (k > nPeaks) continue;
      var pos = peakIdx.slice(0, k).map(function (p) { return p.pos; }).sort(function (a, b) { return a - b; });
      var spacings = [];
      for (var i = 1; i < pos.length; i++) spacings.push(pos[i] - pos[i - 1]);
      if (spacings.length < 3) continue;
      var first = pos[0], last = pos[pos.length - 1];
      function J(s) {
        if (s <= 0) return 1e9;
        var resid = 0;
        for (var i = 0; i < spacings.length; i++) {
          var rr = Math.max(Math.round(spacings[i] / s), 1);
          var dd = spacings[i] - rr * s;
          resid += dd * dd;
        }
        var rms = Math.sqrt(resid / spacings.length) / s;
        var nLines = Math.round((last - first) / s) + 1;
        if (nLines < k) nLines = k;
        var missing = Math.max(0, (nLines - k) / nLines);
        return rms + 0.5 * missing;
      }
      var s = goldenMin(J, minP, maxP, 0.01);
      var j = J(s);
      if (j < bestJ) { bestJ = j; bestS = s; }
    }
    if (bestS === null || bestJ >= 0.15) return p0;
    if (Math.abs(bestS - p0) / p0 > 0.3) return p0;
    if (Math.abs(bestS - p0) / p0 <= 0.02 && Math.abs(bestS - Math.round(bestS)) < 0.02 * bestS) return Math.round(bestS);
    return bestS;
  }

  global.AiPixelRefine = { refinePeriodPeakLattice: refinePeriodPeakLattice, findPeaksSimple: findPeaksSimple };
})(typeof window !== "undefined" ? window : this);
