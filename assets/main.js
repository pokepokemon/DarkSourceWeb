// 年份由 include.js 在注入页脚时设置

// 手机端导航开关
const navToggle = document.querySelector(".nav-toggle");
const navMenu = document.getElementById("navMenu");
navToggle?.addEventListener("click", () => {
  navMenu?.classList.toggle("open");
});

// 单页面视图切换
const viewSections = document.querySelectorAll(".view-section");
const topNavButtons = document.querySelectorAll(".nav-menu .nav-link[data-view]");
const dropdownButtons = document.querySelectorAll(".nav-dropdown-link[data-view]");
const infoGroupButton = document.querySelector(".nav-group-label[data-view='devlog']");
const toolsGroupButton = document.querySelector(".nav-group-label[data-view='tools']");
const INFO_VIEWS = new Set(["devlog", "game-intro", "privacy"]);

function setView(viewId) {
  // 切换内容区域
  const activeSection = document.getElementById(viewId);
  viewSections.forEach((section) => {
    if (section.id === viewId) {
      section.classList.remove("view-in");
      section.classList.add("is-active");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          section.classList.add("view-in");
        });
      });
    } else {
      section.classList.remove("is-active", "view-in");
    }
  });

  // 顶部导航激活态
  topNavButtons.forEach((btn) => {
    const target = btn.getAttribute("data-view");
    if (!target) return;

    if (target === viewId) {
      btn.classList.add("active");
    } else if (INFO_VIEWS.has(viewId) && target === "devlog") {
      // 资讯分组：当任何一个资讯子页面激活时，高亮“资讯”
      btn.classList.add("active");
    } else if (viewId === "tools" && target === "tools") {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // 下拉菜单激活态
  dropdownButtons.forEach((btn) => {
    const target = btn.getAttribute("data-view");
    if (!target) return;
    if (target === viewId) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // 如果是资讯子页面，确保资讯按钮也有激活态
  if (INFO_VIEWS.has(viewId) && infoGroupButton) {
    infoGroupButton.classList.add("active");
  } else if (infoGroupButton && viewId !== "devlog") {
    infoGroupButton.classList.remove("active");
  }
  if (viewId === "tools" && toolsGroupButton) {
    toolsGroupButton.classList.add("active");
  } else if (toolsGroupButton) {
    toolsGroupButton.classList.remove("active");
  }
}

function bindViewTriggers() {
  const triggers = document.querySelectorAll("[data-view]");
  triggers.forEach((el) => {
    el.addEventListener("click", (e) => {
      const viewId = el.getAttribute("data-view");
      if (!viewId) return;

      e.preventDefault();
      setView(viewId);
      // 手机端点击后收起菜单
      navMenu?.classList.remove("open");
    });
  });
}

function parseDateValue(dateStr) {
  if (typeof dateStr !== "string" || !dateStr) return 0;
  const normalized = dateStr.replace(/-/g, "");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

async function loadDevlogPreview() {
  const listEl = document.getElementById("devlogPreview");
  if (!listEl) return;

  try {
    const res = await fetch("devlog/config.json", { cache: "no-store" });
    if (!res.ok) {
      listEl.innerHTML = "<li>无法加载 devlog/config.json。</li>";
      return;
    }
    const rawItems = await res.json();
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      listEl.innerHTML = "<li>当前还没有开发日志记录。</li>";
      return;
    }

    const items = [...rawItems].sort((a, b) => {
      const da = parseDateValue(a?.date);
      const db = parseDateValue(b?.date);
      return db - da;
    });

    const latest = items.slice(0, 5);
    const html = latest
      .map((item) => {
        const date = item.date ?? "";
        const raw = item.summary;
        const text = Array.isArray(raw)
          ? raw.filter((s) => s != null && String(s).trim() !== "").join(" · ") || ""
          : (raw ?? "");
        return `
          <li>
            <span class="log-tag">${date}</span>
            ${text}
          </li>
        `;
      })
      .join("");

    listEl.innerHTML = html;
  } catch (err) {
    console.error("加载 devlog 预览失败：", err);
    const listElSafe = document.getElementById("devlogPreview");
    if (listElSafe) {
      if (window.location.protocol === "file:") {
        listElSafe.innerHTML =
          "<li>本地通过 file:// 打开时，浏览器会禁止读取 devlog/config.json。请使用本地服务器或部署到 GitHub Pages 后再访问。</li>";
      } else {
        listElSafe.innerHTML = "<li>加载开发日志预览时发生错误，请检查 JSON 格式或网络访问。</li>";
      }
    }
  }
}

// 初始化（导航由 include.js 异步注入，需在 nav-injected 后或 nav 已存在时执行）
function initView() {
  bindViewTriggers();
  var hashView = window.location.hash.slice(1).replace(/^#/, "");
  if (hashView === "about") {
    window.location.replace("about.html");
    return;
  }
  if (hashView === "game-intro") {
    window.location.replace("game-intro.html");
    return;
  }
  if (hashView && document.getElementById(hashView)) setView(hashView);
  else setView("home");
  loadDevlogPreview();
}
if (document.getElementById("navMenu")) initView();
else window.addEventListener("nav-injected", initView);

