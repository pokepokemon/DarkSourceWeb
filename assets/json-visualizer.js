/**
 * Json 可视化：树状展示 + 增删改
 * 依赖：#json-input, #json-tree, #parse-btn, #load-file-btn, #file-input, #export-btn, #copy-btn
 */
(function () {
  var treeContainer = document.getElementById("json-tree");
  var inputEl = document.getElementById("json-input");
  var parseBtn = document.getElementById("parse-btn");
  var loadFileBtn = document.getElementById("load-file-btn");
  var fileInput = document.getElementById("file-input");
  var exportBtn = document.getElementById("export-btn");
  var copyBtn = document.getElementById("copy-btn");

  if (!treeContainer || !inputEl) return;

  var data = null;
  var expanded = Object.create(null);

  function pathKey(path) {
    return path.join(".");
  }

  function getAt(obj, path) {
    var cur = obj;
    for (var i = 0; i < path.length; i++) {
      if (cur == null) return undefined;
      cur = cur[path[i]];
    }
    return cur;
  }

  function getParentAt(obj, path) {
    if (path.length === 0) return { parent: null, key: null };
    var parent = path.length === 1 ? obj : getAt(obj, path.slice(0, -1));
    var key = path[path.length - 1];
    return { parent: parent, key: key };
  }

  function setAt(obj, path, value) {
    if (path.length === 0) {
      return;
    }
    var parent = path.length === 1 ? obj : getAt(obj, path.slice(0, -1));
    var key = path[path.length - 1];
    if (parent != null) parent[key] = value;
  }

  function deleteAt(obj, path) {
    var ref = getParentAt(obj, path);
    var parent = ref.parent;
    var key = ref.key;
    if (parent == null) return;
    if (Array.isArray(parent)) {
      parent.splice(key, 1);
    } else {
      delete parent[key];
    }
  }

  function parseValue(str) {
    var s = String(str).trim();
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "null") return null;
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return Number(s);
    try {
      return JSON.parse(s);
    } catch (e) {
      return s;
    }
  }

  function typeOf(v) {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    return typeof v;
  }

  function escapeHtml(s) {
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function renderValue(v) {
    if (v === null) return '<span class="jv-value jv-null">null</span>';
    if (typeof v === "boolean") return '<span class="jv-value jv-bool">' + v + "</span>";
    if (typeof v === "number") return '<span class="jv-value jv-num">' + v + "</span>";
    if (typeof v === "string") return '<span class="jv-value">"' + escapeHtml(v) + '"</span>';
    if (Array.isArray(v)) return '<span class="jv-type">array</span> [' + v.length + "]";
    return '<span class="jv-type">object</span> {' + Object.keys(v).length + '}';
  }

  function toggleExpand(path) {
    var key = pathKey(path);
    expanded[key] = !expanded[key];
    render();
  }

  function addChild(path) {
    var parent = path.length === 0 ? data : getAt(data, path);
    if (parent == null) return;
    if (Array.isArray(parent)) {
      showAddFieldEditor(path, true);
    } else if (typeof parent === "object") {
      showAddFieldEditor(path, false);
    }
  }

  function showAddFieldEditor(path, isArray) {
    var parent = path.length === 0 ? data : getAt(data, path);
    if (parent == null) return;
    var overlay = document.createElement("div");
    overlay.className = "jv-add-overlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9998;";
    var box = document.createElement("div");
    box.className = "jv-add-box";
    box.style.cssText = "background:var(--night-blue-soft);border:4px solid #000;box-shadow:0 4px 0 #000;padding:1rem 1.25rem;min-width:280px;";
    var keyBlock = null;
    if (!isArray) {
      keyBlock = document.createElement("div");
      keyBlock.style.marginBottom = "0.75rem";
      var keyLabel = document.createElement("label");
      keyLabel.style.cssText = "display:block;font-size:0.8rem;color:var(--accent-yellow);margin-bottom:0.25rem;";
      keyLabel.textContent = "键名 (Key)";
      var keyInput = document.createElement("input");
      keyInput.type = "text";
      keyInput.placeholder = "例如: name";
      keyInput.className = "jv-input-inline";
      keyInput.style.cssText = "width:100%;padding:0.4rem 0.5rem;font-size:0.9rem;box-sizing:border-box;";
      keyBlock.appendChild(keyLabel);
      keyBlock.appendChild(keyInput);
      box.appendChild(keyBlock);
    }
    var valLabel = document.createElement("label");
    valLabel.style.cssText = "display:block;font-size:0.8rem;color:var(--accent-yellow);margin-bottom:0.25rem;";
    valLabel.textContent = isArray ? "值 (Value，可输入 JSON 或字符串)" : "值 (Value，可输入 JSON 或字符串)";
    var valInput = document.createElement("input");
    valInput.type = "text";
    valInput.placeholder = isArray ? "例如: 0 或 \"text\" 或 []" : "例如: 0、\"text\"、true、[]、{}";
    valInput.className = "jv-input-inline";
    valInput.style.cssText = "width:100%;padding:0.4rem 0.5rem;font-size:0.9rem;box-sizing:border-box;";
    box.appendChild(valLabel);
    box.appendChild(valInput);
    var btnRow = document.createElement("div");
    btnRow.style.cssText = "margin-top:1rem;display:flex;justify-content:flex-end;gap:0.5rem;";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pixel-button";
    btn.textContent = "确定";
    btn.style.fontSize = "0.8rem";
    btn.addEventListener("click", function () {
      var keyStr = keyBlock ? keyBlock.querySelector("input").value.trim() : "";
      var valStr = valInput.value.trim();
      if (!isArray && keyStr === "") {
        return;
      }
      if (isArray) {
        if (valStr === "") {
          document.body.removeChild(overlay);
          return;
        }
        parent.push(parseValue(valStr));
      } else {
        parent[keyStr] = parseValue(valStr);
      }
      expanded[pathKey(path)] = true;
      document.body.removeChild(overlay);
      render();
    });
    btnRow.appendChild(btn);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) document.body.removeChild(overlay);
    });
    document.body.appendChild(overlay);
    if (keyBlock) keyBlock.querySelector("input").focus();
    else valInput.focus();
  }

  function editNode(path) {
    var val = getAt(data, path);
    if (val === undefined) return;
    if (val !== null && typeof val === "object") {
      var keyStr = prompt("当前为对象/数组，仅支持修改键名（对象）。输入新键名留空则不改。", path[path.length - 1]);
      if (keyStr === null) return;
      if (keyStr !== "" && typeof path[path.length - 1] === "string") {
        var ref = getParentAt(data, path);
        if (ref.parent && !(ref.key in ref.parent)) return;
        ref.parent[keyStr] = ref.parent[ref.key];
        delete ref.parent[ref.key];
      }
    } else if (typeof val === "boolean") {
      showBooleanEditor(path, val);
      return;
    } else {
      var raw = prompt("输入新值", JSON.stringify(val));
      if (raw === null) return;
      setAt(data, path, parseValue(raw));
    }
    render();
  }

  function showBooleanEditor(path, currentValue, onClose) {
    var overlay = document.createElement("div");
    overlay.className = "jv-bool-overlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9998;";
    var box = document.createElement("div");
    box.className = "jv-bool-box";
    box.style.cssText = "background:var(--night-blue-soft);border:4px solid #000;box-shadow:0 4px 0 #000;padding:1rem 1.25rem;display:flex;align-items:center;gap:0.75rem;";
    var select = document.createElement("select");
    select.className = "jv-input-inline";
    select.style.cssText = "min-width:100px;padding:0.3rem 0.5rem;font-size:0.9rem;";
    var optTrue = document.createElement("option");
    optTrue.value = "true";
    optTrue.textContent = "true";
    var optFalse = document.createElement("option");
    optFalse.value = "false";
    optFalse.textContent = "false";
    select.appendChild(optTrue);
    select.appendChild(optFalse);
    select.value = currentValue ? "true" : "false";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pixel-button";
    btn.textContent = "确定";
    btn.style.fontSize = "0.8rem";
    btn.addEventListener("click", function () {
      setAt(data, path, select.value === "true");
      document.body.removeChild(overlay);
      render();
      if (typeof onClose === "function") onClose();
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
        if (typeof onClose === "function") onClose();
      }
    });
    box.appendChild(select);
    box.appendChild(btn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  function deleteNode(path) {
    if (path.length === 0) return;
    if (!confirm("确定删除该节点？")) return;
    deleteAt(data, path);
    render();
  }

  function buildRow(path, key, value, isArray) {
    var keyLabel = isArray ? "[" + key + "]" : '"' + escapeHtml(String(key)) + '"';
    var keyClass = "jv-key" + (isArray ? " jv-array-key" : "");
    var row = document.createElement("div");
    row.className = "jv-row";
    row.setAttribute("data-path", JSON.stringify(path));

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "jv-toggle";
    toggle.setAttribute("aria-label", "展开/折叠");

    var isObj = value !== null && typeof value === "object";
    var isExpanded = isObj && expanded[pathKey(path)];

    if (isObj) {
      toggle.textContent = isExpanded ? "−" : "+";
      toggle.addEventListener("click", function () {
        toggleExpand(path);
      });
    } else {
      toggle.className = "jv-placeholder";
      toggle.textContent = "\u200B";
    }

    row.appendChild(toggle);

    var keySpan = document.createElement("span");
    keySpan.className = keyClass;
    keySpan.textContent = keyLabel + ": ";
    row.appendChild(keySpan);

    if (!isObj) {
      var valueSpan = document.createElement("span");
      valueSpan.innerHTML = renderValue(value);
      row.appendChild(valueSpan);
    } else {
      row.appendChild(document.createElement("span")).innerHTML = renderValue(value);
    }

    var actions = document.createElement("span");
    actions.className = "jv-actions";

    if (isObj) {
      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "jv-btn jv-btn-add";
      addBtn.textContent = "添加";
      addBtn.addEventListener("click", function () {
        addChild(path);
      });
      actions.appendChild(addBtn);
    }

    var editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "jv-btn";
    editBtn.textContent = "修改";
    editBtn.addEventListener("click", function () {
      editNode(path);
    });
    actions.appendChild(editBtn);

    var delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "jv-btn jv-btn-del";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", function () {
      deleteNode(path);
    });
    actions.appendChild(delBtn);

    row.appendChild(actions);

    if (isObj && isExpanded) {
      var children = document.createElement("div");
      children.className = "jv-children";
      var keys = Array.isArray(value) ? value.map(function (_, i) { return i; }) : Object.keys(value);
      keys.forEach(function (k) {
        children.appendChild(buildRow(path.concat([k]), k, value[k], Array.isArray(value)));
      });
      row.appendChild(children);
    }

    return row;
  }

  function renderRoot() {
    var wrap = document.createElement("div");
    if (data === null) return wrap;

    var keys = Array.isArray(data) ? data.map(function (_, i) { return i; }) : Object.keys(data);
    if (keys.length === 0) {
      var empty = document.createElement("div");
      empty.className = "jv-empty";
      empty.textContent = Array.isArray(data) ? "[] 空数组" : "{} 空对象";
      wrap.appendChild(empty);
      var addRoot = document.createElement("button");
      addRoot.type = "button";
      addRoot.className = "jv-btn jv-btn-add";
      addRoot.textContent = "添加根节点";
      addRoot.style.marginTop = "0.5rem";
      addRoot.addEventListener("click", function () {
        addChild([]);
      });
      wrap.appendChild(addRoot);
      return wrap;
    }

    keys.forEach(function (k) {
      wrap.appendChild(buildRow([k], k, data[k], Array.isArray(data)));
    });

    var rootAdd = document.createElement("div");
    rootAdd.style.marginTop = "0.5rem";
    var rootAddBtn = document.createElement("button");
    rootAddBtn.type = "button";
    rootAddBtn.className = "jv-btn jv-btn-add";
    rootAddBtn.textContent = "在根添加";
    rootAddBtn.addEventListener("click", function () {
      addChild([]);
    });
    rootAdd.appendChild(rootAddBtn);
    wrap.appendChild(rootAdd);

    return wrap;
  }

  function render() {
    treeContainer.innerHTML = "";
    treeContainer.classList.remove("jv-empty", "jv-parse-error");
    if (data === null) {
      treeContainer.classList.add("jv-empty");
      treeContainer.textContent = "解析后将在此显示树状结构，可对节点进行增删改。";
      if (exportBtn) exportBtn.disabled = true;
      if (copyBtn) copyBtn.disabled = true;
      return;
    }
    treeContainer.appendChild(renderRoot());
    if (exportBtn) exportBtn.disabled = false;
    if (copyBtn) copyBtn.disabled = false;
  }

  function parse() {
    var raw = inputEl.value.trim();
    if (raw === "") {
      data = null;
      expanded = Object.create(null);
      render();
      return;
    }
    try {
      data = JSON.parse(raw);
      if (data !== null && typeof data !== "object") {
        data = { value: data };
      }
      expanded = Object.create(null);
      render();
    } catch (e) {
      treeContainer.classList.add("jv-parse-error");
      treeContainer.textContent = "解析错误: " + e.message;
      data = null;
      if (exportBtn) exportBtn.disabled = true;
      if (copyBtn) copyBtn.disabled = true;
    }
  }

  function exportJson() {
    if (data === null) return;
    var root = data;
    if (data && data.value !== undefined && Object.keys(data).length === 1) {
      root = data.value;
    }
    inputEl.value = JSON.stringify(root, null, 2);
  }

  function copyToClipboard() {
    if (data === null) return;
    var root = data;
    if (data && data.value !== undefined && Object.keys(data).length === 1) {
      root = data.value;
    }
    var text = JSON.stringify(root, null, 2);
    var origLabel = copyBtn ? copyBtn.textContent : "复制到剪贴板";
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          if (copyBtn) copyBtn.textContent = "已复制";
          setTimeout(function () { if (copyBtn) copyBtn.textContent = origLabel; }, 1200);
        },
        function () { alert("复制失败，请使用导出后手动复制"); }
      );
    } else {
      inputEl.value = text;
      if (copyBtn) {
        copyBtn.textContent = "已填入输入框";
        setTimeout(function () { copyBtn.textContent = origLabel; }, 1200);
      }
    }
  }

  if (parseBtn) parseBtn.addEventListener("click", parse);
  if (loadFileBtn) {
    loadFileBtn.addEventListener("click", function () {
      fileInput.value = "";
      fileInput.click();
    });
  }
  if (fileInput) {
    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        inputEl.value = reader.result;
        parse();
      };
      reader.readAsText(file, "UTF-8");
    });
  }
  if (exportBtn) exportBtn.addEventListener("click", exportJson);
  if (copyBtn) copyBtn.addEventListener("click", copyToClipboard);
})();
