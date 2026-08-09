# 文件

- [身份认证、用户与作者申请](auth-users.md) - /api/v1/auth 全部端点、access+refresh 令牌生命周期与原子吊销、/api/v1/author-applications 申请审批流程（pendingGuard 并发护栏）、身份状态机。
- [社区域：话题与文章批注](community.md) - /api/v1/topics 发帖/回复/软删与列表摘要截断，/api/v1/annotations 批注写读审与 annotationAcl 三函数 ACL。
- [内容域：文章、动画与领域](content.md) - /api/v1/articles、/animations、/domains 的路由行为、权限门槛与不变量，以及 services/serialize.ts 的 API 响应契约。
- [API 组装、中间件与基础设施](overview.md) - apps/api 的 createApp 组装顺序、鉴权/校验/错误处理中间件、lib 基础设施（prisma/jwt/hash/errors/params/prefs/sse/logger）与统一错误契约。
- [用户设置与 BYOK 模型配置](settings-byok.md) - /api/v1/settings 的偏好读写、BYOK 配置的加密保存/脱敏展示/测试链路，以及 SSRF URL 策略在写入与运行时的双重校验。
