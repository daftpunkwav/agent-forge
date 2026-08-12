# 待办：HttpOnly Cookie 会话迁移

> 状态：**未实现**（2026-08-04）  
> 相关：`docs/architecture/security.md` · `apps/api/src/lib/jwt.ts` · `apps/web/src/lib/apiToken.ts`

## 为何要做

当前 access / refresh 均存 **SPA `localStorage`**：

- XSS（Markdown 注入、第三方脚本、扩展）可直接读走双令牌
- 已有 refresh 旋转与 DB 吊销，但**窃取窗口仍在客户端可脚本访问的存储**

目标：把 **refresh（至少）** 迁到 `HttpOnly` + `Secure` + `SameSite` Cookie，使 JS 无法读取。

## 建议方案（草案，实现时再定稿）

| 项 | 建议 |
|----|------|
| access | 仍可短时存内存或短时 cookie；默认 15m |
| refresh | **仅** HttpOnly Cookie；路径限制如 `/api/v1/auth` |
| CSRF | Cookie 会话需 CSRF 防护：`SameSite=Lax/Strict` + 双提交或自定义头；跨站前端则需显式 CSRF token |
| CORS | `credentials: true`（已开）+ 精确 `CORS_ORIGIN` 白名单（禁止 `*`） |
| 登出 | `Set-Cookie` 清空 + 服务端 revoke（已有 `RefreshToken` 表） |
| 迁移 | 登录仍返回 refresh 一次 → 写 cookie；过渡期兼容 body refresh，然后废弃 body/localStorage refresh |

## 实施清单

1. API：`login` / `register` / `refresh` / `logout` 设置/清除 HttpOnly cookie  
2. Web：去掉 `localStorage` 中的 refresh；`fetch` 统一 `credentials: 'include'`  
3. 开发环境：`Secure` 在 HTTPS 才生效；本地可用 `SameSite=Lax` + 非 Secure（仅 dev）  
4. 文档与安全清单：完成后把 `docs/architecture/security.md` 对应项勾为已实现，并删除本文件「未实现」标记或改为归档  

## 明确不在本轮

- 完整 OAuth / SSO  
- 多设备会话管理 UI（可后做：列出 `RefreshToken` 并吊销）
