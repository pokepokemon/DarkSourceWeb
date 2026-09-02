/** 伪像素规整 — 网格检测：边缘引导扩展 + 全局正则化 */
(function (global) {
  "use strict";
  var M = global.AiPixelMath;
  var Ph = global.AiPixelPhase;

  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function fitGlobalRegularization(coords, counts, N, cols, period, minG, regularityStrength, outlierReject, limit) {
    if (regularityStrength <= 0 || cols < 2) return coords;
    var fitW = counts.slice();
    if (cols >= 2) {
      for (var i = 0; i < N; i++) for (var j = 0; j < cols - 1; j++) {
        var dev = Math.abs(coords[i * cols + j + 1] - coords[i * cols + j] - period);
        if (dev > outlierReject * period) { fitW[i * cols + j] = 0; fitW[i * cols + j + 1] = 0; }
      }
    }
    var validTotal = 0, validW = 0;
    var residualsSum = 0, wSum = 0;
    for (var i2 = 0; i2 < N; i2++) for (var j2 = 0; j2 < cols; j2++) {
      var w = fitW[i2 * cols + j2];
      if (w > 0) {
        var idx = minG + j2;
        residualsSum += (coords[i2 * cols + j2] - idx * period) * w;
        wSum += w;
        validTotal++;
      }
    }
    var out = new Float32Array(N * cols);
    if (validTotal === 0) {
      for (var i3 = 0; i3 < N; i3++) { out[i3 * cols] = coords[i3 * cols]; for (var j3 = 1; j3 < cols; j3++) out[i3 * cols + j3] = out[i3 * cols] + j3 * period; }
      return out;
    }
    var globalPhase = residualsSum / wSum;
    for (var i4 = 0; i4 < N; i4++) for (var j4 = 0; j4 < cols; j4++) {
      var gm = globalPhase + (minG + j4) * period;
      var ww = Math.min(1, counts[i4 * cols + j4] / 4) * (1 - regularityStrength);
      var blended = coords[i4 * cols + j4] * ww + gm * (1 - ww);
      blended = M.clamp(blended, -period, limit + period);
      out[i4 * cols + j4] = blended;
    }
    var minSpacing = 0.3 * period;
    for (var i5 = 0; i5 < N; i5++) for (var j5 = 1; j5 < cols; j5++) {
      if (out[i5 * cols + j5] < out[i5 * cols + j5 - 1] + minSpacing) out[i5 * cols + j5] = out[i5 * cols + j5 - 1] + minSpacing;
    }
    return out;
  }

  function expandGridEdgeGuided(edgeMap, h, w, placed, bounds, px, py, edgeTol, subpixel, smoothStrength, outlierReject) {
    var minGx = bounds.minGx, maxGx = bounds.maxGx, minGy = bounds.minGy, maxGy = bounds.maxGy;
    var wLogic = maxGx - minGx + 1, hLogic = maxGy - minGy + 1;
    var keys = Object.keys(placed);
    if (!keys.length) {
      return Ph.equidistantCellGrid(0, 0, px, py, wLogic, hLogic);
    }
    var weights = {};
    for (var k0 = 0; k0 < keys.length; k0++) weights[keys[k0]] = 1;
    var seed = placed["0,0"];
    var seedX0 = seed ? seed[1] : 0, seedY0 = seed ? seed[0] : 0;
    function parseKey(key) { var s = key.split(","); return [+s[0], +s[1]]; }
    var queue = [];
    for (var k1 = 0; k1 < keys.length; k1++) { var p = parseKey(keys[k1]); queue.push(p); }
    var head = 0;
    while (head < queue.length) {
      var cur = queue[head++], gx = cur[0], gy = cur[1];
      var cell = placed[gx + "," + gy];
      var cy0 = cell[0], cx0 = cell[1], cy1 = cell[2], cx1 = cell[3];
      var iy0 = cy0 | 0, iy1 = cy1 | 0, ix0 = cx0 | 0, ix1 = cx1 | 0;
      for (var d = 0; d < 4; d++) {
        var dx = DIRS[d][0], dy = DIRS[d][1];
        var ngx = gx + dx, ngy = gy + dy;
        if (ngx < minGx || ngx > maxGx || ngy < minGy || ngy > maxGy) continue;
        var ngKey = ngx + "," + ngy;
        if (placed[ngKey]) continue;
        if (dx === 1) {
          var bc = Ph.bestCol(edgeMap, h, w, iy0, iy1, cx1, edgeTol, subpixel);
          var nx0 = bc.pos !== null ? bc.pos : cx1;
          weights[ngKey] = bc.pos !== null ? Math.max(0, bc.peak) : 1;
          placed[ngKey] = [cy0, nx0, cy1, nx0 + px];
        } else if (dx === -1) {
          var bc2 = Ph.bestCol(edgeMap, h, w, iy0, iy1, cx0, edgeTol, subpixel);
          var nx1 = bc2.pos !== null ? bc2.pos : cx0;
          weights[ngKey] = bc2.pos !== null ? Math.max(0, bc2.peak) : 1;
          placed[ngKey] = [cy0, nx1 - px, cy1, nx1];
        } else if (dy === 1) {
          var br = Ph.bestRow(edgeMap, h, w, ix0, ix1, cy1, edgeTol, subpixel);
          var ny0 = br.pos !== null ? br.pos : cy1;
          weights[ngKey] = br.pos !== null ? Math.max(0, br.peak) : 1;
          placed[ngKey] = [ny0, cx0, ny0 + py, cx1];
        } else {
          var br2 = Ph.bestRow(edgeMap, h, w, ix0, ix1, cy0, edgeTol, subpixel);
          var ny1 = br2.pos !== null ? br2.pos : cy0;
          weights[ngKey] = br2.pos !== null ? Math.max(0, br2.peak) : 1;
          placed[ngKey] = [ny1 - py, cx0, ny1, cx1];
        }
        queue.push([ngx, ngy]);
      }
    }
    for (var gy2 = minGy; gy2 <= maxGy; gy2++) for (var gx2 = minGx; gx2 <= maxGx; gx2++) {
      var key3 = gx2 + "," + gy2;
      if (!placed[key3]) { placed[key3] = [seedY0 + gy2 * py, seedX0 + gx2 * px, seedY0 + (gy2 + 1) * py, seedX0 + (gx2 + 1) * px]; weights[key3] = 1; }
    }
    var yObs = {}, xObs = {};
    var allKeys = Object.keys(placed);
    for (var k2 = 0; k2 < allKeys.length; k2++) {
      var key = allKeys[k2], pp = parseKey(key), gx3 = pp[0], gy3 = pp[1];
      var cell2 = placed[key], wgt = weights[key] || 1;
      var jj = gy3 - minGy, ii = gx3 - minGx;
      var y0 = cell2[0], x0 = cell2[1], y1 = cell2[2], x1 = cell2[3];
      (yObs[jj + "," + ii] = yObs[jj + "," + ii] || []).push([y0, wgt]);
      (xObs[jj + "," + ii] = xObs[jj + "," + ii] || []).push([x0, wgt]);
      (yObs[(jj + 1) + "," + ii] = yObs[(jj + 1) + "," + ii] || []).push([y1, wgt]);
      (xObs[jj + "," + (ii + 1)] = xObs[jj + "," + (ii + 1)] || []).push([x1, wgt]);
    }
    var cellYs = new Float32Array((hLogic + 1) * (wLogic + 1));
    var cellXs = new Float32Array((hLogic + 1) * (wLogic + 1));
    var ysCnt = new Float32Array((hLogic + 1) * (wLogic + 1));
    var xsCnt = new Float32Array((hLogic + 1) * (wLogic + 1));
    for (var key4 in yObs) {
      var pp2 = parseKey(key4), jj2 = pp2[0], ii2 = pp2[1];
      if (jj2 >= 0 && jj2 <= hLogic && ii2 >= 0 && ii2 <= wLogic) {
        ysCnt[jj2 * (wLogic + 1) + ii2] = yObs[key4].length;
        cellYs[jj2 * (wLogic + 1) + ii2] = Ph.weightedMedian(yObs[key4]);
      }
    }
    for (var key5 in xObs) {
      var pp3 = parseKey(key5), jj3 = pp3[0], ii3 = pp3[1];
      if (jj3 >= 0 && jj3 <= hLogic && ii3 >= 0 && ii3 <= wLogic) {
        xsCnt[jj3 * (wLogic + 1) + ii3] = xObs[key5].length;
        cellXs[jj3 * (wLogic + 1) + ii3] = Ph.weightedMedian(xObs[key5]);
      }
    }
    for (var jj4 = 0; jj4 <= hLogic; jj4++) for (var ii4 = 0; ii4 <= wLogic; ii4++) {
      if (ysCnt[jj4 * (wLogic + 1) + ii4] === 0) cellYs[jj4 * (wLogic + 1) + ii4] = seedY0 + (jj4 + minGy) * py;
      if (xsCnt[jj4 * (wLogic + 1) + ii4] === 0) cellXs[jj4 * (wLogic + 1) + ii4] = seedX0 + (ii4 + minGx) * px;
    }
    if (smoothStrength > 0) {
      var rx = fitGlobalRegularization(cellXs, xsCnt, hLogic + 1, wLogic + 1, px, minGx, smoothStrength, outlierReject, w);
      // y 轴转置
      var N = wLogic + 1, MM = hLogic + 1;
      var cyT = new Float32Array(N * MM), cntT = new Float32Array(N * MM);
      for (var jj5 = 0; jj5 <= hLogic; jj5++) for (var ii5 = 0; ii5 <= wLogic; ii5++) {
        cyT[ii5 * MM + jj5] = cellYs[jj5 * (wLogic + 1) + ii5];
        cntT[ii5 * MM + jj5] = ysCnt[jj5 * (wLogic + 1) + ii5];
      }
      var ryT = fitGlobalRegularization(cyT, cntT, N, MM, py, minGy, smoothStrength, outlierReject, h);
      for (var jj6 = 0; jj6 <= hLogic; jj6++) for (var ii6 = 0; ii6 <= wLogic; ii6++) {
        cellYs[jj6 * (wLogic + 1) + ii6] = ryT[ii6 * MM + jj6];
      }
      cellXs = rx;
    }
    return { cellYs: cellYs, cellXs: cellXs };
  }

  global.AiPixelExpand = { expandGridEdgeGuided: expandGridEdgeGuided };
})(typeof window !== "undefined" ? window : this);
