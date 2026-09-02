/** 伪像素规整 — 网格检测：FFT/ACF/谐波梳 判据 */
(function (global) {
  "use strict";
  var M = global.AiPixelMath;

  // 1D FFT 带通信噪比：返回 { snr, period }
  function fftBandSnr(sig, minP, maxP) {
    var n = sig.length;
    var mn = M.mean(sig);
    var s = new Float32Array(n), ss = 0;
    for (var i = 0; i < n; i++) { s[i] = sig[i] - mn; ss += s[i] * s[i]; }
    if (Math.sqrt(ss / n) < 1e-6) return { snr: 0, period: 0 };
    var r = M.rfftMag(s), mag = r.mag, N = r.N;
    var half = mag.length;
    var kLo = Math.ceil(N / maxP), kHi = Math.floor(N / minP);
    if (kLo < 1) kLo = 1;
    if (kHi > half - 1) kHi = half - 1;
    if (kLo > kHi) return { snr: 0, period: 0 };
    // 带内找峰（local maxima，score = max(left-climb, right-fall)）
    var cand = [];
    for (var k = kLo; k <= kHi; k++) {
      if (k === kLo || k === kHi) {
        var isP = (k === kLo && mag[k] > mag[k + 1]) || (k === kHi && mag[k] > mag[k - 1]);
        if (!isP) continue;
      } else if (!(mag[k] > mag[k - 1] && mag[k] > mag[k + 1])) continue;
      var amp = mag[k];
      var lc = 0, kk = k;
      while (kk > kLo && mag[kk] > mag[kk - 1]) { lc = amp - mag[kk - 1]; kk--; }
      var rf = 0; kk = k;
      while (kk < kHi && mag[kk] > mag[kk + 1]) { rf = amp - mag[kk + 1]; kk++; }
      cand.push({ k: k, amp: amp, score: Math.max(lc, rf) });
    }
    var peakK;
    if (!cand.length) {
      var m = -1;
      for (var k2 = kLo; k2 <= kHi; k2++) if (mag[k2] > m) { m = mag[k2]; peakK = k2; }
    } else {
      var best = cand[0];
      for (var i2 = 1; i2 < cand.length; i2++) {
        var c = cand[i2];
        if (c.score > best.score || (c.score === best.score && c.amp > best.amp)) best = c;
      }
      peakK = best.k;
    }
    var peakAmp = mag[peakK];
    var band = [];
    for (var k3 = kLo; k3 <= kHi; k3++) band.push(mag[k3]);
    var medianAmp = M.median(band);
    var snr = medianAmp <= 1e-12 ? (peakAmp <= 1e-12 ? 0 : 1e6) : (peakAmp / medianAmp) * (peakAmp / medianAmp);
    // 抛物线插值
    var period;
    if (peakK > 0 && peakK < half - 1) {
      var y0 = mag[peakK - 1], y1 = mag[peakK], y2 = mag[peakK + 1];
      var den = y0 - 2 * y1 + y2;
      if (Math.abs(den) > 1e-12) {
        var off = 0.5 * (y0 - y2) / den;
        var fk = peakK + off;
        if (fk > 0) period = N / fk; else period = N / peakK;
      } else period = N / peakK;
    } else period = N / peakK;
    return { snr: snr, period: period };
  }

  // 自相关周期：返回 { peaks(降序), acf }
  function acfPeriod(profile, minP, maxP) {
    var n = profile.length;
    if (n < 4) return { peaks: [], acf: new Float32Array(0) };
    var mn = M.mean(profile);
    var sig = new Float32Array(n);
    for (var i = 0; i < n; i++) sig[i] = profile[i] - mn;
    var acf = M.acf(sig);
    var peaks = [];
    for (var p = minP; p <= Math.min(maxP, n - 1); p++) {
      if (p < 1) continue;
      var isPeak = true;
      for (var d = -1; d <= 1; d++) {
        var idx = p + d;
        if (idx >= 0 && idx < n && idx !== p && acf[idx] >= acf[p]) { isPeak = false; break; }
      }
      if (isPeak && acf[p] > 0) peaks.push(p);
    }
    peaks.sort(function (a, b) { return acf[b] - acf[a]; });
    return { peaks: peaks, acf: acf };
  }

  // 谐波解释基频
  function harmonicInterpret(peaks, tol) {
    tol = tol === undefined ? 0.1 : tol;
    if (!peaks.length) return 0;
    if (peaks.length === 1) return peaks[0];
    var bestBase = peaks[0], bestExplained = 1;
    for (var i = 0; i < peaks.length; i++) {
      var base = peaks[i], explained = 1;
      for (var j = 0; j < peaks.length; j++) {
        if (peaks[j] === base) continue;
        var ratio = peaks[j] / base, near = Math.round(ratio);
        if (near >= 2 && Math.abs(ratio - near) / near < tol) explained++;
      }
      if (explained > bestExplained) { bestExplained = explained; bestBase = base; }
    }
    return bestBase;
  }

  // 谐波梳能量得分
  function spectralCombScore(profile, period, nHarmonics) {
    nHarmonics = nHarmonics === undefined ? 8 : nHarmonics;
    var n = profile.length;
    if (n < 8 || period < 1) return 0;
    var mn = M.mean(profile);
    var sig = new Float32Array(n);
    for (var i = 0; i < n; i++) sig[i] = profile[i] - mn;
    var r = M.rfftMag(sig), spec = r.mag, N = r.N;
    var total = 0;
    for (var k = 1; k <= nHarmonics; k++) {
      var f = k / period;
      var idx = f * N;
      var i0 = Math.floor(idx), i1 = i0 + 1;
      if (i1 >= spec.length) break;
      total += spec[i0] * (1 - (idx - i0)) + spec[i1] * (idx - i0);
    }
    if (total <= 1e-15) return 0;
    var rest = [];
    for (var i2 = 1; i2 < spec.length; i2++) rest.push(spec[i2]);
    var med = M.median(rest);
    return total / Math.max(med * 8, 1e-9);
  }

  // comb 前 topN 候选周期
  function combCandidatePeriods(profile, minP, maxP, topN) {
    var scored = [];
    for (var p = Math.max(minP, 1); p <= maxP; p++) {
      var s = spectralCombScore(profile, p);
      if (s > 0) scored.push({ p: p, s: s });
    }
    scored.sort(function (a, b) { return b.s - a.s; });
    var out = [];
    for (var i = 0; i < Math.min(topN, scored.length); i++) out.push([scored[i].p, scored[i].s]);
    return out;
  }

  global.AiPixelFft = {
    fftBandSnr: fftBandSnr, acfPeriod: acfPeriod, harmonicInterpret: harmonicInterpret,
    spectralCombScore: spectralCombScore, combCandidatePeriods: combCandidatePeriods
  };
})(typeof window !== "undefined" ? window : this);
