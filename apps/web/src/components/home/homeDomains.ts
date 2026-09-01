/** 首页营销领域卡片数据 */
export const HOME_DOMAINS = [
  {
    title: '推理模式',
    en: 'Reasoning Patterns',
    desc: 'ReAct · CoT · GoT · ToT — 理解 Agent 如何思考与行动',
    to: '/knowledge',
    tags: ['ReAct', 'CoT', 'GoT', 'ToT'],
    color: 'var(--chart-1)',
  },
  {
    title: '框架',
    en: 'Frameworks',
    desc: 'LangChain · AutoGen · CrewAI 架构与适用场景',
    to: '/knowledge',
    tags: ['LangChain', 'AutoGen', 'CrewAI'],
    color: 'var(--chart-2)',
  },
  {
    title: '协议与工程',
    en: 'Protocol & Engineering',
    desc: 'MCP、Context、Loop、Harness、Memory、评估与工具调用',
    to: '/knowledge',
    tags: ['MCP', 'Loop', 'Harness'],
    color: 'var(--chart-3)',
  },
  {
    title: 'LLM 基础',
    en: 'Foundations',
    desc: 'Transformer、分词、微调与 Prompting',
    to: '/llm',
    tags: ['Transformer', 'Token'],
    color: 'var(--chart-5)',
  },
  {
    title: '评测与安全',
    en: 'Eval & Safety',
    desc: '基准评测、红队测试与输出护栏',
    to: '/knowledge',
    tags: ['Eval', 'Guard'],
    color: 'var(--chart-4)',
  },
  {
    title: '记忆系统',
    en: 'Memory',
    desc: '短期上下文、长期记忆与检索增强',
    to: '/knowledge',
    tags: ['RAG', 'Memory'],
    color: 'var(--chart-2)',
  },
] as const;

export const HOME_DOMAIN_VISIBLE = 4;
export const HOME_DOMAIN_ROTATE_MS = 5200;
export const HOME_FEED_LIMIT = 10;
