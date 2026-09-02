/** 伪像素规整 — 网格检测：相位搜索 / 边缘搜索 / 加权中位数 / 等距网格 */
(function (global) {
  "use strict";
  var M = global.AiPixelMath;

  // 灰度块方差相位搜索
  function findPhase(gray, h, w, px, py, step) {
    var cum = M.integralImage(gray, h, w);
    var totalVar = M.var(gray), denom = totalVar > 1e-12 ? totalVar : 1;
    var bestPhaseX = 0, bestConfX = 0;
    var nPhX = Math.max(1, Math.round(px / step));
    for (var pi = 0; pi < nPhX; pi++) {
      var phaseX = px * pi / nPhX;
      var nBlocks = Math.floor((w - phaseX) / px);
      if (nBlocks < 2) continue;
      var means = [];
      for (var m = 0; m < nBlocks; m++) {
        var start = Math.floor(phaseX + m * px), end = Math.min(Math.floor(phaseX + (m + 1) * px), w);
        if (end <= start) continue;
        var area = (end - start) * h;
        if (area > 0) means.push(M.integralSum(cum, w, 0, h, start, end) / area);
      }
      if (means.length < 2) continue;
      var confX = M.var(means) / denom;
      if (confX > bestConfX) { bestConfX = confX; bestPhaseX = phaseX; }
    }
    var bestPhaseY = 0, bestConfY = 0;
    var nPhY = Math.max(1, Math.round(py / step));
    for (var pj = 0; pj < nPhY; pj++) {
      var phaseY = py * pj / nPhY;
      var nBlocks2 = Math.floor((h - phaseY) / py);
      if (nBlocks2 < 2) continue;
      var means2 = [];
      for (var m2 = 0; m2 < nBlocks2; m2++) {
        var start2 = Math.floor(phaseY + m2 * py), end2 = Math.min(Math.floor(phaseY + (m2 + 1) * py), h);
        if (end2 <= start2) continue;
        var area2 = (end2 - start2) * w;
        if (area2 > 0) means2.push(M.integralSum(cum, w, start2, end2, 0, w) / area2);
      }
      if (means2.length < 2) continue;
      var confY = M.var(means2) / denom;
      if (confY > bestConfY) { bestConfY = confY; bestPhaseY = phaseY; }
    }
    return { phaseX: bestPhaseX, phaseY: bestPhaseY, conf: Math.min(1, (bestConfX + bestConfY) / 2) };
  }

  // 边缘带能量相位搜索（oklab 模式）
  function findPhaseEdge(em, h, w, px, py, step) {
    if (px <= 0 || py <= 0) return { phaseX: 0, phaseY: 0, conf: 0 };
    var I = M.integralImage(em, h, w);
    var colSums = new Float32Array(w), rowSums = new Float32Array(h);
    for (var x = 0; x < w; x++) colSums[x] = M.integralSum(I, w, 0, h, x, x + 1);
    for (var y = 0; y < h; y++) rowSums[y] = M.integralSum(I, w, y, y + 1, 0, w);
    function scan(band, period) {
      var nPh = Math.max(1, Math.round(period / step));
      var best = 0, bestPh = 0;
      var scores = [];
      for (var pi = 0; pi < nPh; pi++) {
        var ph = period * pi / nPh;
        var n = Math.floor((band.length - ph) / period);
        if (n < 1) { scores.push(0); continue; }
        var s = 0;
        for (var m = 0; m <= n; m++) {
          var idx = Math.round(ph + m * period);
          if (idx >= 0 && idx < band.length) s += band[idx];
        }
        scores.push(s);
        if (s > best) { best = s; bestPh = ph; }
      }
      if (best <= 1e-12) return { ph: 0, conf: 0 };
      var med = M.median(scores);
      return { ph: bestPh, conf: M.clamp((best - med) / best, 0, 1) };
    }
    var rx = scan(colSums, px), ry = scan(rowSums, py);
    return { phaseX: rx.ph, phaseY: ry.ph, conf: (rx.conf + ry.conf) / 2 };
  }

  // 列边缘搜索（±tol，抛物线插值）
  function bestCol(em, h, w, y0, y1, xCenter, edgeTol, subpixel) {
    var xlo = Math.max(0, xCenter - edgeTol), xhi = Math.min(w, xCenter + edgeTol + 1);
    if (xhi <= xlo || y1 <= y0) return { pos: null, peak: null };
    var colSum = new Float32Array(xhi - xlo);
    for (var x2 = xlo; x2 < xhi; x2++) {
      var s = 0;
      for (var y = y0; y < y1; y++) s += em[y * w + x2];
      colSum[x2 - xlo] = s;
    }
    var thr = 0.03 * (y1 - y0);
    var bestIdx = M.argmax(colSum), peak = colSum[bestIdx];
    if (peak <= thr) return { pos: null, peak: null };
    if (!subpixel) return { pos: xlo + bestIdx, peak: peak };
    if (bestIdx > 0 && bestIdx < colSum.length - 1) {
      var den = colSum[bestIdx - 1] - 2 * colSum[bestIdx] + colSum[bestIdx + 1];
      if (Math.abs(den) > 1e-6) {
        var off = 0.5 * (colSum[bestIdx - 1] - colSum[bestIdx + 1]) / den;
        off = M.clamp(off, -1, 1);
        return { pos: xlo + bestIdx + off, peak: peak };
      }
    }
    return { pos: xlo + bestIdx, peak: peak };
  }

  // 行边缘搜索
  function bestRow(em, h, w, x0, x1, yCenter, edgeTol, subpixel) {
    var ylo = Math.max(0, yCenter - edgeTol), yhi = Math.min(h, yCenter + edgeTol + 1);
    if (yhi <= ylo || x1 <= x0) return { pos: null, peak: null };
    var rowSum = new Float32Array(yhi - ylo);
    for (var y = ylo; y < yhi; y++) {
      var s = 0;
      for (var x = x0; x < x1; x++) s += em[y * w + x];
      rowSum[y - ylo] = s;
    }
    var thr = 0.03 * (x1 - x0);
    var bestIdx = M.argmax(rowSum), peak = rowSum[bestIdx];
    if (peak <= thr) return { pos: null, peak: null };
    if (!subpixel) return { pos: ylo + bestIdx, peak: peak };
    if (bestIdx > 0 && bestIdx < rowSum.length - 1) {
      var den = rowSum[bestIdx - 1] - 2 * rowSum[bestIdx] + rowSum[bestIdx + 1];
      if (Math.abs(den) > 1e-6) {
        var off = 0.5 * (rowSum[bestIdx - 1] - rowSum[bestIdx + 1]) / den;
        off = M.clamp(off, -1, 1);
        return { pos: ylo + bestIdx + off, peak: peak };
      }
    }
    return { pos: ylo + bestIdx, peak: peak };
  }

  // 加权中位数
  function weightedMedian(obs) {
    if (!obs.length) return 0;
    if (obs.length === 1) return obs[0][0];
    var sorted = obs.slice().sort(function (a, b) { return a[0] - b[0]; });
    var total = 0;
    for (var i = 0; i < sorted.length; i++) total += sorted[i][1];
    if (total <= 0) return sorted[(sorted.length >> 1)][0];
    var cum = 0;
    for (var j = 0; j < sorted.length; j++) { cum += sorted[j][1]; if (cum >= 0.5 * total) return sorted[j][0]; }
    return sorted[sorted.length - 1][0];
  }

  // 等距网格
  function equidistantCellGrid(phaseX, phaseY, px, py, wLogic, hLogic) {
    var cellYs = new Float32Array((hLogic + 1) * (wLogic + 1));
    var cellXs = new Float32Array((hLogic + 1) * (wLogic + 1));
    for (var j = 0; j <= hLogic; j++) for (var i = 0; i <= wLogic; i++) {
      cellYs[j * (wLogic + 1) + i] = phaseY + j * py;
      cellXs[j * (wLogic + 1) + i] = phaseX + i * px;
    }
    return { cellYs: cellYs, cellXs: cellXs };
  }

  global.AiPixelPhase = {
    findPhase: findPhase, findPhaseEdge: findPhaseEdge, bestCol: bestCol, bestRow: bestRow,
    weightedMedian: weightedMedian, equidistantCellGrid: equidistantCellGrid
  };
})(typeof window !== "undefined" ? window : this);
