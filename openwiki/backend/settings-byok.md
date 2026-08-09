---
type: 后端业务域
title: 用户设置与 BYOK 模型配置
description: /api/v1/settings 的偏好读写、BYOK 配置的加密保存/脱敏展示/测试链路，以及 SSRF URL 策略在写入与运行时的双重校验。
tags: [backend, settings, byok, llm]
---

# 用户设置与 BYOK

路由文件：`routes/settings.ts`；依赖 `lib/prefs.ts`（preferences JSON 解析）、`lib/byokCrypto.ts`（AES-256-GCM 静态加密）、`lib/byokUrlPolicy.ts`（SSRF）、`lib/llm/providers.ts`（resolveProvider/callLlm/maskApiKey）。

## 偏好模型

`User.preferences` 是 JSON 字符串，承载：

```json
{
  "agentStyle": "professional|friendly|sassy|concise|socratic",
  "autoplayAnim": false,
  "animSpeed": 1,
  "byok": { "enabled": false, "baseUrl": "", "apiKey": "enc:v1:...", "model": "", "format": "anthropic_messages", "name": "BYOK", "vision": true }
}
```

`agentStyle` 5 种（`AGENT_STYLES`），后端只做枚举校验（`z.enum(AGENT_STYLES)`）与中文 label 映射。`animSpeed` 限 0.5–2。

## 端点

| 方法 | 路径 | 鉴权 | 行为 |
|------|------|------|------|
| GET | `/me` | requireAuth | 返回脱敏偏好 + `agentStyles` 元数据 + `apiFormats`（shared `API_FORMATS`）+ `serverProviders`（`listPublicProviders`：id/name/model/format/vision/baseUrlHost） |
| PATCH | `/me` | requireAuth | 更新 agentStyle/autoplayAnim/animSpeed/byok；`clearByokKey: true` 且 apiKey 空 → 清除已存 key |
| POST | `/test-llm` | requireAuth + 40/min | 用当前 BYOK/服务端配置打一次最小探测（`callLlm` maxTokens 32，system「Reply with exactly: OK」） |

## BYOK 生命周期（安全要点）

1. **保存**（PATCH）：`resolveByokApiKeyToStore(prev.apiKey, submitted)`——提交了新 key 用之；**留空（前端传空串）或提交值与掩码哨兵 `••••` 精确相等都表示「不改」**，此时若旧值是密文则先解密（防「对密文再加密」导致 BYOK 静默失效；哨兵仅作防御，避免误伤含 `••••` 的真实 key）；解密失败（密钥轮换）**保留原密文**，绝不落空销毁。写入前 `assertSafeByokBaseUrl`（SSRF 校验，空串=未配置允许）。`vision` 未提交时保留旧值（避免部分更新重置用户关闭的 vision）。
2. **加密**（A-03）：`isEncryptedByokKey(apiKey) ? apiKey : encryptByokKey(apiKey)` 入库——库中不留明文（`enc:v1:{iv}.{tag}.{data}`，AES-256-GCM，12 字节随机 IV）。
3. **脱敏展示**（GET）：`publicByok()` 先解密得到真实 key 再 `maskApiKey`（前 4 后 4 + `••••`），返回 `apiKeyMasked` / `hasApiKey`，**绝不下发完整 key**。
4. **运行时使用**：`agentMemory.loadUserContext` 读取时 `decryptByokConfig` 解密，供 `resolveProvider` 解析成 Provider；`byokToProvider` 内再次 `assertSafeByokBaseUrl`（写入与运行双重校验，防绕过）。
5. **测试**（test-llm）：先解密 BYOK → `resolveProvider`（BYOK 优先，无效则回退服务端默认）；无可用 Provider → 400 `NO_PROVIDER`；`BYOK_URL_REJECTED` → 400；上游失败（`LlmCallError`/`TypeError`）→ 502 `LLM_ERROR` + 安全文案（A-01）。

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart TD
    A["PATCH /settings/me<br/>byok 表单"] --> B["resolveByokApiKeyToStore<br/>防二次加密 / 保留旧密文"]
    B --> C["assertSafeByokBaseUrl<br/>SSRF 校验"]
    C --> D["encryptByokKey 入库"]
    D --> E["GET /settings/me<br/>decrypt → maskApiKey 展示"]
    D --> F["运行时 loadUserContext<br/>decrypt → resolveProvider"]
    F --> G["byokToProvider<br/>再次 assertSafeByokBaseUrl"]
    G --> H["callLlm / streamLlm"]
```

## 前端消费（SettingsPage）

- 加载成功前禁用保存（防默认值覆盖已有 BYOK）；表单初始占位与 `DEFAULT_BYOK`（StepFun step-3.7-flash）。
- 保存后清空输入框并显示掩码；「测试模型」先保存再打 test-llm。
- 「清除 Agent 缓存」：先清前端 L1（`clearAllHoverCaches` + 广播 `AGENT_CACHE_CLEARED_EVENT`），再调 `POST /api/v1/agent/cache/clear`（admin）清 L2。

## 聚焦测试

- `byokCrypto.test.ts`：roundtrip、legacy 明文兼容、损坏密文 → ''、密钥轮换 → ''、`resolveByokApiKeyToStore` 防二次加密与「解密失败保留密文」回归（I1）。
- `byokUrlPolicy.test.ts`：私网/环回/metadata/CGNAT/IPv6 拒绝、userinfo 拒绝、非 http(s) 拒绝、尾斜杠规范化。
- `providers.test.ts`：`byokToProvider`（缺字段 → null；内网 baseUrl 抛错）、`resolveProvider`（BYOK 优先、无效回退默认）。

## 相关页面

- Provider 解析与调用层：[LLM Provider](../agent/llm-providers.md)
- 安全总述（A-03 / SSRF）：[安全](../architecture/security.md)
