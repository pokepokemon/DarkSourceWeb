/** 伪像素规整 — CLAHE 局部对比度增强（RGB Float32Array，0-255，clipLimit 0.01-0.1） */
(function (global) {
  "use strict";

  function claheChannel(ch, h, w, clipLimit) {
    var tileH = Math.max(2, Math.round(h / 8)), tileW = Math.max(2, Math.round(w / 8));
    var nty = Math.ceil(h / tileH), ntx = Math.ceil(w / tileW);
    var clipThr = clipLimit * tileH * tileW;
    var luts = new Float32Array(nty * ntx * 256);
    // 每 tile 构建 LUT
    for (var ty = 0; ty < nty; ty++) for (var tx = 0; tx < ntx; tx++) {
      var hist = new Float32Array(256);
      var y0 = ty * tileH, y1 = Math.min(y0 + tileH, h), x0 = tx * tileW, x1 = Math.min(x0 + tileW, w);
      for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) hist[Math.round(ch[y * w + x])]++;
      // clip 并重分布
      var excess = 0;
      for (var b = 0; b < 256; b++) if (hist[b] > clipThr) { excess += hist[b] - clipThr; hist[b] = clipThr; }
      var redist = excess / 256;
      var cdf = 0, lutOff = (ty * ntx + tx) * 256;
      for (var b2 = 0; b2 < 256; b2++) { cdf += hist[b2] + redist; luts[lutOff + b2] = (cdf / ((y1 - y0) * (x1 - x0))) * 255; }
    }
    var out = new Float32Array(h * w);
    var halfH = tileH / 2, halfW = tileW / 2;
    for (var y2 = 0; y2 < h; y2++) for (var x2 = 0; x2 < w; x2++) {
      var v = ch[y2 * w + x2];
      // 像素相对中心区域的位置：中心直接用所在 tile；边缘用相邻 tile 双线性插值
      var cy = y2 + halfH, cx = x2 + halfW;
      var ty0 = Math.floor((cy - halfH) / tileH), tx0 = Math.floor((cx - halfW) / tileW);
      var fy = (cy - (ty0 + 0.5) * tileH) / tileH, fx = (cx - (tx0 + 0.5) * tileW) / tileW;
      // 归一化到 [0,1]，clamp
      var wy = fy < 0 ? 0 : (fy > 1 ? 1 : fy);
      var wx = fx < 0 ? 0 : (fx > 1 ? 1 : fx);
      // 四个邻接 tile 索引（clamp）
      function lutAt(ty, tx) {
        if (ty < 0) ty = 0; else if (ty >= nty) ty = nty - 1;
        if (tx < 0) tx = 0; else if (tx >= ntx) tx = ntx - 1;
        return luts[(ty * ntx + tx) * 256 + Math.round(v)];
      }
      var tyB = ty0 + (fy > 0.5 ? 1 : 0), txB = tx0 + (fx > 0.5 ? 1 : 0);
      var tyA = ty0, txA = tx0;
      // 双线性插值（用 A/B 简化：四角插值）
      var la = lutAt(tyA, txA), lb = lutAt(tyA, txB), lc = lutAt(tyB, txA), ld = lutAt(tyB, txB);
      var top = la + (lb - la) * wx;
      var bot = lc + (ld - lc) * wx;
      out[y2 * w + x2] = top + (bot - top) * wy;
    }
    return out;
  }

  function applyClahe(img, h, w, clipLimit) {
    var n = h * w, out = new Float32Array(n * 3);
    for (var c = 0; c < 3; c++) {
      var ch = new Float32Array(n);
      for (var i = 0; i < n; i++) ch[i] = img[i * 3 + c];
      var r = claheChannel(ch, h, w, clipLimit);
      for (var i2 = 0; i2 < n; i2++) out[i2 * 3 + c] = r[i2];
    }
    return out;
  }

  global.AiPixelClahe = { applyClahe: applyClahe };
})(typeof window !== "undefined" ? window : this);
