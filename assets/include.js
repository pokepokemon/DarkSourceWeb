/**
 * 注入公共导航与页脚。依赖：页面中存在 #nav-placeholder 与 #footer-placeholder。
 * 导航、页脚使用站点根相对路径；脚本根据当前路径计算 base 并重写链接与高亮。
 */
(function () {
  var pathname = typeof location !== "undefined" && location.pathname ? location.pathname : "";
  var hash = typeof location !== "undefined" && location.hash ? location.hash.slice(1) : "";
  var segments = pathname.split("/").filter(Boolean);
  // 深度：路径末尾为文件名（含 .）时少算一层，否则按目录层数算（如 /devlog/ 需一层 ../）
  var last = segments[segments.length - 1];
  var isFile = last && last.indexOf(".") !== -1;
  var depth = segments.length > 0 ? (segments.length - (isFile ? 1 : 0)) : 0;
  var base = depth > 0 ? "../".repeat(depth) : "";
  var basePartials = base + "partials/";

  function currentNavId() {
    if (pathname.indexOf("tab-to-devlog") !== -1) return "tools-tab";
    if (pathname.indexOf("devlog") !== -1) return "devlog";
    if (pathname.indexOf("privacy") !== -1) return "privacy";
    if (pathname.indexOf("about") !== -1) return "about";
    if (pathname.indexOf("game-intro") !== -1) return "game-intro";
    if (hash === "game-intro") return "game-intro";
    if (hash === "about") return "about";
    if (hash === "tools") return "tools";
    if (hash === "privacy") return "privacy";
    if (pathname === "" || pathname === "/" || pathname.endsWith("index.html") || segments.length <= 1) return "home";
    return "home";
  }

  function applyBaseToNav(container) {
    if (!container) return;
    var links = container.querySelectorAll('a[href]');
    links.forEach(function (a) {
      var href = a.getAttribute("href") || "";
      if (href.indexOf("http") === 0 || href.indexOf("#") === 0) return;
      a.setAttribute("href", base + href);
    });
  }

  function setActiveInNav(container, currentId) {
    if (!container) return;
    var all = container.querySelectorAll("[data-nav-id]");
    all.forEach(function (el) {
      el.classList.remove("active");
      if (el.getAttribute("data-nav-id") === currentId) el.classList.add("active");
    });
    var infoLabel = container.querySelector(".nav-group-label[data-view='devlog']");
    var toolsLabel = container.querySelector(".nav-group-label[data-view='tools']");
    if (infoLabel && ["devlog", "game-intro", "privacy"].indexOf(currentId) !== -1) infoLabel.classList.add("active");
    else if (infoLabel) infoLabel.classList.remove("active");
    if (toolsLabel && currentId === "tools-tab") toolsLabel.classList.add("active");
    else if (toolsLabel) toolsLabel.classList.remove("active");
  }

  function bindMobileToggle(container) {
    var wrap = container && container.closest ? container.closest(".nav-wrap") : null;
    if (!wrap) return;
    var toggle = wrap.querySelector(".nav-toggle");
    var menu = wrap.querySelector("#navMenu");
    if (toggle && menu) toggle.addEventListener("click", function () { menu.classList.toggle("open"); });
  }

  var navPlaceholder = document.getElementById("nav-placeholder");
  var footerPlaceholder = document.getElementById("footer-placeholder");

  if (!navPlaceholder && !footerPlaceholder) return;

  var navUrl = basePartials + "nav.html";
  var footerUrl = basePartials + "footer.html";

  Promise.all([
    navPlaceholder ? fetch(navUrl).then(function (r) { return r.ok ? r.text() : ""; }) : Promise.resolve(""),
    footerPlaceholder ? fetch(footerUrl).then(function (r) { return r.ok ? r.text() : ""; }) : Promise.resolve("")
  ]).then(function (results) {
    var navHtml = results[0];
    var footerHtml = results[1];
    if (navPlaceholder && navHtml) {
      navPlaceholder.innerHTML = navHtml;
      applyBaseToNav(navPlaceholder);
      setActiveInNav(navPlaceholder, currentNavId());
      bindMobileToggle(navPlaceholder);
      try { window.dispatchEvent(new CustomEvent("nav-injected")); } catch (e) {}
    }
    if (footerPlaceholder && footerHtml) {
      footerPlaceholder.innerHTML = footerHtml;
      var yearEl = footerPlaceholder.querySelector("#year");
      if (yearEl) yearEl.textContent = new Date().getFullYear().toString();
    }
    document.body.classList.remove("page-loading");
    document.body.classList.add("page-ready");
  }).catch(function () {
    if (navPlaceholder) navPlaceholder.innerHTML = "<div class=\"nav-inner\"><a href=\"" + base + "index.html\" class=\"brand\">DarkSource</a></div>";
    if (footerPlaceholder) footerPlaceholder.innerHTML = "<div class=\"footer-inner\"><span>© " + new Date().getFullYear() + " DarkSource.</span></div>";
    document.body.classList.remove("page-loading");
    document.body.classList.add("page-ready");
  });

  /* 不支持跨文档 View Transitions 时：点击站内链接先淡出再跳转，避免白屏闪烁 */
  (function () {
    if (typeof document.startViewTransition === "function") return;
    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a || a.target === "_blank") return;
      var href = a.getAttribute("href");
      if (!href || href.indexOf("#") === 0) return;
      if (href.indexOf("http") === 0 && a.origin !== location.origin) return;
      try {
        if (a.origin !== location.origin || a.href === location.href) return;
      } catch (err) { return; }
      e.preventDefault();
      document.body.classList.add("page-transition-out");
      setTimeout(function () { location.href = a.href; }, 200);
    });
  })();
})();
