/**
 * 差分去底（Diff Matting）core —— 差分抠图法
 * 输入同一前景的「纯白底图」与「纯黑底图」（像素级对齐），
 * 输出反预乘还原真实前景色后的带透明通道图。
 *
 * 原理：
 *   Iw = α·F + (1-α)·W      (白底图像素)
 *   Ib = α·F + (1-α)·B      (黑底图像素)
 *   =>  α = 1 - (Iw - Ib) / (W - B)      (逐通道)
 *   =>  F  = (Ib - (1-α)·B) / α          (反预乘还原前景色)
 *
 * 挂载：window.DiffMattingCore
 */
(function (global) {
  "use strict";

  function clamp(v, min, max) {
    if (!Number.isFinite(v)) return min;
    return Math.min(Math.max(v, min), max);
  }

  // 三通道 alpha 合并
  function combineAlpha(r, g, b, mode) {
    if (mode === "mean") return (r + g + b) / 3;
    if (mode === "luma") return 0.299 * r + 0.587 * g + 0.114 * b;
    return Math.max(r, g, b); // max（默认，对纯色底最稳）
  }

  // alpha 羽化：3x3 box blur 迭代 radius 次
  function featherAlpha(alpha, width, height, radius) {
    if (radius < 1) return alpha;
    var src = alpha;
    var out = new Float32Array(alpha.length);
    for (var iter = 0; iter < radius; iter++) {
      for (var y = 0; y < height; y++) {
        var y0 = y > 0 ? y - 1 : 0;
        var y1 = y < height - 1 ? y + 1 : height - 1;
        for (var x = 0; x < width; x++) {
          var x0 = x > 0 ? x - 1 : 0;
          var x1 = x < width - 1 ? x + 1 : width - 1;
          var sum = 0, count = 0;
          for (var yy = y0; yy <= y1; yy++) {
            var row = yy * width;
            for (var xx = x0; xx <= x1; xx++) {
              sum += src[row + xx];
              count++;
            }
          }
          out[y * width + x] = sum / count;
        }
      }
      var tmp = src;
      src = out;
      out = tmp;
    }
    return src;
  }

  /**
   * 差分抠图主函数。
   * @param {ImageData} whiteImageData 白底图
   * @param {ImageData} blackImageData 黑底图
   * @param {object} options
   *   whiteLevel 白底参考亮度(0-255) 默认 217
   *   blackLevel 黑底参考亮度(0-255) 默认 25
   *   combine    alpha 合成方式 'max' | 'mean' | 'luma' 默认 'max'
   *   threshold  噪声阈值：alpha(0-255)低于此值强制为 0 默认 3
   *   feather    羽化半径（3x3 迭代次数 0-16）默认 0
   *   floor      反预乘下限：alpha 低于 floor/255 时该像素置 (0,0,0,0) 默认 4
   *   colorSource 前景色来源(0-100)：0=纯黑底还原 100=纯白底还原 默认 0
   * @returns {ImageData} 反预乘后的 RGBA 结果
   */
  function differenceMatte(whiteImageData, blackImageData, options) {
    var opts = options || {};
    var whiteLevel = clamp(opts.whiteLevel != null ? opts.whiteLevel : 217, 0, 255);
    var blackLevel = clamp(opts.blackLevel != null ? opts.blackLevel : 25, 0, 255);
    var combine = opts.combine || "max";
    var threshold = clamp(opts.threshold != null ? opts.threshold : 3, 0, 255);
    var feather = clamp(opts.feather != null ? opts.feather : 0, 0, 16);
    var floor = clamp(opts.floor != null ? opts.floor : 4, 0, 255) / 255;
    var colorSource = clamp(opts.colorSource != null ? opts.colorSource : 0, 0, 100) / 100;

    var width = whiteImageData.width;
    var height = whiteImageData.height;
    if (blackImageData.width !== width || blackImageData.height !== height) {
      throw new Error("白底图与黑底图尺寸不一致，无法进行差分。");
    }

    var wd = whiteImageData.data;
    var bd = blackImageData.data;
    var range = whiteLevel - blackLevel;
    var n = width * height;
    var alpha = new Float32Array(n);

    // 1) 逐通道求 alpha 并合并
    for (var i = 0; i < n; i++) {
      var o = i * 4;
      var ar, ag, ab;
      if (Math.abs(range) < 1e-6) {
        ar = ag = ab = 0; // 退化：白/黑底参考相同，该像素视为背景
      } else {
        ar = 1 - (wd[o] - bd[o]) / range;
        ag = 1 - (wd[o + 1] - bd[o + 1]) / range;
        ab = 1 - (wd[o + 2] - bd[o + 2]) / range;
      }
      alpha[i] = combineAlpha(clamp(ar, 0, 1), clamp(ag, 0, 1), clamp(ab, 0, 1), combine);
    }

    // 2) 噪声阈值：过小的 alpha 直接归零
    if (threshold > 0) {
      var t = threshold / 255;
      for (var i2 = 0; i2 < n; i2++) {
        if (alpha[i2] < t) alpha[i2] = 0;
      }
    }

    // 3) 羽化：边缘平滑
    alpha = featherAlpha(alpha, width, height, feather);

    // 4) 反预乘还原前景色（黑底 / 白底两个来源按 colorSource 混合）
    var out = new ImageData(width, height);
    var od = out.data;
    var fromBlack = 1 - colorSource;
    var fromWhite = colorSource;
    for (var i3 = 0; i3 < n; i3++) {
      var o3 = i3 * 4;
      var a = alpha[i3];
      if (a <= floor) {
        od[o3] = 0;
        od[o3 + 1] = 0;
        od[o3 + 2] = 0;
        od[o3 + 3] = 0;
      } else {
        var invA = 1 / a;
        for (var c = 0; c < 3; c++) {
          var fb = (bd[o3 + c] - (1 - a) * blackLevel) * invA; // 黑底还原
          var fw = (wd[o3 + c] - (1 - a) * whiteLevel) * invA; // 白底还原
          od[o3 + c] = clamp(fb * fromBlack + fw * fromWhite, 0, 255);
        }
        od[o3 + 3] = Math.round(a * 255);
      }
    }

    return out;
  }

  global.DiffMattingCore = {
    clamp: clamp,
    differenceMatte: differenceMatte,
  };
})(window);
