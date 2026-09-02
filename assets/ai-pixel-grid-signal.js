/** 伪像素规整 — 网格检测：信号预处理（边缘图 / 局部对比度归一化 / OKLab 色差信号 / 梯度回退） */
(function (global) {
  "use strict";
  var M = global.AiPixelMath;
  var C = global.AiPixelColor;

  // 线性外推 pad（沿两轴各 p 像素）
  function linearExtrapPad(gray, h, w, p) {
    if (p <= 0) return { g: gray, h: h, w: w };
    var gh = h + 2 * p, gw = w + 2 * p;
    var g = new Float32Array(gh * gw);
    // 先沿列（横向）外推
    var w2 = w + 2 * p;
    var tmp = new Float32Array(h * w2);
    for (var y = 0; y < h; y++) {
      var row = y * w;
      // 左斜率
      var sl = 0;
      for (var k = 1; k <= p; k++) sl += gray[row + k] - gray[row + k - 1];
      sl /= p;
      // 右斜率
      var sr = 0;
      for (var k2 = 0; k2 < p; k2++) sr += gray[row + w - 1 - k2] - gray[row + w - 2 - k2];
      sr /= p;
      var trow = y * w2;
      for (var k3 = 0; k3 < p; k3++) { tmp[trow + k3] = gray[row] + sl * (k3 - p); }
      for (var x = 0; x < w; x++) tmp[trow + p + x] = gray[row + x];
      for (var k4 = 0; k4 < p; k4++) { tmp[trow + p + w + k4] = gray[row + w - 1] + sr * (k4 + 1); }
    }
    // 沿行（纵向）外推
    for (var x = 0; x < w2; x++) {
      var st = 0;
      for (var k5 = 1; k5 <= p; k5++) st += tmp[k5 * w2 + x] - tmp[(k5 - 1) * w2 + x];
      st /= p;
      var sb = 0;
      for (var k6 = 0; k6 < p; k6++) sb += tmp[(h - 1 - k6) * w2 + x] - tmp[(h - 2 - k6) * w2 + x];
      sb /= p;
      for (var k7 = 0; k7 < p; k7++) g[k7 * gw + x] = tmp[x] + st * (k7 - p);
      for (var y = 0; y < h; y++) g[(p + y) * gw + x] = tmp[y * w2 + x];
      for (var k8 = 0; k8 < p; k8++) g[(p + h + k8) * gw + x] = tmp[(h - 1) * w2 + x] + sb * (k8 + 1);
    }
    return { g: g, h: gh, w: gw };
  }

  // 局部对比度归一化
  function localContrastNormalize(gray, h, w, window) {
    window = window || 33;
    var n = h * w;
    var globalStd = M.std(gray);
    if (globalStd < 1e-6) return new Float32Array(n);
    var ww = window % 2 === 0 ? window + 1 : window;
    var p = ww >> 1;
    var pad = linearExtrapPad(gray, h, w, p);
    var g = pad.g, gh = pad.h, gw = pad.w;
    var localMean = M.boxFilter(g, gh, gw, ww);
    var g2 = new Float32Array(gh * gw);
    for (var i = 0; i < g2.length; i++) g2[i] = g[i] * g[i];
    var localSqMean = M.boxFilter(g2, gh, gw, ww);
    var out = new Float32Array(n);
    var lo = 0.5 * globalStd, hi = globalStd;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var oi = (y + p) * gw + (x + p);
      var lm = localMean[oi], lsm = localSqMean[oi];
      var lstd = Math.sqrt(Math.max(lsm - lm * lm, 1e-6));
      var eff = lstd < lo ? lo : (lstd > hi ? hi : lstd);
      out[y * w + x] = (g[oi] - lm) / eff;
    }
    return out;
  }

  // 边缘幅值归一化组合
  function normalizeCombineEdge(mag, h, w) {
    var n = h * w;
    var gmax = M.max(mag);
    if (gmax < 1e-12) return new Float32Array(n);
    var magNorm = new Float32Array(n);
    for (var i = 0; i < n; i++) magNorm[i] = mag[i] / gmax;
    var localNorm = localContrastNormalize(mag, h, w, 33);
    var combined = new Float32Array(n);
    for (var i2 = 0; i2 < n; i2++) combined[i2] = Math.max(magNorm[i2], localNorm[i2]);
    var cmax = M.max(combined);
    if (cmax > 1e-12) for (var i3 = 0; i3 < n; i3++) combined[i3] /= cmax;
    return combined;
  }

  // 计算 2D 边缘强度图
  function computeEdgeMap(img, h, w, c) {
    var n = h * w;
    var gray;
    if (c >= 3) {
      gray = new Float32Array(n);
      for (var i = 0; i < n; i++) gray[i] = 0.299 * img[i * 3] + 0.587 * img[i * 3 + 1] + 0.114 * img[i * 3 + 2];
    } else gray = img;
    var sob = M.sobelXy(gray, h, w);
    var mag = new Float32Array(n);
    for (var i2 = 0; i2 < n; i2++) mag[i2] = Math.sqrt(sob.gx[i2] * sob.gx[i2] + sob.gy[i2] * sob.gy[i2]);
    return normalizeCombineEdge(mag, h, w);
  }

  // OKLab 色差边缘图
  function oklabEdgeMap(oklab, h, w) {
    var n = h * w;
    var sqx = new Float32Array(n), sqy = new Float32Array(n);
    for (var c = 0; c < 3; c++) {
      for (var y = 0; y < h; y++) for (var x = 1; x < w; x++) {
        var d = oklab[(y * w + x) * 3 + c] - oklab[(y * w + x - 1) * 3 + c];
        sqx[y * w + x] += d * d;
      }
      for (var y2 = 1; y2 < h; y2++) for (var x2 = 0; x2 < w; x2++) {
        var d2 = oklab[(y2 * w + x2) * 3 + c] - oklab[((y2 - 1) * w + x2) * 3 + c];
        sqy[y2 * w + x2] += d2 * d2;
      }
    }
    var mag = new Float32Array(n);
    for (var i = 0; i < n; i++) mag[i] = Math.sqrt(sqx[i] + sqy[i]);
    return normalizeCombineEdge(mag, h, w);
  }

  // OKLab 色差检测信号
  function oklabSignal(img, h, w) {
    var n = h * w;
    var oklab = C.rgbToOklab(img);
    var sqx = new Float32Array(w - 1), sqy = new Float32Array(h - 1);
    for (var c = 0; c < 3; c++) {
      var ch = new Float32Array(n);
      for (var i = 0; i < n; i++) ch[i] = oklab[i * 3 + c];
      var nc = localContrastNormalize(ch, h, w, 33);
      for (var y = 0; y < h; y++) for (var x = 1; x < w; x++) {
        var d = nc[y * w + x] - nc[y * w + x - 1];
        sqx[x - 1] += d * d;
      }
      for (var y2 = 1; y2 < h; y2++) for (var x2 = 0; x2 < w; x2++) {
        var d2 = nc[y2 * w + x2] - nc[(y2 - 1) * w + x2];
        sqy[y2 - 1] += d2 * d2;
      }
    }
    var sigX = new Float32Array(w - 1), sigY = new Float32Array(h - 1);
    for (var x3 = 0; x3 < w - 1; x3++) sigX[x3] = Math.sqrt(sqx[x3]);
    for (var y3 = 0; y3 < h - 1; y3++) sigY[y3] = Math.sqrt(sqy[y3]);
    var edgeMap = oklabEdgeMap(oklab, h, w);
    var gray = new Float32Array(n);
    for (var i2 = 0; i2 < n; i2++) gray[i2] = 0.299 * img[i2 * 3] + 0.587 * img[i2 * 3 + 1] + 0.114 * img[i2 * 3 + 2];
    return { sigX: sigX, sigY: sigY, edgeMap: edgeMap, gray: gray };
  }

  // 梯度峰中位数间距回退
  function estimateGridGradient(gray, h, w, relThr) {
    relThr = relThr === undefined ? 0.2 : relThr;
    var sigX = new Float32Array(w - 1), sigY = new Float32Array(h - 1);
    for (var y = 0; y < h; y++) for (var x = 1; x < w; x++) sigX[x - 1] += Math.abs(gray[y * w + x] - gray[y * w + x - 1]);
    for (var y2 = 1; y2 < h; y2++) for (var x2 = 0; x2 < w; x2++) sigY[y2 - 1] += Math.abs(gray[y2 * w + x2] - gray[(y2 - 1) * w + x2]);
    var minInterval = Math.max(1, Math.min(8, (h < w ? h : w) / 200 | 0));
    function findPeaks(prof, thr) {
      var peaks = [];
      for (var i = 1; i < prof.length - 1; i++) {
        if (prof[i] > prof[i - 1] && prof[i] > prof[i + 1] && prof[i] >= thr) {
          if (!peaks.length || i - peaks[peaks.length - 1] >= minInterval) peaks.push(i);
        }
      }
      return peaks;
    }
    var mxX = M.max(sigX), mxY = M.max(sigY);
    var px = findPeaks(sigX, relThr * mxX), py = findPeaks(sigY, relThr * mxY);
    if (px.length < 4 || py.length < 4) return { px: 0, py: 0 };
    function medianInterval(p) {
      var d = [];
      for (var i = 1; i < p.length; i++) d.push(p[i] - p[i - 1]);
      return M.median(d);
    }
    return { px: medianInterval(px), py: medianInterval(py) };
  }

  global.AiPixelSignal = {
    linearExtrapPad: linearExtrapPad,
    localContrastNormalize: localContrastNormalize,
    normalizeCombineEdge: normalizeCombineEdge,
    computeEdgeMap: computeEdgeMap,
    oklabEdgeMap: oklabEdgeMap,
    oklabSignal: oklabSignal,
    estimateGridGradient: estimateGridGradient
  };
})(typeof window !== "undefined" ? window : this);
