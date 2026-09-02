/**
 * 差分去底（Diff Matting）tool UI
 */
(function () {
  "use strict";

  var Core = window.DiffMattingCore;
  if (!Core) return;

  var state = {
    white: null, // { imageData, width, height, url }
    black: null,
    resultImageData: null,
    resultOffCanvas: null, // 存放结果的离屏 canvas（含 alpha），供预览合成与下载复用
    resultWidth: 0,
    resultHeight: 0,
  };

  // 输入区
  var whiteDropZone = document.getElementById("white-drop-zone");
  var whiteInput = document.getElementById("white-input");
  var whitePreview = document.getElementById("white-preview");
  var whitePlaceholder = document.getElementById("white-placeholder");
  var whiteMeta = document.getElementById("white-meta");

  var blackDropZone = document.getElementById("black-drop-zone");
  var blackInput = document.getElementById("black-input");
  var blackPreview = document.getElementById("black-preview");
  var blackPlaceholder = document.getElementById("black-placeholder");
  var blackMeta = document.getElementById("black-meta");

  // 参数区
  var whiteLevel = document.getElementById("white-level");
  var whiteLevelInput = document.getElementById("white-level-input");
  var blackLevel = document.getElementById("black-level");
  var blackLevelInput = document.getElementById("black-level-input");
  var combineSelect = document.getElementById("combine-select");
  var thresholdInput = document.getElementById("threshold-input");
  var featherInput = document.getElementById("feather-input");
  var floorInput = document.getElementById("floor-input");
  var colorSource = document.getElementById("color-source");
  var colorSourceInput = document.getElementById("color-source-input");

  // 结果区
  var processBtn = document.getElementById("process-btn");
  var downloadBtn = document.getElementById("download-btn");
  var errorEl = document.getElementById("dm-error");
  var bgSelect = document.getElementById("bg-select");
  var resultCanvas = document.getElementById("result-canvas");
  var resultPlaceholder = document.getElementById("result-placeholder");
  var resultMeta = document.getElementById("result-meta");

  function showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg || "";
    errorEl.hidden = !msg;
  }

  function loadImageFile(file, kind) {
    if (!file || file.type.indexOf("image/") !== 0) {
      showError("请选择图片文件。");
      return;
    }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      var canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      var imageData;
      try {
        imageData = ctx.getImageData(0, 0, w, h);
      } catch (e) {
        showError("读取图片像素失败。");
        URL.revokeObjectURL(url);
        return;
      }
      state[kind] = { imageData: imageData, width: w, height: h, url: url };

      var preview = kind === "white" ? whitePreview : blackPreview;
      var placeholder = kind === "white" ? whitePlaceholder : blackPlaceholder;
      var meta = kind === "white" ? whiteMeta : blackMeta;
      if (preview) {
        preview.src = url;
        preview.hidden = false;
      }
      if (placeholder) placeholder.hidden = true;
      if (meta) {
        meta.textContent = file.name + " · " + w + "×" + h;
        meta.hidden = false;
      }
      showError("");
      checkReady();
    };
    img.onerror = function () {
      showError("图片解码失败，请更换文件。");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function checkReady() {
    var ready = !!(state.white && state.black);
    if (processBtn) processBtn.disabled = !ready;
    if (!ready) return;
    if (state.white.width !== state.black.width || state.white.height !== state.black.height) {
      showError(
        "白底图与黑底图尺寸不一致（" +
        state.white.width + "×" + state.white.height + " vs " +
        state.black.width + "×" + state.black.height + "），请更换图片。"
      );
    } else {
      showError("");
    }
  }

  function getParams() {
    function num(el, def, min, max) {
      var v = el ? parseFloat(el.value) : NaN;
      if (isNaN(v)) return def;
      return Core.clamp(v, min, max);
    }
    return {
      whiteLevel: num(whiteLevelInput, 217, 0, 255),
      blackLevel: num(blackLevelInput, 25, 0, 255),
      combine: combineSelect ? combineSelect.value : "max",
      threshold: num(thresholdInput, 3, 0, 255),
      feather: num(featherInput, 0, 0, 16),
      floor: num(floorInput, 4, 0, 16),
      colorSource: num(colorSourceInput, 0, 0, 100),
    };
  }

  function processAction() {
    if (!state.white || !state.black) return;
    if (state.white.width !== state.black.width || state.white.height !== state.black.height) {
      showError("两图尺寸不一致，无法处理。");
      return;
    }
    try {
      var result = Core.differenceMatte(state.white.imageData, state.black.imageData, getParams());
      state.resultImageData = result;
      state.resultWidth = result.width;
      state.resultHeight = result.height;
      if (resultCanvas) {
        resultCanvas.width = result.width;
        resultCanvas.height = result.height;
      }
      if (resultPlaceholder) resultPlaceholder.hidden = true;
      if (downloadBtn) downloadBtn.disabled = false;
      if (resultMeta) {
        resultMeta.textContent = result.width + "×" + result.height + " · 透明 PNG";
        resultMeta.hidden = false;
      }
      var off = document.createElement("canvas");
      off.width = result.width;
      off.height = result.height;
      off.getContext("2d").putImageData(result, 0, 0);
      state.resultOffCanvas = off;
      showError("");
      drawResult();
    } catch (e) {
      showError(e && e.message ? e.message : "处理失败。");
    }
  }

  function drawResult() {
    if (!resultCanvas || !state.resultImageData) return;
    var ctx = resultCanvas.getContext("2d");
    var w = resultCanvas.width;
    var h = resultCanvas.height;
    var bg = bgSelect ? bgSelect.value : "checker";

    if (bg === "checker") {
      var cell = Math.max(8, Math.round(w / 40));
      var cols = Math.ceil(w / cell) + 1;
      var rows = Math.ceil(h / cell) + 1;
      for (var row = 0; row < rows; row++) {
        for (var col = 0; col < cols; col++) {
          ctx.fillStyle = (row + col) % 2 === 0 ? "#d8d8d8" : "#a8a8a8";
          ctx.fillRect(col * cell, row * cell, cell, cell);
        }
      }
    } else {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(state.resultOffCanvas, 0, 0);
  }

  function downloadAction() {
    if (!state.resultOffCanvas) return;
    state.resultOffCanvas.toBlob(function (blob) {
      if (!blob) {
        showError("导出失败。");
        return;
      }
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "diff-matting.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }, "image/png");
  }

  // 参数变化且已有结果时，实时重算预览
  function refresh() {
    if (state.resultImageData) processAction();
  }

  function bindSlider(slider, input) {
    if (!slider || !input) return;
    slider.addEventListener("input", function () {
      input.value = slider.value;
      refresh();
    });
    input.addEventListener("input", function () {
      var v = parseFloat(input.value);
      if (isNaN(v)) return;
      v = Core.clamp(v, parseFloat(slider.min), parseFloat(slider.max));
      slider.value = String(v);
      refresh();
    });
  }

  function bindDropZone(zone, input, kind) {
    if (!zone) return;
    zone.addEventListener("click", function () {
      if (state[kind]) return; // 已加载则不重复弹窗
      if (input) input.click();
    });
    zone.addEventListener("dragover", function (e) {
      e.preventDefault();
      zone.classList.add("dm-drag-over");
    });
    zone.addEventListener("dragleave", function () {
      zone.classList.remove("dm-drag-over");
    });
    zone.addEventListener("drop", function (e) {
      e.preventDefault();
      zone.classList.remove("dm-drag-over");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        loadImageFile(e.dataTransfer.files[0], kind);
      }
    });
  }

  if (whiteInput) {
    whiteInput.addEventListener("change", function () {
      if (whiteInput.files && whiteInput.files[0]) loadImageFile(whiteInput.files[0], "white");
    });
  }
  if (blackInput) {
    blackInput.addEventListener("change", function () {
      if (blackInput.files && blackInput.files[0]) loadImageFile(blackInput.files[0], "black");
    });
  }

  bindDropZone(whiteDropZone, whiteInput, "white");
  bindDropZone(blackDropZone, blackInput, "black");
  bindSlider(whiteLevel, whiteLevelInput);
  bindSlider(blackLevel, blackLevelInput);
  bindSlider(colorSource, colorSourceInput);

  [thresholdInput, featherInput, floorInput].forEach(function (el) {
    if (el) el.addEventListener("input", refresh);
  });
  if (combineSelect) combineSelect.addEventListener("change", refresh);
  if (bgSelect) bgSelect.addEventListener("change", drawResult);
  if (processBtn) processBtn.addEventListener("click", processAction);
  if (downloadBtn) downloadBtn.addEventListener("click", downloadAction);
})();
