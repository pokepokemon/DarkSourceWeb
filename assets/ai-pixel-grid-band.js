/** 伪像素规整 — 网格检测：积分图判据（2D BVR / 边界带强度 / 边界格心比） */
(function (global) {
  "use strict";
  var M = global.AiPixelMath;

  function defaultPhases(p) { return [0, p / 4, p / 2, 3 * p / 4]; }

  // 边界带 1px 平均边缘强度（axis=0 水平边界/y 周期，axis=1 垂直边界/x 周期）
  function edgeBandStrength(em, h, w, period, axis, phases, integral) {
    if (period < 1) return 0;
    var I = integral || M.integralImage(em, h, w);
    var phs = phases || defaultPhases(period);
    var best = 0;
    for (var pi = 0; pi < phs.length; pi++) {
      var phase = phs[pi];
      if (axis === 1) {
        var n = Math.floor((w - phase) / period);
        if (n < 2) continue;
        var total = 0, count = 0;
        for (var m = 0; m <= n; m++) {
          var x0 = Math.round(phase + m * period), x1 = x0 + 1;
          if (x0 >= 0 && x1 <= w) { total += M.integralSum(I, w, 0, h, x0, x1); count++; }
        }
        if (count > 0) best = Math.max(best, total / count);
      } else {
        var n2 = Math.floor((h - phase) / period);
        if (n2 < 2) continue;
        var total2 = 0, count2 = 0;
        for (var m2 = 0; m2 <= n2; m2++) {
          var y0 = Math.round(phase + m2 * period), y1 = y0 + 1;
          if (y0 >= 0 && y1 <= h) { total2 += M.integralSum(I, w, y0, y1, 0, w); count2++; }
        }
        if (count2 > 0) best = Math.max(best, total2 / count2);
      }
    }
    return best;
  }

  // 边界/格心边缘能量比
  function boundaryInteriorRatio(em, h, w, period, axis, phases, integral) {
    if (period < 2) return 0;
    var I = integral || M.integralImage(em, h, w);
    var phs = phases || defaultPhases(period);
    var len = axis === 1 ? w : h;
    var best = 0, hasData = false;
    for (var pi = 0; pi < phs.length; pi++) {
      var phase = phs[pi];
      var n = Math.floor((len - phase) / period);
      if (n < 2) continue;
      var bt = 0, it = 0, bc = 0, ic = 0;
      for (var m = 0; m <= n; m++) {
        var b0 = Math.round(phase + m * period), b1 = b0 + 1;
        var c0 = Math.round(phase + (m + 0.5) * period), c1 = c0 + 1;
        if (axis === 1) {
          if (b0 >= 0 && b1 <= w) { bt += M.integralSum(I, w, 0, h, b0, b1); bc++; }
          if (c0 >= 0 && c1 <= w) { it += M.integralSum(I, w, 0, h, c0, c1); ic++; }
        } else {
          if (b0 >= 0 && b1 <= h) { bt += M.integralSum(I, w, b0, b1, 0, w); bc++; }
          if (c0 >= 0 && c1 <= h) { it += M.integralSum(I, w, c0, c1, 0, w); ic++; }
        }
      }
      if (bc > 0 && ic > 0) {
        var bm = bt / bc, im = it / ic;
        var ratio = bm / Math.max(im, 1e-9);
        best = Math.max(best, ratio);
        hasData = true;
      }
    }
    return hasData ? best : 0;
  }

  // 2D 真块方差对比度（块间方差/块内方差），相位扫描
  function blockVarianceRatio(gray, h, w, period, integral, integralSq) {
    if (period < 1 || h < period * 2 || w < period * 2) return 0;
    var p_i = Math.round(period);
    if (p_i < 1) return 0;
    var I = integral || M.integralImage(gray, h, w);
    var I2 = integralSq;
    if (!I2) { var g2 = new Float32Array(h * w); for (var i = 0; i < g2.length; i++) g2[i] = gray[i] * gray[i]; I2 = M.integralImage(g2, h, w); }
    var area = p_i * p_i;
    var step = Math.max(1, (p_i / 4) | 0);
    var best = 0;
    for (var py0 = 0; py0 < p_i; py0 += step) {
      var nY = Math.floor((h - py0) / p_i);
      if (nY < 2) continue;
      for (var px0 = 0; px0 < p_i; px0 += step) {
        var nX = Math.floor((w - px0) / p_i);
        if (nX < 2) continue;
        var means = [], sqMeans = [];
        for (var by = 0; by < nY; by++) for (var bx = 0; bx < nX; bx++) {
          var y0 = py0 + by * p_i, y1 = y0 + p_i;
          var x0 = px0 + bx * p_i, x1 = x0 + p_i;
          var s = M.integralSum(I, w, y0, y1, x0, x1);
          var sq = M.integralSum(I2, w, y0, y1, x0, x1);
          means.push(s / area); sqMeans.push(sq / area);
        }
        var withinVals = [];
        for (var vi = 0; vi < means.length; vi++) withinVals.push(sqMeans[vi] - means[vi] * means[vi]);
        var within = M.mean(withinVals), between = M.var(means);
        var ratio = within < 1e-12 ? (between < 1e-12 ? 0 : 1e6) : between / within;
        if (ratio > best) best = ratio;
      }
    }
    return best;
  }

  global.AiPixelBand = {
    edgeBandStrength: edgeBandStrength, boundaryInteriorRatio: boundaryInteriorRatio, blockVarianceRatio: blockVarianceRatio
  };
})(typeof window !== "undefined" ? window : this);
