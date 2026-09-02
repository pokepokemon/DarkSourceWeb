/**
 * 伪像素规整 — 颜色空间转换：RGB <-> Lab / OKLab
 * 输入输出均为扁平 Float32Array（N*3），RGB 范围 0-255。
 * OKLab 公式对齐参考项目 src/core/color.py；Lab 用标准 sRGB D65 白点。
 */
(function (global) {
  "use strict";

  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(c) {
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }
  function cbrt(x) { return x < 0 ? -Math.pow(-x, 1 / 3) : Math.pow(x, 1 / 3); }

  // ---------- OKLab ----------
  function rgbToOklab(rgb) {
    var n = rgb.length / 3, out = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var r = srgbToLinear(rgb[i * 3] / 255);
      var g = srgbToLinear(rgb[i * 3 + 1] / 255);
      var b = srgbToLinear(rgb[i * 3 + 2] / 255);
      var l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
      var m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
      var s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      out[i * 3] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
      out[i * 3 + 1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
      out[i * 3 + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    }
    return out;
  }

  function oklabToRgb(oklab) {
    var n = oklab.length / 3, out = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var L = oklab[i * 3], A = oklab[i * 3 + 1], B = oklab[i * 3 + 2];
      var l = L + 0.3963377774 * A + 0.2158037573 * B;
      var m = L - 0.1055613458 * A - 0.0638541728 * B;
      var s = L - 0.0894841775 * A - 1.2914855480 * B;
      l = l * l * l; m = m * m * m; s = s * s * s;
      var r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
      var g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
      var b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
      out[i * 3] = Math.max(0, Math.min(255, linearToSrgb(Math.max(0, r)) * 255));
      out[i * 3 + 1] = Math.max(0, Math.min(255, linearToSrgb(Math.max(0, g)) * 255));
      out[i * 3 + 2] = Math.max(0, Math.min(255, linearToSrgb(Math.max(0, b)) * 255));
    }
    return out;
  }

  // ---------- Lab（sRGB D65） ----------
  var XN = 0.95047, ZN = 1.08883, DELTA = 6 / 29;

  function fLab(t) { return t > DELTA * DELTA * DELTA ? Math.cbrt(t) : t / (3 * DELTA * DELTA) + 4 / 29; }
  function fLabInv(t) { return t > DELTA ? t * t * t : 3 * DELTA * DELTA * (t - 4 / 29); }

  function rgbToLab(rgb) {
    var n = rgb.length / 3, out = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var r = srgbToLinear(rgb[i * 3] / 255);
      var g = srgbToLinear(rgb[i * 3 + 1] / 255);
      var b = srgbToLinear(rgb[i * 3 + 2] / 255);
      var X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / XN;
      var Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
      var Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / ZN;
      var fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
      out[i * 3] = 116 * fy - 16;
      out[i * 3 + 1] = 500 * (fx - fy);
      out[i * 3 + 2] = 200 * (fy - fz);
    }
    return out;
  }

  function labToRgb(lab) {
    var n = lab.length / 3, out = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var L = lab[i * 3], a = lab[i * 3 + 1], b = lab[i * 3 + 2];
      var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
      var X = fLabInv(fx) * XN;
      var Y = fLabInv(fy);
      var Z = fLabInv(fz) * ZN;
      var r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
      var g = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
      var bl = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
      out[i * 3] = Math.max(0, Math.min(255, linearToSrgb(Math.max(0, r)) * 255));
      out[i * 3 + 1] = Math.max(0, Math.min(255, linearToSrgb(Math.max(0, g)) * 255));
      out[i * 3 + 2] = Math.max(0, Math.min(255, linearToSrgb(Math.max(0, bl)) * 255));
    }
    return out;
  }

  global.AiPixelColor = { rgbToOklab: rgbToOklab, oklabToRgb: oklabToRgb, rgbToLab: rgbToLab, labToRgb: labToRgb };
})(typeof window !== "undefined" ? window : this);
