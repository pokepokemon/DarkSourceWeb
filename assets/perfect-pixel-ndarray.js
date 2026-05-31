/**
 * Lightweight NdArray + FFT — ported from perfectPixel web demo (ndarray-lite.ts)
 * https://github.com/theamusing/perfectPixel_webdemo
 */
(function (global) {
  function createNdArray(data, shape) {
    var stride = [];
    var s = 1;
    for (var i = shape.length - 1; i >= 0; i--) {
      stride[i] = s;
      s *= shape[i];
    }
    return {
      data: data,
      shape: shape,
      stride: stride,
      offset: 0,
      size: data.length,
      get: function () {
        var idx = 0;
        for (var i = 0; i < arguments.length; i++) idx += arguments[i] * stride[i];
        return data[idx];
      },
      set: function () {
        var args = Array.prototype.slice.call(arguments);
        var val = args.pop();
        var idx = 0;
        for (var i = 0; i < args.length; i++) idx += args[i] * stride[i];
        data[idx] = val;
      }
    };
  }

  var ops = {
    assigns: function (array, value) {
      array.data.fill(value);
    }
  };

  function fft1d(dir, real, imag) {
    var n = real.length;
    if (n <= 1) return;
    if ((n & (n - 1)) !== 0) {
      console.warn("FFT length " + n + " is not a power of 2. Results may be inaccurate.");
    }
    var j = 0;
    for (var i = 0; i < n; i++) {
      if (i < j) {
        var tr = real[i]; real[i] = real[j]; real[j] = tr;
        var ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
      }
      var m = n >> 1;
      while (m >= 1 && j >= m) {
        j -= m;
        m >>= 1;
      }
      j += m;
    }
    for (var len = 2; len <= n; len <<= 1) {
      var angle = (2 * Math.PI * dir) / len;
      var wlen_r = Math.cos(angle);
      var wlen_i = Math.sin(angle);
      for (var i2 = 0; i2 < n; i2 += len) {
        var w_r = 1;
        var w_i = 0;
        for (var k = 0; k < len / 2; k++) {
          var u_r = real[i2 + k];
          var u_i = imag[i2 + k];
          var v_r = real[i2 + k + len / 2] * w_r - imag[i2 + k + len / 2] * w_i;
          var v_i = real[i2 + k + len / 2] * w_i + imag[i2 + k + len / 2] * w_r;
          real[i2 + k] = u_r + v_r;
          imag[i2 + k] = u_i + v_i;
          real[i2 + k + len / 2] = u_r - v_r;
          imag[i2 + k + len / 2] = u_i - v_i;
          var tmp_r = w_r * wlen_r - w_i * wlen_i;
          w_i = w_r * wlen_i + w_i * wlen_r;
          w_r = tmp_r;
        }
      }
    }
    if (dir === -1) {
      for (var i3 = 0; i3 < n; i3++) {
        real[i3] /= n;
        imag[i3] /= n;
      }
    }
  }

  function fft2d(dir, real, imag) {
    var rows = real.shape[0];
    var cols = real.shape[1];
    for (var i = 0; i < rows; i++) {
      var r = new Float32Array(cols);
      var m = new Float32Array(cols);
      for (var j = 0; j < cols; j++) {
        r[j] = real.get(i, j);
        m[j] = imag.get(i, j);
      }
      fft1d(dir, r, m);
      for (var j2 = 0; j2 < cols; j2++) {
        real.set(i, j2, r[j2]);
        imag.set(i, j2, m[j2]);
      }
    }
    for (var j3 = 0; j3 < cols; j3++) {
      var r2 = new Float32Array(rows);
      var m2 = new Float32Array(rows);
      for (var i4 = 0; i4 < rows; i4++) {
        r2[i4] = real.get(i4, j3);
        m2[i4] = imag.get(i4, j3);
      }
      fft1d(dir, r2, m2);
      for (var i5 = 0; i5 < rows; i5++) {
        real.set(i5, j3, r2[i5]);
        imag.set(i5, j3, m2[i5]);
      }
    }
  }

  global.PerfectPixelNdArray = {
    createNdArray: createNdArray,
    ops: ops,
    fft2d: fft2d
  };
})(typeof window !== "undefined" ? window : this);
