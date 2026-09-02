/** 伪像素规整 — 网格检测：JPEG 网格防护 / runs 整数尺度校验 / 门控 */
(function (global) {
  "use strict";
  var M = global.AiPixelMath;
  var Band = global.AiPixelBand;

  // G5：JPEG 8×8 网格检测（交叉差分投票）
  function detectJpegGrid(gray, h, w, strengthThreshold) {
    strengthThreshold = strengthThreshold === undefined ? 0.06 : strengthThreshold;
    if (h < 32 || w < 32) return { significant: false, phase: [0, 0], strength: 0 };
    var ch = h - 1, cw = w - 1;
    var absC = new Float32Array(ch * cw);
    for (var y = 0; y < ch; y++) for (var x = 0; x < cw; x++) {
      var c = gray[(y + 1) * w + x + 1] - gray[(y + 1) * w + x] - gray[y * w + x + 1] + gray[y * w + x];
      absC[y * cw + x] = Math.abs(c);
    }
    var thr = M.percentile(absC, 90);
    if (thr <= 1e-12) return { significant: false, phase: [0, 0], strength: 0 };
    var hist = new Float32Array(64), cnt = 0;
    for (var y2 = 0; y2 < ch; y2++) for (var x2 = 0; x2 < cw; x2++) {
      if (absC[y2 * cw + x2] > thr) { hist[(y2 % 8) * 8 + (x2 % 8)]++; cnt++; }
    }
    if (cnt < 64) return { significant: false, phase: [0, 0], strength: 0 };
    var maxBin = 0, maxV = 0;
    for (var b = 0; b < 64; b++) if (hist[b] > maxV) { maxV = hist[b]; maxBin = b; }
    var strength = maxV / cnt;
    return { significant: strength >= strengthThreshold, phase: [(maxBin / 8) | 0, maxBin % 8], strength: strength };
  }

  // runs：一维行程长度
  function lineRuns(line, tol) {
    var runs = [], start = 0;
    for (var i = 1; i < line.length; i++) {
      if (Math.abs(line[i] - line[i - 1]) > tol) { runs.push(i - start); start = i; }
    }
    runs.push(line.length - start);
    return runs;
  }

  function bestScaleFromRuns(runs, minP, maxP, tol) {
    var total = runs.length;
    if (total === 0) return { scale: 0, hitRate: 0 };
    var hist = {};
    for (var i = 0; i < total; i++) hist[runs[i]] = (hist[runs[i]] || 0) + 1;
    var top = [];
    for (var L in hist) top.push({ L: +L, c: hist[L] });
    top.sort(function (a, b) { return b.c - a.c; });
    top = top.slice(0, 8).map(function (t) { return t.L; });
    var cands = {};
    function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }
    for (var i2 = 0; i2 < top.length; i2++) {
      if (top[i2] >= minP && top[i2] <= maxP) cands[top[i2]] = 1;
      for (var j = i2 + 1; j < top.length; j++) {
        var g = gcd(top[i2], top[j]);
        if (g >= minP && g <= maxP) cands[g] = 1;
      }
    }
    var keys = Object.keys(cands).map(Number).sort(function (a, b) { return a - b; });
    if (!keys.length) return { scale: 0, hitRate: 0 };
    var bestS = 0, bestRate = 0;
    for (var s2 = 0; s2 < keys.length; s2++) {
      var s = keys[s2], hits = 0;
      for (var r = 0; r < total; r++) {
        var k = Math.round(runs[r] / s);
        if (k >= 1 && Math.abs(runs[r] - k * s) <= tol) hits++;
      }
      var rate = hits / total;
      if (rate > bestRate + 1e-9 || (Math.abs(rate - bestRate) < 1e-9 && s > bestS)) { bestS = s; bestRate = rate; }
    }
    return { scale: bestS, hitRate: bestRate };
  }

  function detectIntegerScale(gray, h, w, minP, maxP, tol, sampleStride) {
    tol = tol === undefined ? 12 : tol;
    sampleStride = sampleStride === undefined ? 4 : sampleStride;
    if (h < 8 || w < 8) return { sx: 0, sy: 0, hitRate: 0, confidence: 0 };
    var xRuns = [], yRuns = [];
    for (var y = 0; y < h; y += sampleStride) {
      var line = new Float32Array(w);
      for (var x = 0; x < w; x++) line[x] = gray[y * w + x];
      xRuns = xRuns.concat(lineRuns(line, tol));
    }
    for (var x2 = 0; x2 < w; x2 += sampleStride) {
      var line2 = new Float32Array(h);
      for (var y2 = 0; y2 < h; y2++) line2[y2] = gray[y2 * w + x2];
      yRuns = yRuns.concat(lineRuns(line2, tol));
    }
    var rx = bestScaleFromRuns(xRuns, minP, maxP, tol), ry = bestScaleFromRuns(yRuns, minP, maxP, tol);
    if (rx.scale <= 0 || ry.scale <= 0) return { sx: 0, sy: 0, hitRate: 0, confidence: 0 };
    var hitRate = (rx.hitRate + ry.hitRate) / 2;
    var confidence = hitRate * (rx.scale === ry.scale ? 1 : 0.7);
    if (hitRate < 0.7) return { sx: 0, sy: 0, hitRate: 0, confidence: 0 };
    return { sx: rx.scale, sy: ry.scale, hitRate: hitRate, confidence: confidence };
  }

  // runs 对投票周期的修正
  function runsCorrectPeriod(period, vote, runs, edgeMap, h, w, axis, minP, maxP, edgeIntegral) {
    if (period <= 0 || vote <= 0 || runs <= 0) return period;
    var v = vote, r = runs;
    var rel = Math.abs(r - v) / Math.max(r, v);
    if (rel <= 0.2) return r;
    if (r > v) {
      var ratio = r / v, k = Math.round(ratio);
      if (k >= 2 && Math.abs(ratio - k) / k <= 0.15) {
        var eRuns = Band.edgeBandStrength(edgeMap, h, w, r, axis, null, edgeIntegral);
        var eVote = Band.edgeBandStrength(edgeMap, h, w, v, axis, null, edgeIntegral);
        if (eRuns >= 0.9 * eVote) return r;
      }
      return period;
    }
    if (v >= 3) {
      var eRuns2 = Band.edgeBandStrength(edgeMap, h, w, r, axis, null, edgeIntegral);
      var eVote2 = Band.edgeBandStrength(edgeMap, h, w, v, axis, null, edgeIntegral);
      if (eVote2 > 1e-12 && eRuns2 > 1.3 * eVote2) return r;
    }
    return period;
  }

  // 高分辨率合理性门控
  function plausibilityGateAxis(p, edgeMap, h, w, axis, minP, maxP, edgeIntegral) {
    var cur = p;
    if (cur >= 3) return cur;
    for (var step = 0; step < 6; step++) {
      var eCur = Band.edgeBandStrength(edgeMap, h, w, cur, axis, null, edgeIntegral);
      if (eCur <= 1e-12) break;
      var nextP = cur;
      var kMax = Math.min(Math.floor(maxP / cur) + 1, 13);
      for (var k = 2; k < kMax; k++) {
        var kp = k * cur;
        if (kp < minP || kp > maxP) continue;
        var eKp = Band.edgeBandStrength(edgeMap, h, w, kp, axis, null, edgeIntegral);
        if (eKp >= 1.3 * eCur) { nextP = kp; break; }
      }
      if (nextP === cur) break;
      cur = nextP;
    }
    return cur;
  }

  global.AiPixelCross = {
    detectJpegGrid: detectJpegGrid, detectIntegerScale: detectIntegerScale,
    runsCorrectPeriod: runsCorrectPeriod, plausibilityGateAxis: plausibilityGateAxis
  };
})(typeof window !== "undefined" ? window : this);
