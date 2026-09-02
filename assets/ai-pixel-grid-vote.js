/** 伪像素规整 — 网格检测：多判据投票（_vote_period 移植） */
(function (global) {
  "use strict";
  var M = global.AiPixelMath;
  var Fft = global.AiPixelFft;
  var Band = global.AiPixelBand;

  var JPEG_PENALTY = { 7: 1, 8: 1, 9: 1, 15: 1, 16: 1, 17: 1, 23: 1, 24: 1, 25: 1 };
  var VOTE_BVR_LIMIT = 10;

  function votePeriod(gray, h, w, profile, minP, maxP, axis, edgeMap, combWeight, useCombPrefilter, edgeIntegral, grayIntegral, grayIntegralSq, jpegPenalty, useInteriorRatio) {
    var candidates = {};
    var snrFft = Fft.fftBandSnr(profile, minP, maxP);
    if (snrFft.period > 0) candidates[Math.round(snrFft.period)] = true;
    var acfRes = Fft.acfPeriod(profile, minP, maxP);
    var peaks = acfRes.peaks, acf = acfRes.acf;
    var peaksSet = {};
    for (var pi = 0; pi < peaks.length; pi++) { candidates[peaks[pi]] = true; peaksSet[peaks[pi]] = true; }
    if (peaks.length) { var base = Fft.harmonicInterpret(peaks); if (base > 0) candidates[base] = true; }
    if (edgeMap && (combWeight > 0 || useCombPrefilter)) {
      var combC = Fft.combCandidatePeriods(profile, minP, maxP, 5);
      for (var ci = 0; ci < combC.length; ci++) candidates[combC[ci][0]] = true;
    }
    var candList = Object.keys(candidates).map(Number).filter(function (c) { return c >= minP && c <= maxP; }).sort(function (a, b) { return a - b; });
    if (!candList.length) return { period: 0, confidence: 0 };

    var IEdge = edgeMap ? (edgeIntegral || M.integralImage(edgeMap, h, w)) : null;
    var IGray = grayIntegral, IGraySq = grayIntegralSq;
    if (edgeMap && (!IGray || !IGraySq)) {
      IGray = M.integralImage(gray, h, w);
      var g2 = new Float32Array(h * w);
      for (var i = 0; i < g2.length; i++) g2[i] = gray[i] * gray[i];
      IGraySq = M.integralImage(g2, h, w);
    }

    // 谱支撑（profile 频谱只算一次）
    var nProf = profile.length;
    var spec = null, N = 0, bandMax = 0;
    if (nProf > 0) {
      var mn = M.mean(profile);
      var pc = new Float32Array(nProf);
      for (var i2 = 0; i2 < nProf; i2++) pc[i2] = profile[i2] - mn;
      var r = M.rfftMag(pc);
      spec = r.mag; N = r.N;
      var kLo = Math.ceil(N / maxP), kHi = Math.floor(N / minP);
      if (kLo < 1) kLo = 1;
      if (kHi > spec.length - 1) kHi = spec.length - 1;
      for (var k = kLo; k <= kHi; k++) if (spec[k] > bandMax) bandMax = spec[k];
    }

    var scores = {};
    for (var ci2 = 0; ci2 < candList.length; ci2++) {
      var c = candList[ci2];
      var acfScore = (c < acf.length && acf[c] > 0) ? acf[c] : 0;
      var fftScore = 0;
      if (bandMax > 1e-12) {
        var pos = N / c;
        if (pos < 0) pos = 0; else if (pos > spec.length - 1) pos = spec.length - 1;
        var i0 = Math.floor(pos), i1 = Math.min(i0 + 1, spec.length - 1);
        var amp = spec[i0] + (spec[i1] - spec[i0]) * (pos - i0);
        fftScore = M.clamp(amp / bandMax, 0, 1);
      }
      var edge = 0;
      if (edgeMap) {
        edge = useInteriorRatio ? Band.boundaryInteriorRatio(edgeMap, h, w, c, axis, null, IEdge)
          : Band.edgeBandStrength(edgeMap, h, w, c, axis, null, IEdge);
      }
      if (jpegPenalty && JPEG_PENALTY[c]) edge *= 0.6;
      scores[c] = { acf: acfScore, fft: fftScore, bvr: 0, edge: edge, comb: 0 };
    }

    // 2D BVR 只对廉价判据前 10 名计算
    var cheapOrder = candList.slice().sort(function (a, b) {
      return -(0.4 * scores[b].acf + 0.3 * scores[b].fft + 0.3 * scores[b].edge) + (0.4 * scores[a].acf + 0.3 * scores[a].fft + 0.3 * scores[a].edge);
    });
    for (var ci3 = 0; ci3 < Math.min(VOTE_BVR_LIMIT, cheapOrder.length); ci3++) {
      var cc = cheapOrder[ci3];
      scores[cc].bvr = Band.blockVarianceRatio(gray, h, w, cc, IGray, IGraySq);
    }
    if (combWeight > 0) {
      for (var ci4 = 0; ci4 < candList.length; ci4++) scores[candList[ci4]].comb = Fft.spectralCombScore(profile, candList[ci4]);
    }

    // 归一化
    var maxBvr = 1e-12, maxEdge = 1e-12, maxComb = 1e-12;
    for (var ci5 = 0; ci5 < candList.length; ci5++) {
      var s = scores[candList[ci5]];
      if (s.bvr > maxBvr) maxBvr = s.bvr;
      if (s.edge > maxEdge) maxEdge = s.edge;
      if (s.comb > maxComb) maxComb = s.comb;
    }
    for (var ci6 = 0; ci6 < candList.length; ci6++) {
      var s2 = scores[candList[ci6]];
      s2.bvr /= maxBvr; s2.edge /= maxEdge; s2.comb /= maxComb;
    }

    // 加权求和
    var total = {}, ew = 0.4 * (1 - combWeight), cw = 0.4 * combWeight;
    for (var ci7 = 0; ci7 < candList.length; ci7++) {
      var cc2 = candList[ci7], s3 = scores[cc2];
      total[cc2] = 0.3 * s3.acf + 0.2 * s3.fft + 0.1 * s3.bvr + ew * s3.edge + cw * s3.comb;
    }
    var sortedC = candList.slice().sort(function (a, b) { return total[b] - total[a]; });
    var best = sortedC[0];

    // 置信度
    var ratio = sortedC.length >= 2 ? total[best] / Math.max(total[sortedC[1]], 1e-6) : 2;
    var sBest = scores[best];
    var consistent = 0;
    if (sBest.acf > 0.3) consistent++;
    if (sBest.fft > 0.3) consistent++;
    if (sBest.bvr > 0.3) consistent++;
    if (sBest.edge > 0.3) consistent++;
    var conf = Math.min(1, ratio / 2) * (consistent / 4);

    // 子谐波修正 k=2..6
    var cur = best, eRatioUsed = 0;
    while (true) {
      var newBest = cur;
      for (var k = 2; k <= 6; k++) {
        var kp = cur * k;
        if (!(minP <= kp && kp <= maxP) || !peaksSet[kp]) continue;
        if (!scores[kp]) {
          var kpEdge = Band.edgeBandStrength(edgeMap, h, w, kp, axis, null, IEdge);
          if (jpegPenalty && JPEG_PENALTY[kp]) kpEdge *= 0.6;
          scores[kp] = {
            acf: (kp < acf.length && acf[kp] > 0) ? acf[kp] : 0,
            fft: 0,
            bvr: Band.blockVarianceRatio(gray, h, w, kp, IGray, IGraySq) / maxBvr,
            edge: kpEdge / maxEdge,
            comb: combWeight > 0 ? Fft.spectralCombScore(profile, kp) / maxComb : 0
          };
        }
        var eRatio = scores[cur].edge > 1e-12 ? scores[kp].edge / scores[cur].edge : 0;
        if (eRatio > 1.3) {
          var support = scores[kp].acf > scores[cur].acf || (scores[cur].bvr > 0 && scores[kp].bvr > scores[cur].bvr);
          var combOk = true;
          if (useCombPrefilter && combWeight > 0) combOk = scores[kp].comb > 1.2 * scores[cur].comb;
          if (support && combOk) { newBest = kp; eRatioUsed = eRatio; break; }
        }
      }
      if (newBest === cur) break;
      cur = newBest;
    }
    if (cur !== best) conf = Math.min(1, conf * (1 + 0.3 * Math.min(Math.max(eRatioUsed - 1.3, 0), 1)));
    return { period: cur, confidence: conf };
  }

  global.AiPixelVote = { votePeriod: votePeriod };
})(typeof window !== "undefined" ? window : this);
