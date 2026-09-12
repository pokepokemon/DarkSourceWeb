/**
 * 区域换色（color-remap）核心算法。
 * 纯算法、无 DOM 依赖，通过 window.ColorRemapCore 暴露。
 * 职责：
 *   - 调色板提取（RGBA 精确去重，含 alpha 区分，按像素数降序）
 *   - RGBA <-> HSVA 互转（H 0-360，S/V 0-255）
 *   - 圆形笔刷涂抹（正/负）
 *   - 区域内 remap 替换（严格 RGBA 相等）
 */
(function () {
  "use strict";

  /* ---------------- 颜色转换 ---------------- */

  /** RGBA(0-255 各通道) -> HSVA(H 0-360, S/V 0-255, A 0-255) */
  function rgbaToHsva(r, g, b, a) {
    var rf = r / 255, gf = g / 255, bf = b / 255;
    var max = Math.max(rf, gf, bf);
    var min = Math.min(rf, gf, bf);
    var d = max - min;
    var h = 0, s = 0, v = max;
    if (d !== 0) {
      s = d / max;
      if (max === rf) h = ((gf - bf) / d) % 6;
      else if (max === gf) h = (bf - rf) / d + 2;
      else h = (rf - gf) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: Math.round(h), s: Math.round(s * 255), v: Math.round(v * 255), a: Math.round(a) };
  }

  /** HSVA -> RGBA(0-255 各通道) */
  function hsvaToRgba(h, s, v, a) {
    var hn = ((h % 360) + 360) % 360 / 60;
    var sf = s / 255, vf = v / 255;
    var c = vf * sf;
    var x = c * (1 - Math.abs(hn % 2 - 1));
    var m = vf - c;
    var r = 0, g = 0, b = 0;
    if (hn < 1) { r = c; g = x; b = 0; }
    else if (hn < 2) { r = x; g = c; b = 0; }
    else if (hn < 3) { r = 0; g = c; b = x; }
    else if (hn < 4) { r = 0; g = x; b = c; }
    else if (hn < 5) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255),
      a: Math.round(a)
    };
  }

  /* ---------------- 调色板提取 ---------------- */

  /** 颜色 key（含 alpha） */
  function rgbaKey(r, g, b, a) {
    return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
  }

  /** 从 ImageData 提取调色板：RGBA 精确去重，含 alpha 区分，按像素数降序 */
  function extractPalette(imageData) {
    var data = imageData.data;
    var map = new Map();
    for (var i = 0; i < data.length; i += 4) {
      var r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      var key = rgbaKey(r, g, b, a);
      var entry = map.get(key);
      if (entry) entry.count++;
      else map.set(key, { r: r, g: g, b: b, a: a, count: 1 });
    }
    var list = Array.from(map.values());
    list.sort(function (x, y) { return y.count - x.count; });
    return list;
  }

  /* ---------------- 涂抹（圆形笔刷） ---------------- */

  /**
   * 在 mask（Uint8Array，长度 = 像素数，0/1）上按圆形笔刷涂抹。
   * @param mask 当前 mask
   * @param width 图像宽
   * @param height 图像高
   * @param cx 圆心 x（图像坐标）
   * @param cy 圆心 y
   * @param radius 笔刷半径（像素）
   * @param value 1 = 涂抹，0 = 擦除
   */
  function paintMask(mask, width, height, cx, cy, radius, value) {
    var r2 = radius * radius;
    var x0 = Math.max(0, Math.floor(cx - radius));
    var x1 = Math.min(width - 1, Math.ceil(cx + radius));
    var y0 = Math.max(0, Math.floor(cy - radius));
    var y1 = Math.min(height - 1, Math.ceil(cy + radius));
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          mask[y * width + x] = value;
        }
      }
    }
    return mask;
  }

  /* ---------------- 替换 ---------------- */

  /**
   * 根据 mask 与 remap 列表替换像素。
   * @param srcImageData 原始图像数据（不会被修改）
   * @param mask Uint8Array，1 表示在涂抹区域内
   * @param remaps [{r,g,b,a, to:{r,g,b,a}}, ...] 源色 -> 目标色，严格 RGBA 相等
   * @returns 新的 Uint8ClampedArray（RGBA）
   */
  function applyRemap(srcImageData, mask, remaps) {
    var out = new Uint8ClampedArray(srcImageData.data);
    var data = srcImageData.data;
    if (!remaps || remaps.length === 0) return out;

    // 建查找表：源色 key -> 目标 RGBA
    var lut = new Map();
    for (var i = 0; i < remaps.length; i++) {
      var rm = remaps[i];
      lut.set(rgbaKey(rm.r, rm.g, rm.b, rm.a), rm.to);
    }

    for (var p = 0; p < data.length; p += 4) {
      if (mask && mask[p >> 2] !== 1) continue; // 只处理涂抹区域内
      var key = rgbaKey(data[p], data[p + 1], data[p + 2], data[p + 3]);
      var to = lut.get(key);
      if (to) {
        out[p] = to.r;
        out[p + 1] = to.g;
        out[p + 2] = to.b;
        out[p + 3] = to.a;
      }
    }
    return out;
  }

  window.ColorRemapCore = {
    rgbaToHsva: rgbaToHsva,
    hsvaToRgba: hsvaToRgba,
    rgbaKey: rgbaKey,
    extractPalette: extractPalette,
    paintMask: paintMask,
    applyRemap: applyRemap
  };
})();
