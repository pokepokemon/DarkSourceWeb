/** 伪像素规整 — 网格检测：方块检测（detect_squares 移植） */
(function (global) {
  "use strict";
  var M = global.AiPixelMath;

  function detectSquares(edgeMap, h, w, px, py, enableSubpixel) {
    var px_i = Math.max(1, Math.round(px)), py_i = Math.max(1, Math.round(py));
    if (py_i >= h || px_i >= w) return [];
    var I = M.integralImage(edgeMap, h, w);
    var binmap = new Float32Array(h * w);
    for (var i = 0; i < binmap.length; i++) binmap[i] = edgeMap[i] > 0.03 ? 1 : 0;
    var B = M.integralImage(binmap, h, w);
    var step = Math.max(1, Math.floor(Math.min(px, py) * 0.3));
    var sideThr = 0.06, minCoh = 0.5, interiorRatio = 0.5;
    var cands = [];
    for (var y0 = 0; y0 <= h - py_i; y0 += step) {
      for (var x0 = 0; x0 <= w - px_i; x0 += step) {
        var y1 = y0 + py_i, x1 = x0 + px_i;
        var topSum = M.integralSum(I, w, y0, y0 + 1, x0, x1);
        var botSum = M.integralSum(I, w, y1 - 1, y1, x0, x1);
        var leftSum = M.integralSum(I, w, y0, y1, x0, x0 + 1);
        var rightSum = M.integralSum(I, w, y0, y1, x1 - 1, x1);
        var topAvg = topSum / px_i, botAvg = botSum / px_i, leftAvg = leftSum / py_i, rightAvg = rightSum / py_i;
        var topCoh = M.integralSum(B, w, y0, y0 + 1, x0, x1) / px_i;
        var botCoh = M.integralSum(B, w, y1 - 1, y1, x0, x1) / px_i;
        var leftCoh = M.integralSum(B, w, y0, y1, x0, x0 + 1) / py_i;
        var rightCoh = M.integralSum(B, w, y0, y1, x1 - 1, x1) / py_i;
        var topB = topAvg >= sideThr && topCoh >= minCoh;
        var botB = botAvg >= sideThr && botCoh >= minCoh;
        var leftB = leftAvg >= sideThr && leftCoh >= minCoh;
        var rightB = rightAvg >= sideThr && rightCoh >= minCoh;
        var bc = (topB ? 1 : 0) + (botB ? 1 : 0) + (leftB ? 1 : 0) + (rightB ? 1 : 0);
        var adjacent = (topB && rightB) || (rightB && botB) || (botB && leftB) || (leftB && topB);
        var interiorSum = M.integralSum(I, w, y0 + 1, y1 - 1, x0 + 1, x1 - 1);
        var iArea = Math.max(0, (py_i - 2) * (px_i - 2));
        var iAvg = iArea > 0 ? interiorSum / iArea : 0;
        var bAvg = (topAvg + botAvg + leftAvg + rightAvg) / 4;
        var clean = iAvg <= bAvg * interiorRatio;
        var score = topSum + botSum + leftSum + rightSum + bc * 0.5 + (clean ? 0.5 : 0);
        if (adjacent) cands.push({ y0: y0, x0: x0, y1: y1, x1: x1, score: score, sides: [topB, botB, leftB, rightB] });
      }
    }
    if (!cands.length) return [];
    // 粗 NMS：每格保留最高分
    var nGx = Math.floor(w / px_i) + 3;
    var keyMap = {};
    for (var ci = 0; ci < cands.length; ci++) {
      var c = cands[ci];
      var gy = Math.floor((c.y0 + py_i / 2) / py_i), gx = Math.floor((c.x0 + px_i / 2) / px_i);
      var key = (gy + 2) * nGx + (gx + 2);
      if (!(key in keyMap) || c.score > keyMap[key].score) keyMap[key] = c;
    }
    var bestLocal = [];
    for (var kk in keyMap) bestLocal.push(keyMap[kk]);
    bestLocal.sort(function (a, b) { return b.score - a.score; });
    // 贪心 NMS
    var binSize = Math.max(1, Math.min(px_i, py_i));
    var area = px_i * py_i;
    var bins = {}, selected = [];
    for (var bi = 0; bi < bestLocal.length; bi++) {
      var s = bestLocal[bi];
      var by = Math.floor(s.y0 / binSize), bx = Math.floor(s.x0 / binSize);
      var ok = true;
      for (var ddy = -1; ddy <= 1 && ok; ddy++) for (var ddx = -1; ddx <= 1 && ok; ddx++) {
        var lst = bins[(by + ddy) + "," + (bx + ddx)];
        if (!lst) continue;
        for (var li = 0; li < lst.length; li++) {
          var o = selected[lst[li]];
          var iy0 = Math.max(s.y0, o.y0), iy1 = Math.min(s.y1, o.y1);
          var ix0 = Math.max(s.x0, o.x0), ix1 = Math.min(s.x1, o.x1);
          var ov = Math.max(0, iy1 - iy0) * Math.max(0, ix1 - ix0);
          if (ov / area > 0.3) { ok = false; break; }
        }
      }
      if (!ok) continue;
      var sides = [];
      if (s.sides[0]) sides.push("top");
      if (s.sides[1]) sides.push("bottom");
      if (s.sides[2]) sides.push("left");
      if (s.sides[3]) sides.push("right");
      bins[by + "," + bx] = bins[by + "," + bx] || [];
      bins[by + "," + bx].push(selected.length);
      selected.push({ y0: s.y0, x0: s.x0, y1: s.y1, x1: s.x1, score: s.score, bounded_sides: sides });
    }
    // 亚像素精炼
    if (enableSubpixel && selected.length) {
      var radius = Math.max(1, step);
      for (var si = 0; si < selected.length; si++) {
        var ss = selected[si];
        var ylo = Math.max(0, ss.y0 - radius), yhi = Math.min(h - py_i, ss.y0 + radius);
        var xlo = Math.max(0, ss.x0 - radius), xhi = Math.min(w - px_i, ss.x0 + radius);
        if (yhi < ylo || xhi < xlo) continue;
        var bestY = ss.y0, bestX = ss.x0, bestV = -Infinity;
        for (var y2 = ylo; y2 <= yhi; y2++) for (var x2 = xlo; x2 <= xhi; x2++) {
          var v = M.integralSum(I, w, y2, y2 + 1, x2, x2 + px_i) + M.integralSum(I, w, y2 + py_i - 1, y2 + py_i, x2, x2 + px_i)
            + M.integralSum(I, w, y2, y2 + py_i, x2, x2 + 1) + M.integralSum(I, w, y2, y2 + py_i, x2 + px_i - 1, x2 + px_i);
          if (v > bestV) { bestV = v; bestY = y2; bestX = x2; }
        }
        ss.y0 = bestY; ss.x0 = bestX; ss.y1 = bestY + py_i; ss.x1 = bestX + px_i;
      }
    }
    return selected;
  }

  global.AiPixelSquares = { detectSquares: detectSquares };
})(typeof window !== "undefined" ? window : this);
