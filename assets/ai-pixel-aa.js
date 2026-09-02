/** 伪像素规整 — 抗锯齿消除（OKLab 三角形不等式，移植 aa_removal.py） */
(function (global) {
  "use strict";
  var C = global.AiPixelColor;

  var OFF = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  function removeAntiAliasing(img, h, w, threshold, passes) {
    var n = h * w;
    var rgb = new Float32Array(img);
    var oklab = C.rgbToOklab(rgb);
    var nrgb = new Float32Array(8 * 3), nok = new Float32Array(8 * 3), lab = new Int32Array(8);
    var counts = new Int32Array(8);

    function quantize(r, g, b) { return (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5); }

    for (var p = 0; p < passes; p++) {
      for (var i = 0; i < n; i++) {
        var y = (i / w) | 0, x = i % w;
        // 中心
        var cr = rgb[i * 3], cg = rgb[i * 3 + 1], cb = rgb[i * 3 + 2];
        var cL = oklab[i * 3], cA = oklab[i * 3 + 1], cB = oklab[i * 3 + 2];
        var lab_c = quantize(cr, cg, cb);
        // 8 邻域
        for (var k = 0; k < 8; k++) {
          var ny = y + OFF[k][0]; if (ny < 0) ny = 0; else if (ny >= h) ny = h - 1;
          var nx = x + OFF[k][1]; if (nx < 0) nx = 0; else if (nx >= w) nx = w - 1;
          var o = (ny * w + nx) * 3;
          var r = rgb[o], g = rgb[o + 1], b = rgb[o + 2];
          nrgb[k * 3] = r; nrgb[k * 3 + 1] = g; nrgb[k * 3 + 2] = b;
          nok[k * 3] = oklab[o]; nok[k * 3 + 1] = oklab[o + 1]; nok[k * 3 + 2] = oklab[o + 2];
          lab[k] = quantize(r, g, b);
        }
        // 频次
        for (var k2 = 0; k2 < 8; k2++) { counts[k2] = 0; for (var l = 0; l < 8; l++) if (lab[l] === lab[k2]) counts[k2]++; }
        // 前两类主色
        var arg0 = 0, m0 = -1, arg1 = 0, m1 = -1;
        for (var k3 = 0; k3 < 8; k3++) if (counts[k3] > m0) { m0 = counts[k3]; arg0 = k3; }
        var lab0 = lab[arg0];
        for (var k4 = 0; k4 < 8; k4++) { var c4 = (lab[k4] !== lab0) ? counts[k4] : -1; if (c4 > m1) { m1 = c4; arg1 = k4; } }
        var lab1 = lab[arg1];
        // 排除中心色
        var arg0n = 0, m0n = -1, arg1n = 0, m1n = -1;
        for (var k5 = 0; k5 < 8; k5++) { var c5 = (lab[k5] !== lab_c) ? counts[k5] : -1; if (c5 > m0n) { m0n = c5; arg0n = k5; } }
        var lab0n = lab[arg0n];
        for (var k6 = 0; k6 < 8; k6++) { var c6 = (lab[k6] !== lab0n && lab[k6] !== lab_c) ? counts[k6] : -1; if (c6 > m1n) { m1n = c6; arg1n = k6; } }
        var lab1n = lab[arg1n];
        // 各类邻域均值
        var aR = 0, aG = 0, aB = 0, aL = 0, aA = 0, aB_ = 0, ac = 0;
        var bR = 0, bG = 0, bB = 0, bL = 0, bA = 0, bB_ = 0, bc = 0;
        var anR = 0, anG = 0, anB = 0, anL = 0, anA = 0, anB_ = 0, anc = 0;
        var bnR = 0, bnG = 0, bnB = 0, bnL = 0, bnA = 0, bnB_ = 0, bnc = 0;
        for (var k7 = 0; k7 < 8; k7++) {
          var r7 = nrgb[k7 * 3], g7 = nrgb[k7 * 3 + 1], b7 = nrgb[k7 * 3 + 2];
          var L7 = nok[k7 * 3], A7 = nok[k7 * 3 + 1], B7 = nok[k7 * 3 + 2];
          if (lab[k7] === lab0) { ac++; aR += r7; aG += g7; aB += b7; aL += L7; aA += A7; aB_ += B7; }
          if (lab[k7] === lab1) { bc++; bR += r7; bG += g7; bB += b7; bL += L7; bA += A7; bB_ += B7; }
          if (lab[k7] === lab0n) { anc++; anR += r7; anG += g7; anB += b7; anL += L7; anA += A7; anB_ += B7; }
          if (lab[k7] === lab1n) { bnc++; bnR += r7; bnG += g7; bnB += b7; bnL += L7; bnA += A7; bnB_ += B7; }
        }
        ac = Math.max(ac, 1); bc = Math.max(bc, 1); anc = Math.max(anc, 1); bnc = Math.max(bnc, 1);
        aR /= ac; aG /= ac; aB /= ac; aL /= ac; aA /= ac; aB_ /= ac;
        bR /= bc; bG /= bc; bB /= bc; bL /= bc; bA /= bc; bB_ /= bc;
        anR /= anc; anG /= anc; anB /= anc; anL /= anc; anA /= anc; anB_ /= anc;
        bnR /= bnc; bnG /= bnc; bnB /= bnc; bnL /= bnc; bnA /= bnc; bnB_ /= bnc;
        // 三角形不等式
        var dab = Math.sqrt((aL - bL) * (aL - bL) + (aA - bA) * (aA - bA) + (aB_ - bB_) * (aB_ - bB_));
        var dpa = Math.sqrt((cL - aL) * (cL - aL) + (cA - aA) * (cA - aA) + (cB - aB_) * (cB - aB_));
        var dpb = Math.sqrt((cL - bL) * (cL - bL) + (cA - bA) * (cA - bA) + (cB - bB_) * (cB - bB_));
        var tri = Math.abs(dpa + dpb - dab) / Math.max(dab, 1e-12);
        var dabn = Math.sqrt((anL - bnL) * (anL - bnL) + (anA - bnA) * (anA - bnA) + (anB_ - bnB_) * (anB_ - bnB_));
        var dpan = Math.sqrt((cL - anL) * (cL - anL) + (cA - anA) * (cA - anA) + (cB - anB_) * (cB - anB_));
        var dpbn = Math.sqrt((cL - bnL) * (cL - bnL) + (cA - bnA) * (cA - bnA) + (cB - bnB_) * (cB - bnB_));
        var trin = Math.abs(dpan + dpbn - dabn) / Math.max(dabn, 1e-12);
        var pSolid = (lab_c === lab0) || (lab_c === lab1);
        var mainMask = (!pSolid) && dab > threshold && tri < 0.4 && dpa > 1e-4 && dpb > 1e-4;
        var nsMask = pSolid && dabn > threshold && trin < 0.05 && dpan > 1e-4 && dpbn > 1e-4;
        if (mainMask || nsMask) {
          var tR, tG, tB, tL, tA, tB2;
          if (mainMask) {
            var nearA = dpa <= dpb;
            tR = nearA ? aR : bR; tG = nearA ? aG : bG; tB = nearA ? aB : bB;
            tL = nearA ? aL : bL; tA = nearA ? aA : bA; tB2 = nearA ? aB_ : bB_;
          } else {
            var nearAn = dpan <= dpbn;
            tR = nearAn ? anR : bnR; tG = nearAn ? anG : bnG; tB = nearAn ? anB : bnB;
            tL = nearAn ? anL : bnL; tA = nearAn ? anA : bnA; tB2 = nearAn ? anB_ : bnB_;
          }
          rgb[i * 3] = tR; rgb[i * 3 + 1] = tG; rgb[i * 3 + 2] = tB;
          oklab[i * 3] = tL; oklab[i * 3 + 1] = tA; oklab[i * 3 + 2] = tB2;
        }
      }
    }
    return rgb;
  }

  global.AiPixelAa = { removeAntiAliasing: removeAntiAliasing };
})(typeof window !== "undefined" ? window : this);
