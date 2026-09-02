/** 伪像素规整 — 降噪：nl_means / tv_chambolle / bilateral（RGB Float32Array，0-255） */
(function (global) {
  "use strict";
  var M = global.AiPixelMath;

  function nlMeans(img, h, w, strength) {
    var ps = 2, pd = 3, hh = strength * 0.03 * 255;
    var n = h * w, pa = (2 * ps + 1) * (2 * ps + 1);
    var sW = new Float64Array(n), sR = new Float64Array(n), sG = new Float64Array(n), sB = new Float64Array(n);
    var diff = new Float32Array(n);
    for (var dy = -pd; dy <= pd; dy++) for (var dx = -pd; dx <= pd; dx++) {
      for (var i = 0; i < n; i++) {
        var y = (i / w) | 0, x = i % w;
        var sy = y + dy; if (sy < 0) sy = 0; else if (sy >= h) sy = h - 1;
        var sx = x + dx; if (sx < 0) sx = 0; else if (sx >= w) sx = w - 1;
        var o = (sy * w + sx) * 3, oo = i * 3;
        var dr = img[oo] - img[o], dg = img[oo + 1] - img[o + 1], db = img[oo + 2] - img[o + 2];
        diff[i] = dr * dr + dg * dg + db * db;
      }
      var I = M.integralImage(diff, h, w);
      for (var i2 = 0; i2 < n; i2++) {
        var y2 = (i2 / w) | 0, x2 = i2 % w;
        var y0 = y2 - ps, y1 = y2 + ps + 1; if (y0 < 0) y0 = 0; if (y1 > h) y1 = h;
        var x0 = x2 - ps, x1 = x2 + ps + 1; if (x0 < 0) x0 = 0; if (x1 > w) x1 = w;
        var wgt = Math.exp(-M.integralSum(I, w, y0, y1, x0, x1) / pa / (hh * hh));
        var sy2 = y2 + dy; if (sy2 < 0) sy2 = 0; else if (sy2 >= h) sy2 = h - 1;
        var sx2 = x2 + dx; if (sx2 < 0) sx2 = 0; else if (sx2 >= w) sx2 = w - 1;
        var oo2 = (sy2 * w + sx2) * 3;
        sW[i2] += wgt; sR[i2] += wgt * img[oo2]; sG[i2] += wgt * img[oo2 + 1]; sB[i2] += wgt * img[oo2 + 2];
      }
    }
    var out = new Float32Array(n * 3);
    for (var i3 = 0; i3 < n; i3++) {
      var iw = sW[i3] > 1e-12 ? 1 / sW[i3] : 1;
      out[i3 * 3] = sR[i3] * iw; out[i3 * 3 + 1] = sG[i3] * iw; out[i3 * 3 + 2] = sB[i3] * iw;
    }
    return out;
  }

  function tvChambolleChannel(f, h, w, weight, eps, maxIter) {
    var n = h * w, tau = 0.24;
    var px = new Float32Array(n), py = new Float32Array(n), tmp = new Float32Array(n), out = new Float32Array(n);
    for (var it = 0; it < maxIter; it++) {
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var i = y * w + x;
        tmp[i] = (px[i] - (x > 0 ? px[i - 1] : 0)) + (py[i] - (y > 0 ? py[i - w] : 0)) - f[i] / weight;
      }
      var norm = 0;
      for (var y2 = 0; y2 < h; y2++) for (var x2 = 0; x2 < w; x2++) {
        var i2 = y2 * w + x2;
        var gx = x2 < w - 1 ? tmp[i2 + 1] - tmp[i2] : 0;
        var gy = y2 < h - 1 ? tmp[i2 + w] - tmp[i2] : 0;
        var g = Math.sqrt(gx * gx + gy * gy);
        var nx = (px[i2] + tau * gx) / (1 + tau * g);
        var ny = (py[i2] + tau * gy) / (1 + tau * g);
        var d = Math.abs(nx - px[i2]) + Math.abs(ny - py[i2]);
        if (d > norm) norm = d;
        px[i2] = nx; py[i2] = ny;
      }
      if (norm < eps) break;
    }
    for (var i3 = 0; i3 < n; i3++) {
      var x3 = i3 % w, y3 = (i3 / w) | 0;
      var v = f[i3] - weight * ((px[i3] - (x3 > 0 ? px[i3 - 1] : 0)) + (py[i3] - (y3 > 0 ? py[i3 - w] : 0)));
      out[i3] = v < 0 ? 0 : (v > 255 ? 255 : v);
    }
    return out;
  }

  function tvChambolle(img, h, w, strength) {
    var weight = strength * 0.1 * 255, n = h * w, out = new Float32Array(n * 3);
    for (var c = 0; c < 3; c++) {
      var f = new Float32Array(n);
      for (var i = 0; i < n; i++) f[i] = img[i * 3 + c];
      var r = tvChambolleChannel(f, h, w, weight, 2e-4, 200);
      for (var i2 = 0; i2 < n; i2++) out[i2 * 3 + c] = r[i2];
    }
    return out;
  }

  function bilateral(img, h, w, strength) {
    var sc = strength * 0.1 * 255, ss = 2, radius = Math.max(1, Math.ceil(3 * ss));
    var n = h * w, k = 2 * radius + 1, ker = new Float32Array(k * k);
    for (var dy = -radius; dy <= radius; dy++) for (var dx = -radius; dx <= radius; dx++)
      ker[(dy + radius) * k + (dx + radius)] = Math.exp(-(dx * dx + dy * dy) / (2 * ss * ss));
    var out = new Float32Array(n * 3), denom = 2 * sc * sc;
    for (var i = 0; i < n; i++) {
      var y = (i / w) | 0, x = i % w, oo = i * 3, cr = img[oo], cg = img[oo + 1], cb = img[oo + 2];
      var sw = 0, sr = 0, sg = 0, sb = 0;
      for (var dy2 = -radius; dy2 <= radius; dy2++) for (var dx2 = -radius; dx2 <= radius; dx2++) {
        var sy = y + dy2; if (sy < 0) sy = 0; else if (sy >= h) sy = h - 1;
        var sx = x + dx2; if (sx < 0) sx = 0; else if (sx >= w) sx = w - 1;
        var o = (sy * w + sx) * 3;
        var dr = img[o] - cr, dg = img[o + 1] - cg, db = img[o + 2] - cb;
        var wgt = ker[(dy2 + radius) * k + (dx2 + radius)] * Math.exp(-(dr * dr + dg * dg + db * db) / denom);
        sw += wgt; sr += wgt * img[o]; sg += wgt * img[o + 1]; sb += wgt * img[o + 2];
      }
      out[oo] = sr / sw; out[oo + 1] = sg / sw; out[oo + 2] = sb / sw;
    }
    return out;
  }

  global.AiPixelDenoise = { nlMeans: nlMeans, tvChambolle: tvChambolle, bilateral: bilateral };
})(typeof window !== "undefined" ? window : this);
