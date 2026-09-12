/**
 * 区域换色（color-remap）UI 接线。
 * 依赖 window.ColorRemapCore。
 *
 * 舞台模型：
 *   - stageCanvas 是一块固定大小的「背景画布」（canvasW × canvasH，约为图片 2 倍，最小 800×600）。
 *   - 图片按 zoom 倍率绘制在背景画布上的 (offsetX, offsetY) 处，可拖拽平移（钳制在画布内）。
 *   - 涂抹层按同样 zoom/offset 叠在图片上。
 */
(function () {
  "use strict";

  var Core = window.ColorRemapCore;

  /* ---------------- 元素引用 ---------------- */
  var stageWrap = document.getElementById("stage-wrap");
  var stageCanvas = document.getElementById("stage-canvas");
  var stagePlaceholder = document.getElementById("stage-placeholder");
  var stageMeta = document.getElementById("stage-meta");
  var fileInput = document.getElementById("file-input");

  var modeBrushBtn = document.getElementById("mode-brush-btn");
  var modePanBtn = document.getElementById("mode-pan-btn");

  var zoomOutBtn = document.getElementById("zoom-out-btn");
  var zoomInBtn = document.getElementById("zoom-in-btn");
  var zoomFitBtn = document.getElementById("zoom-fit-btn");
  var zoomResetBtn = document.getElementById("zoom-reset-btn");
  var zoomInput = document.getElementById("zoom-input");

  var brushSize = document.getElementById("brush-size");
  var brushSizeInput = document.getElementById("brush-size-input");
  var maskColor = document.getElementById("mask-color");
  var maskAlpha = document.getElementById("mask-alpha");
  var maskAlphaInput = document.getElementById("mask-alpha-input");
  var clearMaskBtn = document.getElementById("clear-mask-btn");
  var selectAllBtn = document.getElementById("select-all-btn");

  var paletteEl = document.getElementById("palette");
  var paletteHint = document.getElementById("palette-hint");
  var modeSelect = document.getElementById("mode-select");
  var modeSwap = document.getElementById("mode-swap");
  var colorInfo = document.getElementById("color-info");

  var pickerSv = document.getElementById("picker-sv");
  var pickerSvCursor = document.getElementById("picker-sv-cursor");
  var pickerHue = document.getElementById("picker-hue");
  var pickerHueCursor = document.getElementById("picker-hue-cursor");
  var pickerAlpha = document.getElementById("picker-alpha");
  var pickerAlphaCursor = document.getElementById("picker-alpha-cursor");
  var pickerPreview = document.getElementById("picker-preview");

  var addRemapBtn = document.getElementById("add-remap-btn");
  var clearRemapBtn = document.getElementById("clear-remap-btn");
  var remapList = document.getElementById("remap-list");
  var remapHint = document.getElementById("remap-hint");

  var processBtn = document.getElementById("process-btn");
  var bgSelect = document.getElementById("bg-select");
  var downloadBtn = document.getElementById("download-btn");
  var resultCanvas = document.getElementById("result-canvas");
  var resultPlaceholder = document.getElementById("result-placeholder");
  var resultMeta = document.getElementById("result-meta");
  var resultStatus = document.getElementById("result-status");

  /* ---------------- 状态 ---------------- */
  var state = {
    image: null,            // 规范化后的 canvas（含原始像素）
    imageData: null,        // 原始 ImageData
    width: 0,               // 图片像素宽
    height: 0,              // 图片像素高
    canvasW: 0,             // 背景画布宽
    canvasH: 0,             // 背景画布高
    mask: null,             // Uint8Array
    palette: [],
    selectedColor: null,
    pickerColor: null,
    remaps: [],
    hasImage: false,
    selectAll: false,       // 全选区域：true 时替换应用到整图
    mode: "brush",          // "brush" | "pan"
    zoom: 1,
    offsetX: 0,             // 图片左上角在画布中的 x
    offsetY: 0,             // 图片左上角在画布中的 y
    panning: false,
    panLastX: 0,
    panLastY: 0,
    painting: false,
    paintErase: false,
    dirty: false
  };

  var stageCtx = stageCanvas.getContext("2d");
  var resultCtx = resultCanvas.getContext("2d");

  /* ---------------- 通用工具 ---------------- */

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, Math.round(v)));
  }
  function clampFloat(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }
  function rgbaCss(c) {
    return "rgba(" + c.r + "," + c.g + "," + c.b + "," + (c.a / 255) + ")";
  }
  function hexToRgb(hex) {
    var h = hex.replace("#", "");
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16)
    };
  }

  /* ---------------- 调色板渲染 ---------------- */

  function renderPalette() {
    paletteEl.innerHTML = "";
    if (!state.palette.length) {
      paletteHint.textContent = "上传图片后在此列出全部颜色，点击选中作为源色。";
      return;
    }
    paletteHint.textContent = "共 " + state.palette.length + " 种颜色（含透明度差异），点击选中作为源色。";
    state.palette.forEach(function (c) {
      var sw = document.createElement("div");
      sw.className = "cr-swatch";
      sw.style.background = rgbaCss(c);
      sw.title = "RGBA(" + c.r + "," + c.g + "," + c.b + "," + c.a + ") · " + c.count + " px";
      if (state.selectedColor && c.r === state.selectedColor.r && c.g === state.selectedColor.g && c.b === state.selectedColor.b && c.a === state.selectedColor.a) {
        sw.classList.add("selected");
      }
      var cnt = document.createElement("span");
      cnt.className = "cr-count";
      cnt.textContent = c.count > 9999 ? (c.count / 1000).toFixed(1) + "k" : c.count;
      sw.appendChild(cnt);
      sw.addEventListener("click", function () {
        state.selectedColor = c;
        renderPalette();
        updateColorInfo();
        updateButtons();
        if (modeSwap.checked) {
          setPickerColor(c.r, c.g, c.b, c.a);
        }
      });
      paletteEl.appendChild(sw);
    });
  }

  /* ---------------- 取色卡 ---------------- */

  function parsePickerFromInputs() {
    var mode = modeSelect.value;
    if (mode === "rgba") {
      return {
        r: clamp(parseInt(fieldVal("p-r"), 10) || 0, 0, 255),
        g: clamp(parseInt(fieldVal("p-g"), 10) || 0, 0, 255),
        b: clamp(parseInt(fieldVal("p-b"), 10) || 0, 0, 255),
        a: clamp(parseInt(fieldVal("p-a"), 10) || 0, 0, 255)
      };
    } else {
      return Core.hsvaToRgba(
        clamp(parseInt(fieldVal("p-h"), 10) || 0, 0, 360),
        clamp(parseInt(fieldVal("p-s"), 10) || 0, 0, 255),
        clamp(parseInt(fieldVal("p-v"), 10) || 0, 0, 255),
        clamp(parseInt(fieldVal("p-a"), 10) || 0, 0, 255)
      );
    }
  }

  function fieldVal(id) {
    var el = document.getElementById(id);
    return el ? el.value : "";
  }
  function setField(id, v) {
    var el = document.getElementById(id);
    if (el) el.value = v;
  }

  function setPickerColor(r, g, b, a) {
    state.pickerColor = { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: clamp(a, 0, 255) };
    renderPickerInputs();
    renderPickerBoard();
    updateButtons();
  }

  function renderPickerInputs() {
    if (!state.pickerColor) return;
    var mode = modeSelect.value;
    var c = state.pickerColor;
    if (mode === "rgba") {
      setField("p-r", c.r); setField("p-g", c.g); setField("p-b", c.b); setField("p-a", c.a);
    } else {
      var hsv = Core.rgbaToHsva(c.r, c.g, c.b, c.a);
      setField("p-h", hsv.h); setField("p-s", hsv.s); setField("p-v", hsv.v); setField("p-a", hsv.a);
    }
  }

  function renderPickerBoard() {
    if (!state.pickerColor) return;
    var c = state.pickerColor;
    var hsv = Core.rgbaToHsva(c.r, c.g, c.b, c.a);

    var huePure = Core.hsvaToRgba(hsv.h, 255, 255, 255);
    pickerSv.style.background =
      "linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgb(" + huePure.r + "," + huePure.g + "," + huePure.b + "))";

    var svRect = pickerSv.getBoundingClientRect();
    setCursor(pickerSvCursor, (hsv.s / 255) * svRect.width, (1 - hsv.v / 255) * svRect.height);

    var hueRect = pickerHue.getBoundingClientRect();
    setCursor(pickerHueCursor, (hsv.h / 360) * hueRect.width, hueRect.height / 2);

    pickerAlpha.style.background =
      "linear-gradient(to right, rgba(" + c.r + "," + c.g + "," + c.b + ",0), rgba(" + c.r + "," + c.g + "," + c.b + ",1))";
    pickerAlpha.style.backgroundImage =
      "linear-gradient(to right, rgba(" + c.r + "," + c.g + "," + c.b + ",0), rgba(" + c.r + "," + c.g + "," + c.b + ",1)), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc)";
    pickerAlpha.style.backgroundSize = "auto, 10px 10px, 10px 10px";
    pickerAlpha.style.backgroundPosition = "0 0, 0 0, 5px 5px";
    pickerAlpha.style.backgroundColor = "#fff";

    var alphaRect = pickerAlpha.getBoundingClientRect();
    setCursor(pickerAlphaCursor, (c.a / 255) * alphaRect.width, alphaRect.height / 2);

    pickerPreview.style.backgroundImage =
      "linear-gradient(rgba(" + c.r + "," + c.g + "," + c.b + "," + (c.a / 255) + "), rgba(" + c.r + "," + c.g + "," + c.b + "," + (c.a / 255) + ")), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc)";
    pickerPreview.style.backgroundSize = "auto, 10px 10px, 10px 10px";
    pickerPreview.style.backgroundPosition = "0 0, 0 0, 5px 5px";
  }

  function setCursor(el, x, y) {
    el.style.left = x + "px";
    el.style.top = y + "px";
  }

  function updateColorInfo() {
    var mode = modeSelect.value;

    var selHtml = "";
    if (state.selectedColor) {
      var sc = state.selectedColor;
      if (mode === "rgba") {
        selHtml = "<span class='cr-label'>选中源色</span> RGBA(" + sc.r + ", " + sc.g + ", " + sc.b + ", " + sc.a + ") · " + sc.count + " px";
      } else {
        var hsv = Core.rgbaToHsva(sc.r, sc.g, sc.b, sc.a);
        selHtml = "<span class='cr-label'>选中源色</span> HSVA(" + hsv.h + ", " + hsv.s + ", " + hsv.v + ", " + hsv.a + ") · " + sc.count + " px";
      }
    } else {
      selHtml = "<span class='cr-label'>选中源色</span> 未选择";
    }

    var c = state.pickerColor || { r: 0, g: 0, b: 0, a: 255 };
    var pickerHtml = "";
    if (mode === "rgba") {
      pickerHtml =
        "<div class='cr-field'><label>R</label><input id='p-r' class='cr-input cr-number' type='number' min='0' max='255' value='" + c.r + "' />" +
        "<label>G</label><input id='p-g' class='cr-input cr-number' type='number' min='0' max='255' value='" + c.g + "' />" +
        "<label>B</label><input id='p-b' class='cr-input cr-number' type='number' min='0' max='255' value='" + c.b + "' />" +
        "<label>A</label><input id='p-a' class='cr-input cr-number' type='number' min='0' max='255' value='" + c.a + "' /></div>";
    } else {
      var hsva = Core.rgbaToHsva(c.r, c.g, c.b, c.a);
      pickerHtml =
        "<div class='cr-field'><label>H</label><input id='p-h' class='cr-input cr-number' type='number' min='0' max='360' value='" + hsva.h + "' />" +
        "<label>S</label><input id='p-s' class='cr-input cr-number' type='number' min='0' max='255' value='" + hsva.s + "' />" +
        "<label>V</label><input id='p-v' class='cr-input cr-number' type='number' min='0' max='255' value='" + hsva.v + "' />" +
        "<label>A</label><input id='p-a' class='cr-input cr-number' type='number' min='0' max='255' value='" + hsva.a + "' /></div>";
    }

    colorInfo.innerHTML = "<div>" + selHtml + "</div><div style='margin-top:0.3rem;'>" + pickerHtml + "</div>";

    ["p-r", "p-g", "p-b", "p-h", "p-s", "p-v", "p-a"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", function () {
        state.pickerColor = parsePickerFromInputs();
        renderPickerBoard();
        updateButtons();
      });
    });
  }

  /* ---------------- 取色板交互 ---------------- */

  function pickerEventPos(el, evt) {
    var rect = el.getBoundingClientRect();
    var x, y;
    if (evt.touches) { x = evt.touches[0].clientX; y = evt.touches[0].clientY; }
    else { x = evt.clientX; y = evt.clientY; }
    return {
      x: clampFloat((x - rect.left) / rect.width, 0, 1),
      y: clampFloat((y - rect.top) / rect.height, 0, 1)
    };
  }

  function pickFromSv(evt) {
    var p = pickerEventPos(pickerSv, evt);
    var c = state.pickerColor || { r: 0, g: 0, b: 0, a: 255 };
    var hsv = Core.rgbaToHsva(c.r, c.g, c.b, c.a);
    var s = Math.round(p.x * 255);
    var v = Math.round((1 - p.y) * 255);
    var rgba = Core.hsvaToRgba(hsv.h, s, v, c.a);
    setPickerColor(rgba.r, rgba.g, rgba.b, rgba.a);
  }
  function pickFromHue(evt) {
    var p = pickerEventPos(pickerHue, evt);
    var c = state.pickerColor || { r: 0, g: 0, b: 0, a: 255 };
    var hsv = Core.rgbaToHsva(c.r, c.g, c.b, c.a);
    var h = Math.round(p.x * 360) % 360;
    if (h < 0) h += 360;
    var rgba = Core.hsvaToRgba(h, hsv.s, hsv.v, c.a);
    setPickerColor(rgba.r, rgba.g, rgba.b, rgba.a);
  }
  function pickFromAlpha(evt) {
    var p = pickerEventPos(pickerAlpha, evt);
    var c = state.pickerColor || { r: 0, g: 0, b: 0, a: 255 };
    var a = Math.round(p.x * 255);
    setPickerColor(c.r, c.g, c.b, a);
  }

  function bindPickerDrag(el, handler) {
    var dragging = false;
    el.addEventListener("mousedown", function (e) { dragging = true; handler(e); e.preventDefault(); });
    window.addEventListener("mousemove", function (e) { if (dragging) handler(e); });
    window.addEventListener("mouseup", function () { dragging = false; });
    el.addEventListener("touchstart", function (e) { dragging = true; handler(e); e.preventDefault(); }, { passive: false });
    window.addEventListener("touchmove", function (e) { if (dragging) { handler(e); e.preventDefault(); } }, { passive: false });
    window.addEventListener("touchend", function () { dragging = false; });
  }

  bindPickerDrag(pickerSv, pickFromSv);
  bindPickerDrag(pickerHue, pickFromHue);
  bindPickerDrag(pickerAlpha, pickFromAlpha);

  /* ---------------- Remap 列表 ---------------- */

  function renderRemapList() {
    remapList.innerHTML = "";
    if (!state.remaps.length) {
      remapHint.textContent = "选中调色板颜色（源色）并在取色卡填入目标色后，点击「创建 Remap」。";
      return;
    }
    remapHint.textContent = "共 " + state.remaps.length + " 组映射，可点击右侧删除。";
    state.remaps.forEach(function (rm, idx) {
      var item = document.createElement("div");
      item.className = "cr-remap-item";

      var sw1 = document.createElement("span");
      sw1.className = "cr-swatch-mini";
      sw1.style.background = rgbaCss(rm);
      sw1.title = "源色 RGBA(" + rm.r + "," + rm.g + "," + rm.b + "," + rm.a + ")";

      var arrow = document.createElement("span");
      arrow.className = "cr-arrow";
      arrow.textContent = "→";

      var sw2 = document.createElement("span");
      sw2.className = "cr-swatch-mini";
      sw2.style.background = rgbaCss(rm.to);
      sw2.title = "目标色 RGBA(" + rm.to.r + "," + rm.to.g + "," + rm.to.b + "," + rm.to.a + ")";

      var text = document.createElement("span");
      text.className = "cr-remap-text";
      text.textContent = "(" + rm.r + "," + rm.g + "," + rm.b + "," + rm.a + ") → (" + rm.to.r + "," + rm.to.g + "," + rm.to.b + "," + rm.to.a + ")";

      var del = document.createElement("button");
      del.className = "cr-remap-del";
      del.type = "button";
      del.textContent = "×";
      del.title = "删除此映射";
      del.addEventListener("click", function () {
        state.remaps.splice(idx, 1);
        renderRemapList();
        updateButtons();
        markDirty();
      });

      item.appendChild(sw1);
      item.appendChild(arrow);
      item.appendChild(sw2);
      item.appendChild(text);
      item.appendChild(del);
      remapList.appendChild(item);
    });
  }

  /* ---------------- 结果 ---------------- */

  function setCheckerBackground(ctx, w, h) {
    var cell = 8;
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#cccccc";
    for (var y = 0; y < h; y += cell) {
      for (var x = 0; x < w; x += cell) {
        if (((x / cell) + (y / cell)) % 2 === 0) ctx.fillRect(x, y, cell, cell);
      }
    }
    ctx.restore();
  }

  function recomputeResult() {
    if (!state.hasImage || !state.imageData) return;
    // 全选区域时忽略涂抹 mask，对整图应用 remap
    var activeMask = state.selectAll ? null : state.mask;
    var out = Core.applyRemap(state.imageData, activeMask, state.remaps);
    var img = new ImageData(out, state.width, state.height);
    resultCanvas.width = state.width;
    resultCanvas.height = state.height;

    var bg = bgSelect.value;
    if (bg === "checker") setCheckerBackground(resultCtx, state.width, state.height);
    else {
      resultCtx.fillStyle = bg;
      resultCtx.fillRect(0, 0, state.width, state.height);
    }
    resultCtx.putImageData(img, 0, 0);

    resultPlaceholder.style.display = "none";
    resultMeta.hidden = false;
    resultMeta.textContent = "结果尺寸 " + state.width + " × " + state.height;
    downloadBtn.disabled = false;
    state.dirty = false;
    updateStatus();
  }

  function markDirty() {
    state.dirty = true;
    updateStatus();
  }

  function updateStatus() {
    if (!state.hasImage) {
      resultStatus.textContent = "";
      return;
    }
    if (state.dirty) {
      resultStatus.textContent = "有未处理的改动，请点击「处理」";
      resultStatus.classList.add("dirty");
    } else {
      resultStatus.textContent = "已是最新结果";
      resultStatus.classList.remove("dirty");
    }
  }

  /* ---------------- 舞台绘制 ---------------- */

  // 图片当前显示尺寸
  function dispW() { return state.width * state.zoom; }
  function dispH() { return state.height * state.zoom; }

  /** 把图片的 offset 钳制在画布内（图片不能超出画布边界） */
  function clampOffset() {
    var dw = dispW(), dh = dispH();
    if (dw <= state.canvasW) {
      state.offsetX = clampFloat(state.offsetX, 0, state.canvasW - dw);
    } else {
      state.offsetX = clampFloat(state.offsetX, state.canvasW - dw, 0);
    }
    if (dh <= state.canvasH) {
      state.offsetY = clampFloat(state.offsetY, 0, state.canvasH - dh);
    } else {
      state.offsetY = clampFloat(state.offsetY, state.canvasH - dh, 0);
    }
  }

  function redrawStage() {
    if (!state.hasImage) return;
    var ctx = stageCtx;

    // 1. 填充背景画布
    ctx.fillStyle = "rgba(10, 14, 30, 0.9)";
    ctx.fillRect(0, 0, state.canvasW, state.canvasH);

    // 2. 绘制图片（按 zoom 缩放，位置 offset）
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.image, state.offsetX, state.offsetY, dispW(), dispH());

    // 3. 绘制涂抹层（同样缩放/平移）
    var overlay = document.createElement("canvas");
    overlay.width = state.width;
    overlay.height = state.height;
    var octx = overlay.getContext("2d");
    var imgData = octx.createImageData(state.width, state.height);
    var mcolor = hexToRgb(maskColor.value);
    var aVal = clamp(parseInt(maskAlpha.value, 10) || 0, 0, 100) / 100;
    var d = imgData.data;
    for (var i = 0; i < state.mask.length; i++) {
      if (state.mask[i] === 1) {
        var o = i * 4;
        d[o] = mcolor.r;
        d[o + 1] = mcolor.g;
        d[o + 2] = mcolor.b;
        d[o + 3] = Math.round(aVal * 255);
      }
    }
    octx.putImageData(imgData, 0, 0);
    ctx.drawImage(overlay, state.offsetX, state.offsetY, dispW(), dispH());
  }

  /* ---------------- 缩放 ---------------- */

  function applyZoomInput() {
    var z = clampFloat(parseFloat(zoomInput.value) || 100, 5, 800) / 100;
    state.zoom = z;
    zoomInput.value = Math.round(z * 100);
    clampOffset();
    redrawStage();
  }

  function setZoom(z) {
    if (!state.hasImage) return;
    // 以图片中心为锚点缩放
    var oldW = dispW(), oldH = dispH();
    var cx = state.offsetX + oldW / 2;
    var cy = state.offsetY + oldH / 2;
    state.zoom = clampFloat(z, 0.05, 8);
    var newW = dispW(), newH = dispH();
    state.offsetX = cx - newW / 2;
    state.offsetY = cy - newH / 2;
    clampOffset();
    zoomInput.value = Math.round(state.zoom * 100);
    redrawStage();
  }

  function zoomIn() { setZoom(state.zoom * 1.25); }
  function zoomOut() { setZoom(state.zoom / 1.25); }
  function zoomReset() { setZoom(1); }
  function zoomFit() {
    if (!state.hasImage) return;
    var wrapRect = stageWrap.getBoundingClientRect();
    var availW = Math.max(40, wrapRect.width - 8);
    var availH = Math.max(40, wrapRect.height - 8);
    var fit = Math.min(availW / state.width, availH / state.height, 1);
    setZoom(fit);
  }

  /* ---------------- 图片加载 ---------------- */

  function loadImage(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var naturalW = img.naturalWidth;
        var naturalH = img.naturalHeight;

        var MAX = 2048;
        var scale = 1;
        if (naturalW > MAX || naturalH > MAX) {
          scale = Math.min(MAX / naturalW, MAX / naturalH);
        }

        var cw = Math.max(1, Math.round(naturalW * scale));
        var ch = Math.max(1, Math.round(naturalH * scale));

        var tmp = document.createElement("canvas");
        tmp.width = cw;
        tmp.height = ch;
        var tctx = tmp.getContext("2d");
        tctx.drawImage(img, 0, 0, cw, ch);
        state.imageData = tctx.getImageData(0, 0, cw, ch);
        state.image = tmp;
        state.width = cw;
        state.height = ch;
        state.mask = new Uint8Array(cw * ch);
        state.hasImage = true;
        state.remaps = [];
        state.selectedColor = null;
        state.dirty = false;
        state.zoom = 1;
        state.selectAll = false;
        selectAllBtn.classList.remove("active");

        // 背景画布尺寸：约 2× 图片，最小 800×600
        state.canvasW = Math.max(800, cw * 2);
        state.canvasH = Math.max(600, ch * 2);

        // 图片初始居中
        state.offsetX = (state.canvasW - cw) / 2;
        state.offsetY = (state.canvasH - ch) / 2;

        stageCanvas.width = state.canvasW;
        stageCanvas.height = state.canvasH;
        stagePlaceholder.style.display = "none";
        stageCanvas.hidden = false;
        stageWrap.classList.add("has-image");

        stageMeta.hidden = false;
        stageMeta.textContent = "原图 " + naturalW + " × " + naturalH + (scale < 1 ? "（已缩放到 " + cw + " × " + ch + "）" : "") + " · 画布 " + state.canvasW + " × " + state.canvasH;

        state.palette = Core.extractPalette(state.imageData);
        renderPalette();
        updateColorInfo();
        renderRemapList();
        updateButtons();
        recomputeResult();
        redrawStage();

        clearMaskBtn.disabled = false;
        selectAllBtn.disabled = false;
        zoomOutBtn.disabled = false;
        zoomInBtn.disabled = false;
        zoomFitBtn.disabled = false;
        zoomResetBtn.disabled = false;
        zoomInput.value = "100";

        zoomFit();
      };
      img.onerror = function () { alert("图片加载失败，请换一张图片重试。"); };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* ---------------- 坐标换算 ---------------- */

  /** 鼠标事件 -> 画布坐标 */
  function eventCanvasPos(evt) {
    var rect = stageCanvas.getBoundingClientRect();
    var x, y;
    if (evt.touches) { x = evt.touches[0].clientX; y = evt.touches[0].clientY; }
    else { x = evt.clientX; y = evt.clientY; }
    return {
      x: (x - rect.left) * (state.canvasW / rect.width),
      y: (y - rect.top) * (state.canvasH / rect.height)
    };
  }

  /** 画布坐标 -> 图片像素坐标 */
  function canvasToImage(cx, cy) {
    return {
      x: (cx - state.offsetX) / state.zoom,
      y: (cy - state.offsetY) / state.zoom
    };
  }

  /* ---------------- 模式切换 ---------------- */

  function setMode(mode) {
    state.mode = mode;
    modeBrushBtn.classList.toggle("active", mode === "brush");
    modePanBtn.classList.toggle("active", mode === "pan");
    stageCanvas.style.cursor = mode === "pan" ? "grab" : "crosshair";
  }

  /* ---------------- 鼠标交互 ---------------- */

  function onMouseDown(evt) {
    if (!state.hasImage) return;
    evt.preventDefault();

    if (state.mode === "pan" || evt.button === 1) {
      state.panning = true;
      state.panLastX = evt.clientX;
      state.panLastY = evt.clientY;
      stageCanvas.style.cursor = "grabbing";
      return;
    }

    if (evt.button === 0) {
      state.painting = true;
      state.paintErase = evt.altKey === true;
      paintAt(evt);
    }
  }

  function onMouseMove(evt) {
    if (!state.hasImage) return;

    if (state.panning) {
      var dx = evt.clientX - state.panLastX;
      var dy = evt.clientY - state.panLastY;
      state.panLastX = evt.clientX;
      state.panLastY = evt.clientY;
      // 画布坐标位移
      var rect = stageCanvas.getBoundingClientRect();
      var scaleX = state.canvasW / rect.width;
      var scaleY = state.canvasH / rect.height;
      state.offsetX += dx * scaleX;
      state.offsetY += dy * scaleY;
      clampOffset();
      redrawStage();
      return;
    }

    if (state.painting) {
      paintAt(evt);
    }
  }

  function onMouseUp(evt) {
    if (state.panning) {
      state.panning = false;
      stageCanvas.style.cursor = state.mode === "pan" ? "grab" : "crosshair";
    }
    if (state.painting) {
      state.painting = false;
    }
  }

  function paintAt(evt) {
    var cp = eventCanvasPos(evt);
    var ip = canvasToImage(cp.x, cp.y);
    // 只在图片范围内涂抹
    if (ip.x < 0 || ip.y < 0 || ip.x >= state.width || ip.y >= state.height) return;
    var r = clamp(parseInt(brushSize.value, 10) || 1, 1, 500);
    Core.paintMask(state.mask, state.width, state.height, ip.x, ip.y, r, state.paintErase ? 0 : 1);
    redrawStage();
    markDirty();
  }

  stageCanvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  stageCanvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  // 触摸：单指笔刷/拖拽（按模式），不做缩放
  stageCanvas.addEventListener("touchstart", function (e) {
    if (!state.hasImage) return;
    e.preventDefault();
    if (state.mode === "pan") {
      state.panning = true;
      state.panLastX = e.touches[0].clientX;
      state.panLastY = e.touches[0].clientY;
    } else {
      state.painting = true;
      state.paintErase = false;
      paintAt(e);
    }
  }, { passive: false });

  window.addEventListener("touchmove", function (e) {
    if (!state.hasImage) return;
    if (state.panning) {
      e.preventDefault();
      var dx = e.touches[0].clientX - state.panLastX;
      var dy = e.touches[0].clientY - state.panLastY;
      state.panLastX = e.touches[0].clientX;
      state.panLastY = e.touches[0].clientY;
      var rect = stageCanvas.getBoundingClientRect();
      state.offsetX += dx * (state.canvasW / rect.width);
      state.offsetY += dy * (state.canvasH / rect.height);
      clampOffset();
      redrawStage();
    } else if (state.painting) {
      e.preventDefault();
      paintAt(e);
    }
  }, { passive: false });

  window.addEventListener("touchend", function () {
    state.panning = false;
    state.painting = false;
  });

  /* ---------------- 上传交互 ---------------- */

  stageWrap.addEventListener("click", function (e) {
    if (e.target === stageCanvas) return;
    fileInput.click();
  });
  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files[0]) loadImage(fileInput.files[0]);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach(function (ev) {
    stageWrap.addEventListener(ev, function (e) { e.preventDefault(); stageWrap.classList.add("drag-over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    stageWrap.addEventListener(ev, function (e) { e.preventDefault(); stageWrap.classList.remove("drag-over"); });
  });
  stageWrap.addEventListener("drop", function (e) {
    var files = e.dataTransfer && e.dataTransfer.files;
    if (files && files[0]) loadImage(files[0]);
  });

  /* ---------------- 按钮与参数 ---------------- */

  function updateButtons() {
    addRemapBtn.disabled = !(state.hasImage && state.selectedColor && state.pickerColor);
    clearRemapBtn.disabled = state.remaps.length === 0;
    processBtn.disabled = !state.hasImage;
  }

  modeBrushBtn.addEventListener("click", function () { setMode("brush"); });
  modePanBtn.addEventListener("click", function () { setMode("pan"); });

  addRemapBtn.addEventListener("click", function () {
    if (!state.selectedColor || !state.pickerColor) return;
    state.remaps.push({
      r: state.selectedColor.r, g: state.selectedColor.g, b: state.selectedColor.b, a: state.selectedColor.a,
      to: { r: state.pickerColor.r, g: state.pickerColor.g, b: state.pickerColor.b, a: state.pickerColor.a }
    });
    renderRemapList();
    updateButtons();
    markDirty();
  });

  clearRemapBtn.addEventListener("click", function () {
    state.remaps = [];
    renderRemapList();
    updateButtons();
    markDirty();
  });

  clearMaskBtn.addEventListener("click", function () {
    if (!state.hasImage) return;
    state.mask = new Uint8Array(state.width * state.height);
    redrawStage();
    markDirty();
  });

  selectAllBtn.addEventListener("click", function () {
    if (!state.hasImage) return;
    state.selectAll = !state.selectAll;
    selectAllBtn.classList.toggle("active", state.selectAll);
    markDirty();
  });

  processBtn.addEventListener("click", function () { recomputeResult(); });

  brushSize.addEventListener("input", function () { brushSizeInput.value = brushSize.value; });
  brushSizeInput.addEventListener("input", function () { brushSize.value = brushSizeInput.value; });

  maskAlpha.addEventListener("input", function () { maskAlphaInput.value = maskAlpha.value; redrawStage(); });
  maskAlphaInput.addEventListener("input", function () { maskAlpha.value = maskAlphaInput.value; redrawStage(); });
  maskColor.addEventListener("input", function () { redrawStage(); });

  modeSelect.addEventListener("change", function () {
    updateColorInfo();
    renderPickerInputs();
    renderPickerBoard();
  });

  bgSelect.addEventListener("change", function () { recomputeResult(); });

  zoomInBtn.addEventListener("click", zoomIn);
  zoomOutBtn.addEventListener("click", zoomOut);
  zoomResetBtn.addEventListener("click", zoomReset);
  zoomFitBtn.addEventListener("click", zoomFit);
  zoomInput.addEventListener("change", applyZoomInput);

  downloadBtn.addEventListener("click", function () {
    if (!state.hasImage) return;
    var link = document.createElement("a");
    link.download = "color-remap.png";
    link.href = resultCanvas.toDataURL("image/png");
    link.click();
  });

  /* ---------------- 初始化 ---------------- */
  function init() {
    state.pickerColor = { r: 0, g: 0, b: 0, a: 255 };
    setMode("brush");
    renderPalette();
    updateColorInfo();
    renderRemapList();
    updateButtons();
    renderPickerBoard();
    updateStatus();
  }

  init();
})();
