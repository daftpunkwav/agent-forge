import { z } from 'zod';

/** Agent 路由请求体校验（与 orchestrator 共享，避免编排层依赖 routes） */
export const explainSchemaFixed = z.object({
  mode: z.enum(['hover', 'click']),
  selection: z.object({
    text: z.string().min(1).max(4000),
    context: z.string().max(2000).optional(),
    sectionId: z.string().max(120).optional(),
    route: z.string().max(300).optional(),
    articleSlug: z.string().max(120).optional(),
    title: z.string().max(200).optional(),
  }),
  style: z.string().max(40).optional(),
});

export const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().max(64).optional(),
  /** 匿名会话 ACL：与 conversation.guestKey 匹配；登录用户忽略 */
  guestKey: z.string().min(16).max(80).optional(),
  context: z
    .object({
      route: z.string().max(300).optional(),
      articleSlug: z.string().max(120).optional(),
      sectionId: z.string().max(120).optional(),
    })
    .optional(),
  style: z.string().max(40).optional(),
  mode: z.enum(['fast', 'deep']).optional(),
  reasoningMode: z.enum(['deep_teach', 'react']).optional(),
  toolsEnabled: z.boolean().optional(),
});

export type ExplainBody = z.infer<typeof explainSchemaFixed>;
export type ChatBody = z.infer<typeof chatSchema>;
