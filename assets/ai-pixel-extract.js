/** 伪像素规整 — 块提取（5 种代表色 + alpha 占比）+ K-means 调色板量化 */
(function (global) {
  "use strict";
  var M = global.AiPixelMath;
  var C = global.AiPixelColor;

  function medianRep(pixels) {
    var n = pixels.length, out = [0, 0, 0];
    for (var c = 0; c < 3; c++) {
      var arr = new Float32Array(n);
      for (var i = 0; i < n; i++) arr[i] = pixels[i][c];
      out[c] = M.median(arr);
    }
    return out;
  }
  function meanRep(pixels) {
    var s = [0, 0, 0];
    for (var i = 0; i < pixels.length; i++) for (var c = 0; c < 3; c++) s[c] += pixels[i][c];
    return [s[0] / pixels.length, s[1] / pixels.length, s[2] / pixels.length];
  }
  function modeRep(pixels) {
    var map = {}, bestKey = null, bestCnt = 0;
    for (var i = 0; i < pixels.length; i++) {
      var q = (Math.round(pixels[i][0] / 32) * 64 + Math.round(pixels[i][1] / 32) * 8 + Math.round(pixels[i][2] / 32));
      map[q] = (map[q] || 0) + 1;
      if (map[q] > bestCnt) { bestCnt = map[q]; bestKey = q; }
    }
    var s = [0, 0, 0], cnt = 0;
    for (var j = 0; j < pixels.length; j++) {
      var q2 = (Math.round(pixels[j][0] / 32) * 64 + Math.round(pixels[j][1] / 32) * 8 + Math.round(pixels[j][2] / 32));
      if (q2 === bestKey) { s[0] += pixels[j][0]; s[1] += pixels[j][1]; s[2] += pixels[j][2]; cnt++; }
    }
    if (cnt > 0) return [s[0] / cnt, s[1] / cnt, s[2] / cnt];
    return [Math.round((bestKey / 64) | 0) * 32, Math.round((bestKey % 64) / 8) * 32, Math.round(bestKey % 8) * 32];
  }
  function kmeansRep(pixels) {
    if (pixels.length < 4) return meanRep(pixels);
    var center = medianRep(pixels);
    var dists = new Float32Array(pixels.length);
    for (var i = 0; i < pixels.length; i++) {
      var d0 = pixels[i][0] - center[0], d1 = pixels[i][1] - center[1], d2 = pixels[i][2] - center[2];
      dists[i] = Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
    }
    var thr = M.percentile(dists, 25);
    var s = [0, 0, 0], cnt = 0;
    for (var j = 0; j < pixels.length; j++) if (dists[j] <= thr) { s[0] += pixels[j][0]; s[1] += pixels[j][1]; s[2] += pixels[j][2]; cnt++; }
    if (cnt > 0) return [s[0] / cnt, s[1] / cnt, s[2] / cnt];
    return meanRep(pixels);
  }
  function dominantRep(pixels) {
    var n = pixels.length;
    var rgb = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) { rgb[i * 3] = pixels[i][0]; rgb[i * 3 + 1] = pixels[i][1]; rgb[i * 3 + 2] = pixels[i][2]; }
    var oklab = C.rgbToOklab(rgb);
    var map = {}, bestKey = null, bestCnt = 0;
    for (var j = 0; j < n; j++) {
      var q = Math.round(oklab[j * 3] / 0.02) + "," + Math.round(oklab[j * 3 + 1] / 0.02) + "," + Math.round(oklab[j * 3 + 2] / 0.02);
      map[q] = (map[q] || 0) + 1;
      if (map[q] > bestCnt) { bestCnt = map[q]; bestKey = q; }
    }
    var s = [0, 0, 0], cnt = 0;
    for (var k = 0; k < n; k++) {
      var q2 = Math.round(oklab[k * 3] / 0.02) + "," + Math.round(oklab[k * 3 + 1] / 0.02) + "," + Math.round(oklab[k * 3 + 2] / 0.02);
      if (q2 === bestKey) { s[0] += pixels[k][0]; s[1] += pixels[k][1]; s[2] += pixels[k][2]; cnt++; }
    }
    if (cnt > 0) return [s[0] / cnt, s[1] / cnt, s[2] / cnt];
    return medianRep(pixels);
  }

  function aggregate(pixels, method) {
    switch (method) {
      case "mean": return meanRep(pixels);
      case "mode": return modeRep(pixels);
      case "kmeans": return kmeansRep(pixels);
      case "dominant": return dominantRep(pixels);
      default: return medianRep(pixels);
    }
  }

  function extractBlocks(img, alpha, h, w, grid, method, coreRatio, alphaMode) {
    var px = grid.px, py = grid.py, phaseX = grid.phaseX, phaseY = grid.phaseY;
    var wLogic = grid.wLogic, hLogic = grid.hLogic;
    var useCells = !!(grid.cellYs && grid.cellXs);
    var cw = Math.max(1, Math.round(px * coreRatio)), ch = Math.max(1, Math.round(py * coreRatio));
    var outRgb = new Float32Array(hLogic * wLogic * 3);
    var outAlpha = new Float32Array(hLogic * wLogic);
    var prevByEnd = new Int32Array(wLogic);
    for (var j = 0; j < hLogic; j++) {
      var lastRep = null, prevBxEnd = 0;
      for (var i = 0; i < wLogic; i++) {
        var byStart, byEnd, bxStart, bxEnd;
        if (useCells) {
          byStart = Math.round(grid.cellYs[j * (wLogic + 1) + i]);
          byEnd = Math.round(grid.cellYs[(j + 1) * (wLogic + 1) + i]);
          bxStart = Math.round(grid.cellXs[j * (wLogic + 1) + i]);
          bxEnd = Math.round(grid.cellXs[j * (wLogic + 1) + i + 1]);
        } else {
          byStart = Math.round(phaseY + j * py); byEnd = Math.round(phaseY + (j + 1) * py);
          bxStart = Math.round(phaseX + i * px); bxEnd = Math.round(phaseX + (i + 1) * px);
        }
        byStart = M.clamp(byStart, 0, h); byEnd = M.clamp(byEnd, 0, h);
        bxStart = M.clamp(bxStart, 0, w); bxEnd = M.clamp(bxEnd, 0, w);
        bxStart = Math.max(bxStart, prevBxEnd);
        if (bxEnd <= bxStart) bxEnd = Math.min(bxStart + 1, w);
        prevBxEnd = bxEnd;
        byStart = Math.max(byStart, prevByEnd[i]);
        if (byEnd <= byStart) byEnd = Math.min(byStart + 1, h);
        prevByEnd[i] = byEnd;
        var oi = (j * wLogic + i) * 3;
        if (byEnd <= byStart) { if (j > 0) { var pi2 = ((j - 1) * wLogic + i) * 3; outRgb[oi] = outRgb[pi2]; outRgb[oi + 1] = outRgb[pi2 + 1]; outRgb[oi + 2] = outRgb[pi2 + 2]; outAlpha[j * wLogic + i] = outAlpha[(j - 1) * wLogic + i]; } continue; }
        if (bxEnd <= bxStart) {
          if (lastRep) { outRgb[oi] = lastRep[0]; outRgb[oi + 1] = lastRep[1]; outRgb[oi + 2] = lastRep[2]; }
          else if (j > 0) { var pi3 = ((j - 1) * wLogic + i) * 3; outRgb[oi] = outRgb[pi3]; outRgb[oi + 1] = outRgb[pi3 + 1]; outRgb[oi + 2] = outRgb[pi3 + 2]; }
          outAlpha[j * wLogic + i] = j > 0 ? outAlpha[(j - 1) * wLogic + i] : 0;
          continue;
        }
        var blockH = byEnd - byStart, blockW = bxEnd - bxStart;
        var cyH = Math.min(ch, blockH), cyStart = byStart + ((blockH - cyH) >> 1), cyEnd = cyStart + cyH;
        var cxW = Math.min(cw, blockW), cxStart = bxStart + ((blockW - cxW) >> 1), cxEnd = cxStart + cxW;
        var pixels = [], opaque = 0, total = 0;
        for (var yy = cyStart; yy < cyEnd; yy++) for (var xx = cxStart; xx < cxEnd; xx++) {
          var o = yy * w + xx;
          pixels.push([img[o * 3], img[o * 3 + 1], img[o * 3 + 2]]);
          total++;
          if (alpha[o] > 0) opaque++;
        }
        if (!pixels.length) continue;
        var rep = aggregate(pixels, method);
        outRgb[oi] = rep[0]; outRgb[oi + 1] = rep[1]; outRgb[oi + 2] = rep[2];
        var ratio = total > 0 ? opaque / total : 0;
        var a;
        if (ratio <= 0) a = 0;
        else if (ratio >= 1) a = 255;
        else a = alphaMode === "delete" ? 0 : (alphaMode === "fill" ? 255 : Math.round(ratio * 255));
        outAlpha[j * wLogic + i] = a;
        lastRep = rep;
      }
    }
    return { rgb: outRgb, alpha: outAlpha };
  }

  // K-means 调色板量化（rgb 空间，唯一色加权）
  function colorQuantize(img, h, w, nColors) {
    var n = h * w;
    // 唯一色聚合
    var map = {}, order = [];
    for (var i = 0; i < n; i++) {
      var key = Math.round(img[i * 3]) + "," + Math.round(img[i * 3 + 1]) + "," + Math.round(img[i * 3 + 2]);
      if (!(key in map)) { map[key] = { r: img[i * 3], g: img[i * 3 + 1], b: img[i * 3 + 2], cnt: 0 }; order.push(key); }
      map[key].cnt++;
    }
    if (order.length <= nColors) return img;
    var uniq = order.map(function (k) { return [map[k].r, map[k].g, map[k].b]; });
    var counts = order.map(function (k) { return map[k].cnt; });
    var centers = kmeansWeighted(uniq, counts, nColors);
    // 最近邻映射
    var out = new Float32Array(n * 3);
    for (var i2 = 0; i2 < n; i2++) {
      var key2 = Math.round(img[i2 * 3]) + "," + Math.round(img[i2 * 3 + 1]) + "," + Math.round(img[i2 * 3 + 2]);
      var c2 = map[key2];
      var best = 0, bestD = Infinity;
      for (var ci = 0; ci < centers.length; ci++) {
        var dr = c2.r - centers[ci][0], dg = c2.g - centers[ci][1], db = c2.b - centers[ci][2];
        var d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = ci; }
      }
      out[i2 * 3] = centers[best][0]; out[i2 * 3 + 1] = centers[best][1]; out[i2 * 3 + 2] = centers[best][2];
    }
    return out;
  }

  function kmeansWeighted(uniq, counts, k) {
    var N = uniq.length;
    if (N <= k) return uniq;
    // k-means++ 初始化
    var centers = [];
    var first = (Math.random() * N) | 0;
    centers.push(uniq[first].slice());
    var d2 = new Float64Array(N);
    for (var init = 1; init < k; init++) {
      for (var i = 0; i < N; i++) {
        var best = Infinity;
        for (var ci = 0; ci < centers.length; ci++) {
          var dr = uniq[i][0] - centers[ci][0], dg = uniq[i][1] - centers[ci][1], db = uniq[i][2] - centers[ci][2];
          var dd = dr * dr + dg * dg + db * db;
          if (dd < best) best = dd;
        }
        d2[i] = best * counts[i];
      }
      var sum = 0;
      for (var j = 0; j < N; j++) sum += d2[j];
      var r = Math.random() * sum, acc = 0, pick = N - 1;
      for (var j2 = 0; j2 < N; j2++) { acc += d2[j2]; if (acc >= r) { pick = j2; break; } }
      centers.push(uniq[pick].slice());
    }
    // Lloyd 迭代
    var assign = new Int32Array(N);
    for (var it = 0; it < 20; it++) {
      var moved = false;
      for (var i2 = 0; i2 < N; i2++) {
        var bestC = 0, bestD2 = Infinity;
        for (var ci2 = 0; ci2 < k; ci2++) {
          var dr2 = uniq[i2][0] - centers[ci2][0], dg2 = uniq[i2][1] - centers[ci2][1], db2 = uniq[i2][2] - centers[ci2][2];
          var dd2 = dr2 * dr2 + dg2 * dg2 + db2 * db2;
          if (dd2 < bestD2) { bestD2 = dd2; bestC = ci2; }
        }
        if (assign[i2] !== bestC) { assign[i2] = bestC; moved = true; }
      }
      var sums = new Array(k), cnts = new Array(k);
      for (var c3 = 0; c3 < k; c3++) { sums[c3] = [0, 0, 0]; cnts[c3] = 0; }
      for (var i3 = 0; i3 < N; i3++) { var c4 = assign[i3]; sums[c4][0] += uniq[i3][0] * counts[i3]; sums[c4][1] += uniq[i3][1] * counts[i3]; sums[c4][2] += uniq[i3][2] * counts[i3]; cnts[c4] += counts[i3]; }
      for (var c5 = 0; c5 < k; c5++) if (cnts[c5] > 0) centers[c5] = [sums[c5][0] / cnts[c5], sums[c5][1] / cnts[c5], sums[c5][2] / cnts[c5]];
      if (!moved) break;
    }
    return centers;
  }

  global.AiPixelExtract = { extractBlocks: extractBlocks, colorQuantize: colorQuantize };
})(typeof window !== "undefined" ? window : this);
