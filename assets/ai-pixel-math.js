/**
 * 伪像素规整 — 数学基础：FFT / 积分图 / 滤波 / 统计
 * 图像约定：扁平 Float32Array 行优先；灰度 (h,w) 索引 y*w+x；RGB (h,w,3) 索引 (y*w+x)*3+c。
 */
(function (global) {
  "use strict";

  function nextPow2(n) { var p = 1; while (p < n) p <<= 1; return p; }

  // radix-2 复数 FFT；dir=1 前向 / -1 逆（逆时除以 n）
  function fft1d(dir, re, im) {
    var n = re.length;
    if (n <= 1) return;
    var j = 0;
    for (var i = 0; i < n; i++) {
      if (i < j) { var tr = re[i]; re[i] = re[j]; re[j] = tr; var ti = im[i]; im[i] = im[j]; im[j] = ti; }
      var m = n >> 1;
      while (m >= 1 && j >= m) { j -= m; m >>= 1; }
      j += m;
    }
    for (var len = 2; len <= n; len <<= 1) {
      var angle = (2 * Math.PI * dir) / len;
      var wlr = Math.cos(angle), wli = Math.sin(angle);
      for (var i2 = 0; i2 < n; i2 += len) {
        var wr = 1, wi = 0;
        for (var k = 0; k < (len >> 1); k++) {
          var ur = re[i2 + k], ui = im[i2 + k];
          var vr = re[i2 + k + (len >> 1)] * wr - im[i2 + k + (len >> 1)] * wi;
          var vi = re[i2 + k + (len >> 1)] * wi + im[i2 + k + (len >> 1)] * wr;
          re[i2 + k] = ur + vr; im[i2 + k] = ui + vi;
          re[i2 + k + (len >> 1)] = ur - vr; im[i2 + k + (len >> 1)] = ui - vi;
          var tr2 = wr * wlr - wi * wli; wi = wr * wli + wi * wlr; wr = tr2;
        }
      }
    }
    if (dir === -1) for (var i3 = 0; i3 < n; i3++) { re[i3] /= n; im[i3] /= n; }
  }

  // 实数信号 rfft，返回 { mag, N }（幅值谱长度 N/2+1）
  function rfftMag(sig) {
    var N = nextPow2(sig.length);
    var re = new Float32Array(N), im = new Float32Array(N);
    re.set(sig);
    fft1d(1, re, im);
    var half = (N >> 1) + 1;
    var mag = new Float32Array(half);
    for (var k = 0; k < half; k++) { var r = re[k], iv = im[k]; mag[k] = Math.sqrt(r * r + iv * iv); }
    return { mag: mag, N: N };
  }

  // 幅值平方谱 -> 实数信号前 outLen 项（自相关等）
  function irfftFromMagSq(magSq, N, outLen) {
    var re = new Float32Array(N), im = new Float32Array(N);
    var half = magSq.length - 1;
    re[0] = magSq[0];
    for (var k = 1; k < half; k++) { re[k] = magSq[k]; re[N - k] = magSq[k]; }
    if (half >= 1) re[half] = magSq[half];
    fft1d(-1, re, im);
    var out = new Float32Array(outLen);
    for (var i = 0; i < outLen; i++) out[i] = re[i];
    return out;
  }

  // 自相关（等价 np.fft.rfft(sig,n=2n) -> irfft(|f|^2)[:n]）
  function acf(sig) {
    var n = sig.length, N = nextPow2(2 * n);
    var re = new Float32Array(N), im = new Float32Array(N);
    re.set(sig);
    fft1d(1, re, im);
    var half = (N >> 1) + 1;
    var magSq = new Float32Array(half);
    for (var k = 0; k < half; k++) magSq[k] = re[k] * re[k] + im[k] * im[k];
    return irfftFromMagSq(magSq, N, n);
  }

  // 积分图：返回 Float64Array 长度 (h+1)*(w+1)
  function integralImage(a, h, w) {
    var I = new Float64Array((h + 1) * (w + 1));
    for (var y = 0; y < h; y++) {
      var rowSum = 0, aOff = y * w, iOff = (y + 1) * (w + 1), iOffPrev = y * (w + 1);
      for (var x = 0; x < w; x++) { rowSum += a[aOff + x]; I[iOff + x + 1] = I[iOffPrev + x + 1] + rowSum; }
    }
    return I;
  }
  function integralSum(I, w, y0, y1, x0, x1) {
    return I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
  }

  // 盒滤波（uniform_filter，边界 clamp）
  function boxFilter(a, h, w, size) {
    var I = integralImage(a, h, w);
    var out = new Float32Array(h * w);
    var p = size >> 1;
    for (var y = 0; y < h; y++) {
      var y0 = y - p, y1 = y + p + 1; if (y0 < 0) y0 = 0; if (y1 > h) y1 = h;
      for (var x = 0; x < w; x++) {
        var x0 = x - p, x1p = x + p + 1; if (x0 < 0) x0 = 0; if (x1p > w) x1p = w;
        out[y * w + x] = integralSum(I, w, y0, y1, x0, x1p) / ((y1 - y0) * (x1p - x0));
      }
    }
    return out;
  }

  // 高斯滤波 1D（边界 clamp）
  function gaussianFilter1d(sig, sigma) {
    var n = sig.length, radius = Math.max(1, Math.ceil(sigma * 3)), k = radius * 2 + 1;
    var ker = new Float32Array(k), s = 0;
    for (var i = 0; i < k; i++) { var x = i - radius; ker[i] = Math.exp(-(x * x) / (2 * sigma * sigma)); s += ker[i]; }
    for (var j = 0; j < k; j++) ker[j] /= s;
    var out = new Float32Array(n);
    for (var i2 = 0; i2 < n; i2++) {
      var acc = 0;
      for (var j2 = 0; j2 < k; j2++) { var idx = i2 + j2 - radius; if (idx < 0) idx = 0; else if (idx >= n) idx = n - 1; acc += sig[idx] * ker[j2]; }
      out[i2] = acc;
    }
    return out;
  }

  // 高斯滤波 2D（可分离，边界 clamp，多通道）
  function gaussianFilter2d(a, h, w, c, sigma) {
    var n = h * w, out = new Float32Array(n * c), tmp = new Float32Array(n * c);
    var radius = Math.max(1, Math.ceil(sigma * 3)), k = radius * 2 + 1;
    var ker = new Float32Array(k), s = 0;
    for (var i = 0; i < k; i++) { var x = i - radius; ker[i] = Math.exp(-(x * x) / (2 * sigma * sigma)); s += ker[i]; }
    for (var j = 0; j < k; j++) ker[j] /= s;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var base = (y * w + x) * c;
      for (var ch = 0; ch < c; ch++) {
        var acc = 0;
        for (var j2 = 0; j2 < k; j2++) { var xx = x + j2 - radius; if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1; acc += a[(y * w + xx) * c + ch] * ker[j2]; }
        tmp[base + ch] = acc;
      }
    }
    for (var y2 = 0; y2 < h; y2++) for (var x2 = 0; x2 < w; x2++) {
      var base2 = (y2 * w + x2) * c;
      for (var ch2 = 0; ch2 < c; ch2++) {
        var acc2 = 0;
        for (var j3 = 0; j3 < k; j3++) { var yy = y2 + j3 - radius; if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1; acc2 += tmp[(yy * w + x2) * c + ch2] * ker[j3]; }
        out[base2 + ch2] = acc2;
      }
    }
    return out;
  }

  // Sobel 3x3 梯度（边界 clamp）
  function sobelXy(gray, h, w) {
    var gx = new Float32Array(h * w), gy = new Float32Array(h * w);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var ym = y > 0 ? y - 1 : 0, yp = y < h - 1 ? y + 1 : h - 1;
      var xm = x > 0 ? x - 1 : 0, xp = x < w - 1 ? x + 1 : w - 1;
      var tl = gray[ym * w + xm], tc = gray[ym * w + x], tr = gray[ym * w + xp];
      var ml = gray[y * w + xm], mr = gray[y * w + xp];
      var bl = gray[yp * w + xm], bc = gray[yp * w + x], br = gray[yp * w + xp];
      gx[y * w + x] = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      gy[y * w + x] = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
    }
    return { gx: gx, gy: gy };
  }

  // ---------- 统计 ----------
  function sumArr(arr) { var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s; }
  function meanArr(arr) { return arr.length ? sumArr(arr) / arr.length : 0; }
  function varArr(arr) { // 总体方差
    if (!arr.length) return 0;
    var m = meanArr(arr), s = 0;
    for (var i = 0; i < arr.length; i++) { var d = arr[i] - m; s += d * d; }
    return s / arr.length;
  }
  function stdArr(arr) { return Math.sqrt(varArr(arr)); }
  function maxArr(arr) { var m = -Infinity; for (var i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i]; return m; }
  function argmaxArr(arr) { var m = -Infinity, idx = 0; for (var i = 0; i < arr.length; i++) if (arr[i] > m) { m = arr[i]; idx = i; } return idx; }
  function medianArr(arr) {
    if (!arr.length) return 0;
    var a = Array.prototype.slice.call(arr).sort(function (x, y) { return x - y; });
    var mid = a.length >> 1;
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }
  // 分位数（线性插值，q 为 0-100）
  function percentileArr(arr, q) {
    if (!arr.length) return 0;
    var a = Array.prototype.slice.call(arr).sort(function (x, y) { return x - y; });
    var idx = (a.length - 1) * q / 100;
    var lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return a[lo];
    return a[lo] + (a[hi] - a[lo]) * (idx - lo);
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  global.AiPixelMath = {
    nextPow2: nextPow2, fft1d: fft1d, rfftMag: rfftMag, irfftFromMagSq: irfftFromMagSq, acf: acf,
    integralImage: integralImage, integralSum: integralSum, boxFilter: boxFilter,
    gaussianFilter1d: gaussianFilter1d, gaussianFilter2d: gaussianFilter2d, sobelXy: sobelXy,
    sum: sumArr, mean: meanArr, var: varArr, std: stdArr, max: maxArr, argmax: argmaxArr,
    median: medianArr, percentile: percentileArr, clamp: clamp
  };
})(typeof window !== "undefined" ? window : this);
