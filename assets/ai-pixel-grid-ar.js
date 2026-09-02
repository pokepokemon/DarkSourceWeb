/** 伪像素规整 — 网格检测：长宽比守恒防护（S1 联合再搜索） */
(function (global) {
  "use strict";
  var Fft = global.AiPixelFft;
  var Band = global.AiPixelBand;
  var Comb = global.AiPixelComb;

  function arJointPick(candsX, candsY, W, H, edgeMap, h, w, edgeIntegral, curPx, curPy) {
    var ratioOrig = W / H;
    var infoX = [], infoY = [];
    for (var i = 0; i < candsX.length; i++) {
      var px = candsX[i];
      if (px <= 0) continue;
      infoX.push([px, Math.round(W / px), Band.edgeBandStrength(edgeMap, h, w, px, 1, null, edgeIntegral)]);
    }
    for (var j = 0; j < candsY.length; j++) {
      var py = candsY[j];
      if (py <= 0) continue;
      infoY.push([py, Math.round(H / py), Band.edgeBandStrength(edgeMap, h, w, py, 0, null, edgeIntegral)]);
    }
    if (!infoX.length || !infoY.length) return null;
    var eCur = Band.edgeBandStrength(edgeMap, h, w, curPx, 1, null, edgeIntegral) + Band.edgeBandStrength(edgeMap, h, w, curPy, 0, null, edgeIntegral);
    var bestKey = null, bestPx = 0, bestPy = 0, bestESum = 0;
    for (var a = 0; a < infoX.length; a++) for (var b = 0; b < infoY.length; b++) {
      var wEst = infoX[a][1], hEst = infoY[b][1];
      if (wEst < 1 || hEst < 1) continue;
      var arDiff = Math.abs(wEst / hEst - ratioOrig) / ratioOrig;
      if (arDiff >= 0.03) continue;
      var key0 = Math.round(arDiff / 0.005), key1 = -(infoX[a][2] + infoY[b][2]);
      if (bestKey === null || key0 < bestKey[0] || (key0 === bestKey[0] && key1 < bestKey[1])) {
        bestKey = [key0, key1]; bestPx = infoX[a][0]; bestPy = infoY[b][0]; bestESum = infoX[a][2] + infoY[b][2];
      }
    }
    if (bestKey === null) return null;
    if (bestESum >= 0.8 * eCur) return [bestPx, bestPy];
    return null;
  }

  function arJointResearch(sigX, sigY, W, H, curPx, curPy, edgeMap, h, w, minP, maxP, edgeIntegral, votePx, votePy) {
    var lo = Math.max(minP, 3), hi = maxP;
    function axisRaw(sig, curP, voteP) {
      var raw = {};
      if (curP > 0) raw[curP] = true;
      if (voteP > 0) raw[voteP] = true;
      var f = Fft.fftBandSnr(sig, minP, maxP);
      if (f.period > 0) raw[f.period] = true;
      var acf = Fft.acfPeriod(sig, minP, maxP);
      for (var i = 0; i < Math.min(5, acf.peaks.length); i++) raw[acf.peaks[i]] = true;
      var comb = Comb.combTopPitches(sig, minP, maxP, 5);
      for (var j = 0; j < comb.length; j++) if (comb[j] > 0) raw[comb[j]] = true;
      return raw;
    }
    function expand(raw) {
      var out = {};
      for (var c in raw) {
        var v = +c;
        var list = [v, 2 * v, 0.5 * v];
        for (var i = 0; i < 3; i++) if (list[i] >= lo && list[i] <= hi) out[Math.round(list[i] * 10000) / 10000] = true;
      }
      return Object.keys(out).map(Number).sort(function (a, b) { return a - b; });
    }
    var rawX = axisRaw(sigX, curPx, votePx), rawY = axisRaw(sigY, curPy, votePy);
    var origX = {}, origY = {};
    for (var kx in rawX) origX[kx] = true;
    for (var ky in rawY) origY[ky] = true;
    for (var b2 in origY) for (var a2 in origX) {
      var bv = +b2, av = +a2;
      if (Math.abs(av - bv) / Math.max(av, bv) < 0.05) rawX[b2] = true;
    }
    for (var a3 in origX) for (var b3 in origY) {
      var av2 = +a3, bv2 = +b3;
      if (Math.abs(av2 - bv2) / Math.max(av2, bv2) < 0.05) rawY[a3] = true;
    }
    var candsX = expand(rawX), candsY = expand(rawY);
    if (!candsX.length || !candsY.length) return null;
    return arJointPick(candsX, candsY, W, H, edgeMap, h, w, edgeIntegral, curPx, curPy);
  }

  global.AiPixelAr = { arJointPick: arJointPick, arJointResearch: arJointResearch };
})(typeof window !== "undefined" ? window : this);
