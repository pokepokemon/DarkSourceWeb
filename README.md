# DarkSourceWeb
DarkSourceWeb

## 部署到子路径（如 GitHub Pages 项目页）

若站点部署在子路径（例如 `https://用户名.github.io/DarkSourceWeb/`），请修改 **`assets/config.js`**：

```js
window.SITE_BASE = "/DarkSourceWeb/";
```

根路径部署时保持 `window.SITE_BASE = "";` 即可。
