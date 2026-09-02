/** 伪像素规整 — 页面 UI 接线（参数三档渲染 + Worker 通信 + 预览下载） */
(function () {
  "use strict";
  var CFG = window.AiPixelConfig;
  if (!CFG) return;

  var state = {
    image: null, // { imageData, width, height, url }
    result: null, // { rgb, alpha, wLogic, hLogic }
    offCanvas: null,
    params: JSON.parse(JSON.stringify(CFG.DEFAULTS)),
    keepOriginalSize: false,
    busy: false
  };

  var el = {};
  ["drop-zone", "preview", "placeholder", "file-input", "meta", "params", "process-btn", "status",
    "error", "bg-select", "download-btn", "result-canvas", "result-placeholder", "result-meta"].forEach(function (id) {
      el[id] = document.getElementById(id);
    });

  var worker = null;
  try { worker = new Worker("../assets/ai-pixel-worker.js"); } catch (e) { worker = null; }

  var LEVEL_ORDER = ["simple", "normal", "expert"];
  var currentLevel = "simple";
  var hintSync = null; // 保持原图尺寸勾选框与 W/H 输入框的同步函数（渲染后指向当前 hint 字段）

  function isVisible(paramLevel) { return LEVEL_ORDER.indexOf(paramLevel) <= LEVEL_ORDER.indexOf(currentLevel); }

  // ---------- 参数渲染 ----------
  function renderParams() {
    var container = el.params;
    container.innerHTML = "";
    CFG.PARAMS.forEach(function (m) {
      if (!isVisible(m.level)) return;
      container.appendChild(renderField(m));
    });
  }

  function makeTip(help) {
    var tip = document.createElement("span");
    tip.className = "ap-tip-mark";
    tip.textContent = "?";
    tip.setAttribute("data-tip", help);
    return tip;
  }

  function renderField(m) {
    var wrap = document.createElement("div");
    wrap.className = "ap-field";
    var key = m.key;
    if (m.type === "checkbox") {
      wrap.className = "ap-field ap-checkbox-row";
      var cb = document.createElement("input");
      cb.type = "checkbox"; cb.id = "ap-" + key; cb.checked = !!state.params[key];
      cb.addEventListener("change", function () { state.params[key] = cb.checked; refresh(); });
      var lb = document.createElement("label");
      lb.htmlFor = "ap-" + key; lb.textContent = m.label;
      if (m.help) lb.appendChild(makeTip(m.help));
      wrap.appendChild(cb); wrap.appendChild(lb);
      return wrap;
    }
    var label = document.createElement("label");
    label.htmlFor = "ap-" + key; label.textContent = m.label;
    if (m.help) label.appendChild(makeTip(m.help));
    wrap.appendChild(label);
    if (m.type === "select") {
      var sel = document.createElement("select");
      sel.id = "ap-" + key; sel.className = "ap-select";
      m.options.forEach(function (o) {
        var opt = document.createElement("option");
        opt.value = o.value; opt.textContent = o.label;
        if (o.value === state.params[key]) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener("change", function () { state.params[key] = sel.value; refresh(); });
      wrap.appendChild(sel);
    } else if (m.type === "hint") {
      var row = document.createElement("div");
      row.className = "ap-hint-row";
      var wIn = document.createElement("input");
      wIn.type = "number"; wIn.className = "ap-input"; wIn.placeholder = "宽 W"; wIn.min = 1;
      if (state.params[key]) wIn.value = state.params[key].w;
      var x = document.createElement("span"); x.textContent = "×"; x.style.color = "var(--text-sub)";
      var hIn = document.createElement("input");
      hIn.type = "number"; hIn.className = "ap-input"; hIn.placeholder = "高 H"; hIn.min = 1;
      if (state.params[key]) hIn.value = state.params[key].h;
      function readHint() {
        var wv = parseInt(wIn.value, 10), hv = parseInt(hIn.value, 10);
        state.params[key] = (wv > 0 && hv > 0) ? { w: wv, h: hv } : null;
        refresh();
      }
      wIn.addEventListener("input", readHint); hIn.addEventListener("input", readHint);

      // 保持原图尺寸：勾选后以原图宽×高作为块尺寸提示（userHint），W/H 输入框禁用
      var keepLb = document.createElement("label");
      keepLb.className = "ap-keep-size";
      keepLb.title = "勾选后，输出的逻辑分辨率将等于原图尺寸（宽×高）。";
      var keepCb = document.createElement("input");
      keepCb.type = "checkbox";
      keepCb.checked = !!state.keepOriginalSize;
      var keepTxt = document.createElement("span");
      keepTxt.textContent = "保持原图尺寸";
      keepLb.appendChild(keepCb);
      keepLb.appendChild(keepTxt);

      function syncKeepSize() {
        var img = state.image;
        if (state.keepOriginalSize) {
          wIn.disabled = true; hIn.disabled = true;
          if (img) {
            wIn.value = img.width; hIn.value = img.height;
            state.params[key] = { w: img.width, h: img.height };
          } else {
            wIn.value = ""; hIn.value = "";
            state.params[key] = null;
          }
        } else {
          wIn.disabled = false; hIn.disabled = false;
          var wv = parseInt(wIn.value, 10), hv = parseInt(hIn.value, 10);
          state.params[key] = (wv > 0 && hv > 0) ? { w: wv, h: hv } : null;
        }
      }

      keepCb.addEventListener("change", function () {
        state.keepOriginalSize = keepCb.checked;
        syncKeepSize();
        refresh();
      });
      hintSync = syncKeepSize;
      if (state.keepOriginalSize) syncKeepSize();

      row.appendChild(wIn); row.appendChild(x); row.appendChild(hIn);
      wrap.appendChild(row);
      wrap.appendChild(keepLb);
    } else if (m.type === "range") {
      var row = document.createElement("div");
      row.className = "ap-range-row";
      var slider = document.createElement("input");
      slider.type = "range"; slider.min = m.min; slider.max = m.max; slider.step = m.step;
      slider.value = state.params[key];
      var num = document.createElement("input");
      num.type = "number"; num.className = "ap-input ap-number"; num.min = m.min; num.max = m.max; num.step = m.step;
      num.value = state.params[key];
      slider.addEventListener("input", function () { num.value = slider.value; state.params[key] = parseFloat(slider.value); refresh(); });
      num.addEventListener("input", function () {
        var v = parseFloat(num.value);
        if (isNaN(v)) return;
        v = Math.min(Math.max(v, parseFloat(slider.min)), parseFloat(slider.max));
        slider.value = String(v); state.params[key] = v; refresh();
      });
      row.appendChild(slider); row.appendChild(num);
      wrap.appendChild(row);
    }
    return wrap;
  }

  // ---------- 图片加载 ----------
  function loadImageFile(file) {
    if (!file || file.type.indexOf("image/") !== 0) { showError("请选择图片文件。"); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      var canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      var imageData;
      try { imageData = ctx.getImageData(0, 0, w, h); } catch (e) { showError("读取图片像素失败。"); URL.revokeObjectURL(url); return; }
      state.image = { imageData: imageData, width: w, height: h, url: url };
      el.preview.src = url; el.preview.hidden = false; el.placeholder.hidden = true;
      el.meta.textContent = file.name + " · " + w + "×" + h; el.meta.hidden = false;
      if (hintSync) hintSync();
      showError("");
      el["process-btn"].disabled = false;
      el.status.textContent = "";
    };
    img.onerror = function () { showError("图片解码失败，请更换文件。"); URL.revokeObjectURL(url); };
    img.src = url;
  }

  function showError(msg) {
    el.error.textContent = msg || "";
    el.error.hidden = !msg;
  }

  // ---------- 处理 ----------
  function process(cb) {
    if (!state.image) return;
    if (state.busy) return;
    state.busy = true;
    el["process-btn"].disabled = true;
    el.status.textContent = "处理中…";
    showError("");
    var imageData = state.image.imageData;
    var w = state.image.width, h = state.image.height, n = w * h;
    var rgb = new Float32Array(n * 3), alpha = new Float32Array(n);
    var d = imageData.data;
    for (var i = 0; i < n; i++) { rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2]; alpha[i] = d[i * 4 + 3]; }

    var params = state.params;
    function done(err, result) {
      state.busy = false;
      el["process-btn"].disabled = false;
      el.status.textContent = "";
      if (err) { showError(err.message || "处理失败。"); if (cb) cb(); return; }
      state.result = result;
      buildOffCanvas(result);
      drawResult();
      if (cb) cb();
    }

    if (worker) {
      var onMessage = function (e) {
        var msg = e.data;
        if (msg.type === "progress") { el.status.textContent = "处理中… " + Math.round(msg.frac * 100) + "%"; return; }
        worker.removeEventListener("message", onMessage);
        if (msg.type === "error") { done(new Error(msg.message)); return; }
        done(null, { rgb: msg.rgb, alpha: msg.alpha, wLogic: msg.wLogic, hLogic: msg.hLogic });
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage({ type: "run", rgb: rgb.buffer, alpha: alpha.buffer, h: h, w: w, params: params }, [rgb.buffer, alpha.buffer]);
    } else {
      loadDeps(function (err) {
        if (err) { done(err); return; }
        setTimeout(function () {
          try {
            var result = window.AiPixelPipeline.runPipeline(rgb, alpha, h, w, params);
            done(null, result);
          } catch (e2) { done(e2); }
        }, 30);
      });
    }
  }

  var depsLoaded = false;
  var DEPS = [
    "ai-pixel-math.js", "ai-pixel-color.js", "ai-pixel-denoise.js", "ai-pixel-clahe.js", "ai-pixel-aa.js",
    "ai-pixel-grid-signal.js", "ai-pixel-grid-fft.js", "ai-pixel-grid-band.js", "ai-pixel-grid-cross.js",
    "ai-pixel-grid-vote.js", "ai-pixel-grid-refine.js", "ai-pixel-grid-comb.js", "ai-pixel-grid-phase.js",
    "ai-pixel-grid-squares.js", "ai-pixel-grid-bfs.js", "ai-pixel-grid-expand.js", "ai-pixel-grid-ar.js",
    "ai-pixel-grid.js", "ai-pixel-extract.js", "ai-pixel-pipeline.js"
  ];
  function loadDeps(done) {
    if (depsLoaded) { done(); return; }
    var i = 0;
    function next() {
      if (i >= DEPS.length) { depsLoaded = true; done(); return; }
      var s = document.createElement("script");
      s.src = "../assets/" + DEPS[i];
      s.onload = function () { i++; next(); };
      s.onerror = function () { done(new Error("加载处理脚本失败，请通过 http 服务访问本页。")); };
      document.head.appendChild(s);
    }
    next();
  }

  // ---------- 结果预览 ----------
  function buildOffCanvas(result) {
    var canvas = document.createElement("canvas");
    canvas.width = result.wLogic; canvas.height = result.hLogic;
    var ctx = canvas.getContext("2d");
    var imageData = ctx.createImageData(result.wLogic, result.hLogic);
    var d = imageData.data;
    for (var i = 0; i < result.wLogic * result.hLogic; i++) {
      d[i * 4] = Math.round(result.rgb[i * 3]);
      d[i * 4 + 1] = Math.round(result.rgb[i * 3 + 1]);
      d[i * 4 + 2] = Math.round(result.rgb[i * 3 + 2]);
      d[i * 4 + 3] = Math.round(result.alpha[i]);
    }
    ctx.putImageData(imageData, 0, 0);
    state.offCanvas = canvas;
  }

  function drawResult() {
    if (!state.result || !state.offCanvas) return;
    var canvas = el["result-canvas"];
    canvas.width = state.result.wLogic; canvas.height = state.result.hLogic;
    var ctx = canvas.getContext("2d");
    var w = canvas.width, h = canvas.height;
    var bg = el["bg-select"].value;
    if (bg === "checker") {
      var cell = Math.max(8, Math.round(w / 40));
      for (var row = 0; row * cell < h; row++) for (var col = 0; col * cell < w; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? "#d8d8d8" : "#a8a8a8";
        ctx.fillRect(col * cell, row * cell, cell, cell);
      }
    } else { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(state.offCanvas, 0, 0);
    el["result-placeholder"].hidden = true;
    el["download-btn"].disabled = false;
    el["result-meta"].textContent = state.result.wLogic + "×" + state.result.hLogic + " · 透明 PNG";
    el["result-meta"].hidden = false;
  }

  function download() {
    if (!state.offCanvas) return;
    state.offCanvas.toBlob(function (blob) {
      if (!blob) { showError("导出失败。"); return; }
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "pixel-art.png";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }, "image/png");
  }

  // ---------- 交互 ----------
  function refresh() {
    if (state.result) process();
  }

  var dropZone = el["drop-zone"], fileInput = el["file-input"];
  dropZone.addEventListener("click", function () { fileInput.click(); });
  dropZone.addEventListener("dragover", function (e) { e.preventDefault(); dropZone.classList.add("ap-drag-over"); });
  dropZone.addEventListener("dragleave", function () { dropZone.classList.remove("ap-drag-over"); });
  dropZone.addEventListener("drop", function (e) {
    e.preventDefault(); dropZone.classList.remove("ap-drag-over");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) loadImageFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", function () { if (fileInput.files && fileInput.files[0]) loadImageFile(fileInput.files[0]); });

  document.querySelectorAll("input[name='level']").forEach(function (r) {
    r.addEventListener("change", function () { currentLevel = r.value; renderParams(); });
  });

  el["process-btn"].addEventListener("click", function () { process(); });
  el["download-btn"].addEventListener("click", download);
  el["bg-select"].addEventListener("change", drawResult);

  renderParams();
})();
