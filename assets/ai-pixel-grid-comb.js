/** 伪像素规整 — 网格检测：G2 梳状能量集中度终审 */
(function (global) {
  "use strict";
  var M = global.AiPixelMath;

  function combEnergyScore(prof, pitch, phase, total) {
    var n = prof.length;
    if (n === 0 || pitch <= 0) return 0;
    var kMax = Math.floor((n - 1 - phase) / pitch);
    if (kMax < 0) return 0;
    var e = 0, teeth = 0;
    for (var k = 0; k <= kMax; k++) {
      var pos = Math.round(phase + k * pitch);
      if (pos >= 0 && pos < n) { e += prof[pos]; teeth++; }
    }
    if (teeth === 0) return 0;
    if (total === undefined) total = M.sum(prof);
    if (total <= 1e-12) return 0;
    return e / total - teeth / n;
  }

  function combSameFamily(pA, pB) {
    var lo = pA <= pB ? pA : pB, hi = pA <= pB ? pB : pA;
    if (hi <= 0) return true;
    if ((hi - lo) / hi < 0.05) return true;
    if (lo <= 0) return false;
    var ratio = hi / lo;
    for (var j = 1; j <= 4; j++) for (var k = j + 1; k <= 4; k++) {
      var r = k / j;
      if (Math.abs(ratio - r) / r < 0.02) return true;
    }
    return false;
  }

  function combSegCoarseScore(profS, total, pitch) {
    var n = profS.length;
    var lSeg = Math.max(3 * pitch, 24);
    var nSeg = Math.max(1, Math.ceil(n / lSeg));
    var nPh = Math.ceil(pitch / 0.5 - 1e-9);
    var sum = 0;
    for (var seg = 0; seg < nSeg; seg++) {
      var segStart = seg * lSeg, segEnd = Math.min(segStart + lSeg, n);
      var bestSeg = -Infinity;
      for (var phj = 0; phj < nPh; phj++) {
        var phase = phj * 0.5;
        var e = 0, teeth = 0, m = 0;
        while (true) {
          var pos = Math.round(segStart + phase + m * pitch);
          if (pos >= segEnd || pos >= n) break;
          if (pos >= 0) { e += profS[pos]; teeth++; }
          m++;
        }
        var score = e / total - teeth / n;
        if (score > bestSeg) bestSeg = score;
      }
      sum += bestSeg;
    }
    return sum;
  }

  function combFineGridSearch(profS, total, pitch0, minP, maxP) {
    var n = profS.length;
    var pLo = Math.max(pitch0 * 0.94, minP), pHi = Math.min(pitch0 * 1.06, maxP);
    if (pHi < pLo) pHi = pLo;
    var step = Math.max(0.8 * pitch0 / n, 1e-4);
    var nSteps = Math.ceil((pHi - pLo) / step) + 1;
    var nPh = Math.ceil(pHi / 0.5 - 1e-9);
    var best = { p: pLo, ph: 0, s: -Infinity };
    for (var si = 0; si < nSteps; si++) {
      var p = pLo + si * step;
      for (var phj = 0; phj < nPh; phj++) {
        var s = combEnergyScore(profS, p, phj * 0.5, total);
        if (s > best.s) best = { p: p, ph: phj * 0.5, s: s };
      }
    }
    return best;
  }

  function combBestPeriod(profile, minP, maxP) {
    var n = profile.length;
    if (minP < 1 || maxP < minP) return { pitch: 0, phase: 0, confidence: 0 };
    if (n < 4 * minP || n < 8) return { pitch: 0, phase: 0, confidence: 0 };
    var profS = M.gaussianFilter1d(profile, 0.5);
    var total = M.sum(profS);
    if (total <= 1e-12) return { pitch: 0, phase: 0, confidence: 0 };
    var pitches = [], p = minP;
    while (p <= maxP + 1e-9) { pitches.push(p); p *= 1.02; }
    if (!pitches.length) return { pitch: 0, phase: 0, confidence: 0 };
    var coarse = new Array(pitches.length);
    for (var i = 0; i < pitches.length; i++) coarse[i] = combSegCoarseScore(profS, total, pitches[i]);
    var order = coarse.map(function (v, i) { return i; }).sort(function (a, b) { return coarse[b] - coarse[a]; });
    var picked = [];
    for (var oi = 0; oi < order.length; oi++) {
      var idx = order[oi], pi = pitches[idx], ok = true;
      for (var q = 0; q < picked.length; q++) {
        var qp = pitches[picked[q]];
        if (Math.abs(pi - qp) / Math.max(pi, qp) < 0.08) { ok = false; break; }
      }
      if (ok) { picked.push(idx); if (picked.length >= 3) break; }
    }
    if (!picked.length) return { pitch: 0, phase: 0, confidence: 0 };
    var refined = [];
    for (var pi2 = 0; pi2 < picked.length; pi2++) {
      var idx2 = picked[pi2];
      var fine = combFineGridSearch(profS, total, pitches[idx2], minP, maxP);
      var pCur = fine.p, phCur = fine.ph, sCur = fine.s;
      var dp = Math.max(2 * 0.8 * pCur / n, 0.002), dph = 0.25;
      for (var round = 0; round < 8; round++) {
        var bp = pCur, bph = phCur, bs = sCur;
        for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) {
          var pc = pCur + a * dp, phc = phCur + b * dph;
          if (pc < minP || pc > maxP) continue;
          var phw = ((phc % pc) + pc) % pc;
          var s = combEnergyScore(profS, pc, phw, total);
          if (s > bs) { bp = pc; bph = phw; bs = s; }
        }
        pCur = bp; phCur = bph; sCur = bs;
        dp = Math.max(dp * 0.5, 0.002); dph = Math.max(dph * 0.5, 0.1);
      }
      if (sCur >= 0.5 * coarse[idx2]) refined.push({ p: pCur, ph: phCur, s: sCur });
    }
    if (!refined.length) return { pitch: 0, phase: 0, confidence: 0 };
    var best = refined[0];
    for (var ri = 1; ri < refined.length; ri++) if (refined[ri].s > best.s) best = refined[ri];
    var tie = refined.filter(function (t) { return t.s >= best.s / 1.15; });
    var sel = tie[0];
    for (var ti = 1; ti < tie.length; ti++) if (tie[ti].p > sel.p) sel = tie[ti];
    var pInt = Math.round(sel.p);
    if (minP <= pInt && pInt <= maxP) {
      var sInt = combEnergyScore(profS, pInt, ((sel.ph % pInt) + pInt) % pInt, total);
      if (sInt >= 0.97 * sel.s) { sel.p = pInt; sel.s = sInt; }
    }
    var second = null;
    for (var ri2 = 0; ri2 < refined.length; ri2++) {
      var t = refined[ri2];
      if (t === sel || combSameFamily(sel.p, t.p)) continue;
      if (second === null || t.s > second) second = t.s;
    }
    var quality = M.clamp(sel.s, 0, 1);
    var separation = second === null ? 1 : M.clamp((sel.s - second) / Math.max(Math.abs(sel.s), 1e-9), 0, 1);
    return { pitch: sel.p, phase: sel.ph, confidence: quality * separation };
  }

  function combTopPitches(profile, minP, maxP, topN) {
    var n = profile.length;
    if (minP < 1 || maxP < minP || topN < 1) return [];
    if (n < 4 * minP || n < 8) return [];
    var profS = M.gaussianFilter1d(profile, 0.5);
    var total = M.sum(profS);
    if (total <= 1e-12) return [];
    var pitches = [], p = minP;
    while (p <= maxP + 1e-9) { pitches.push(p); p *= 1.02; }
    if (!pitches.length) return [];
    var coarse = new Array(pitches.length);
    for (var i = 0; i < pitches.length; i++) coarse[i] = combSegCoarseScore(profS, total, pitches[i]);
    var order = coarse.map(function (v, i) { return i; }).sort(function (a, b) { return coarse[b] - coarse[a]; });
    var picked = [];
    for (var oi = 0; oi < order.length; oi++) {
      var idx = order[oi], pi = pitches[idx], ok = true;
      for (var q = 0; q < picked.length; q++) {
        var qp = pitches[picked[q]];
        if (Math.abs(pi - qp) / Math.max(pi, qp) < 0.08) { ok = false; break; }
      }
      if (ok) { picked.push(idx); if (picked.length >= topN) break; }
    }
    var out = [];
    for (var pi2 = 0; pi2 < picked.length; pi2++) {
      var idx2 = picked[pi2];
      var fine = combFineGridSearch(profS, total, pitches[idx2], minP, maxP);
      if (fine.p > 0 && fine.s >= 0.5 * coarse[idx2]) out.push(fine.p);
      else out.push(pitches[idx2]);
    }
    return out;
  }

  global.AiPixelComb = {
    combEnergyScore: combEnergyScore, combSameFamily: combSameFamily,
    combBestPeriod: combBestPeriod, combTopPitches: combTopPitches
  };
})(typeof window !== "undefined" ? window : this);
