# 安全清单

- [x] 密码 bcrypt（cost 12）
- [x] JWT 密钥来自环境变量，长度校验
- [x] 写接口 RBAC（author/admin）
- [x] helmet / cors 白名单 / rate limit
- [x] 请求体 zod 校验
- [x] Markdown 前端 DOMPurify 消毒
- [x] 统一错误体，生产不暴露堆栈
- [x] Agent/评论接口 501，避免半实现误用
- [ ] 生产替换 JWT_SECRET 与管理员密码
- [ ] 生产使用 PostgreSQL 与 HTTPS
- [ ] 备份与密钥轮转流程

## BYOK（未来）

用户密钥仅服务端内存/加密存储，禁止写入应用日志与前端仓库。
