/** 伪像素规整 — 网格检测：方块 BFS 分配（assign_grid_bfs 移植） */
(function (global) {
  "use strict";

  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function assignGridBfs(squares, px, py, imgW, imgH, adjacencyTol) {
    var cxImg = imgW / 2, cyImg = imgH / 2;
    function defaultBounds(scx, scy) {
      return {
        minGx: -Math.floor(scx / px), maxGx: Math.floor((imgW - scx) / px),
        minGy: -Math.floor(scy / py), maxGy: Math.floor((imgH - scy) / py)
      };
    }
    if (!squares.length) return { placed: {}, bounds: defaultBounds(cxImg, cyImg) };
    var n = squares.length;
    var cxs = [], cys = [], scores = [], dist = [];
    for (var i = 0; i < n; i++) { cxs.push((squares[i].x0 + squares[i].x1) / 2); cys.push((squares[i].y0 + squares[i].y1) / 2); scores.push(squares[i].score); }
    for (var j = 0; j < n; j++) dist.push(Math.abs(cxs[j] - cxImg) + Math.abs(cys[j] - cyImg));
    var agxTmp = [], agyTmp = [];
    for (var k = 0; k < n; k++) { agxTmp.push(Math.round((cxs[k] - cxImg) / px)); agyTmp.push(Math.round((cys[k] - cyImg) / py)); }
    var coordMapTmp = {};
    for (var m = 0; m < n; m++) { var key = agxTmp[m] + "," + agyTmp[m]; (coordMapTmp[key] = coordMapTmp[key] || []).push(m); }
    var order;
    var sMin = Math.min.apply(null, scores), sMax = Math.max.apply(null, scores);
    if (sMax - sMin > 1e-9) {
      var primary = [];
      for (var a = 0; a < n; a++) {
        var cnt = 0;
        for (var d = 0; d < 4; d++) {
          var k2 = (agxTmp[a] + DIRS[d][0]) + "," + (agyTmp[a] + DIRS[d][1]);
          if (coordMapTmp[k2]) cnt++;
        }
        primary.push(((scores[a] - sMin) / (sMax - sMin)) * cnt);
      }
      order = scores.map(function (_, i) { return i; }).sort(function (a, b) {
        return (primary[b] - primary[a]) || (dist[a] - dist[b]);
      });
    } else {
      order = scores.map(function (_, i) { return i; }).sort(function (a, b) { return (scores[b] - scores[a]) || (dist[a] - dist[b]); });
    }
    var seedIdx = order[0], seedCx = cxs[seedIdx], seedCy = cys[seedIdx];
    var bounds = defaultBounds(seedCx, seedCy);
    var agx = [], agy = [];
    for (var b = 0; b < n; b++) { agx.push(Math.round((cxs[b] - seedCx) / px)); agy.push(Math.round((cys[b] - seedCy) / py)); }
    var coordMap = {};
    for (var c = 0; c < n; c++) { var key2 = agx[c] + "," + agy[c]; (coordMap[key2] = coordMap[key2] || []).push(c); }
    function sqTuple(i) { var s = squares[i]; return [s.y0, s.x0, s.y1, s.x1]; }
    var placed = {}, visited = {};
    placed["0,0"] = sqTuple(seedIdx); visited[seedIdx] = true;
    var queue = [[0, 0, seedIdx]], head = 0;
    while (head < queue.length) {
      var cur = queue[head++], gx = cur[0], gy = cur[1], idx = cur[2];
      var curCx = cxs[idx], curCy = cys[idx];
      for (var d2 = 0; d2 < 4; d2++) {
        var dx = DIRS[d2][0], dy = DIRS[d2][1];
        var ng = (gx + dx) + "," + (gy + dy);
        if (placed[ng]) continue;
        var lst = coordMap[ng];
        if (!lst) continue;
        for (var li = 0; li < lst.length; li++) {
          var ci = lst[li];
          if (visited[ci]) continue;
          var ddx = cxs[ci] - curCx, ddy = cys[ci] - curCy;
          var ok;
          if (dx === 1) ok = Math.abs(ddx - px) <= adjacencyTol && Math.abs(ddy) <= adjacencyTol;
          else if (dx === -1) ok = Math.abs(ddx + px) <= adjacencyTol && Math.abs(ddy) <= adjacencyTol;
          else if (dy === 1) ok = Math.abs(ddy - py) <= adjacencyTol && Math.abs(ddx) <= adjacencyTol;
          else ok = Math.abs(ddy + py) <= adjacencyTol && Math.abs(ddx) <= adjacencyTol;
          if (ok) { placed[ng] = sqTuple(ci); visited[ci] = true; queue.push([gx + dx, gy + dy, ci]); break; }
        }
      }
    }
    for (var e = 0; e < n; e++) {
      if (visited[e]) continue;
      var g = agx[e] + "," + agy[e];
      if (!placed[g]) { placed[g] = sqTuple(e); visited[e] = true; }
    }
    return { placed: placed, bounds: bounds };
  }

  global.AiPixelBfs = { assignGridBfs: assignGridBfs };
})(typeof window !== "undefined" ? window : this);
