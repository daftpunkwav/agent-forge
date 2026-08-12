/**
 * 悬停 Agent 净化回归：历史 bug + 2026-08 截图泄漏样例
 */
import { describe, expect, it } from 'vitest';
import {
  extractHoverAnswer,
  isCompleteHoverAnswer,
  isLikelyHoverTeaching,
  looksLikeHoverPlanning,
} from './agentPrompt.js';

const cases: Array<{
  name: string;
  text: string;
  expectOk: boolean;
  forbid?: RegExp;
  include?: RegExp;
}> = [
  {
    name: 'bug1-self-revision',
    text: '首先第一句讲核心：LLM本质是概率驱动的文本续写器，能力上限取决于训练数据与算力。然后讲边界：它没有真实世界感知，不能保证事实正确。对，要短，不要长。那调整下：LLM是概率文本模型，边界是无感知、易幻觉。符合要求。有没有冗余？没有。哦调整下：LLM本质是概率驱动的文本续写器，能力上限',
    expectOk: true,
    forbid: /那调整|有没有冗余|首先第一句|哦调整/,
  },
  {
    name: 'bug2-self-talk-questions',
    text: '还要提一下本质？没有多余的，两句，讲清楚了核心、作用、定位。或者有没有要避免的？或者再顺一点？',
    expectOk: false,
  },
  {
    name: 'bug3-system-echo',
    text: '- 只输出最终讲解正文，禁止任何写作过程、自我检查、反复修改\n- 中文，精炼：。\n- 每句必须写完（以。\n- CoT 思维链：让模型把推理写出来\n- Chain-of-Thought 通过显式中间步骤提升复杂推理表现。\n- 是理解更高级模式 (ToT/GoT/ReAct) 的基础。\n- 作用：提升复杂推理表现（数学、逻辑等）。',
    expectOk: true,
    forbid: /只输出最终|禁止任何写作|自我检查|精炼[：:]/,
  },
  {
    name: 'bug4-task-echo',
    text: '用户现在需要讲解LangChain这个知识点，要2-3句，每句句号结尾，简洁。第二句：它的 LCEL 链式语法、Agent 智能体能力、LangGraph 图编排能力与可观测性组件，可共同拼接出适配生产。',
    expectOk: true,
    forbid: /用户现在需要|要\s*2\s*[-~]?\s*3\s*句|第二句[：:]/,
  },
  {
    name: 'shot-format-meta-prefix',
    text: '等下要准确，每句结尾句号，不要别的。Update是ReAct/Agent循环中负责整合新获取的观测信息、调整后续行动逻辑的核心环节。该阶段会基于上一轮行动得到的反馈结果更新内部状态记忆与任务推进策略，保障后续步骤更贴合任务目标。',
    expectOk: true,
    forbid: /等下要准确|每句结尾句号|不要别的/,
    include: /Update|观测|状态/,
  },
  {
    name: 'shot-format-meta-only',
    text: '等下要准确，每句结尾句号，不要别的。',
    expectOk: false,
  },
  {
    name: 'shot-example-opener',
    text: '比如“这些技术可针对性优化大模型与Agent的交互效果，提升任务执行的准确性与稳定性。',
    expectOk: false,
  },
  {
    name: 'shot-truncated-tail',
    text: '每个step都明确了对应阶段的动作要求、输入输出规则，相当于流程画好了固定的格子。拆得越清晰的step，越。',
    expectOk: true,
    forbid: /，越。|越。$/,
    include: /格子|step/,
  },
  {
    name: 'good-llm',
    text: 'LLM 本质是概率驱动的文本续写器，能力取决于训练数据与算力。它没有真实世界感知，也不能保证事实正确。把它当接口用时，要明确输入输出与失败兜底。',
    expectOk: true,
  },
  {
    name: 'good-cot',
    text: 'CoT 通过显式中间步骤提升复杂推理表现。它是理解 ToT、GoT、ReAct 等更高阶模式的基础。',
    expectOk: true,
  },
  {
    name: 'mixed-revision-then-clean',
    text: '首先第一句讲核心。那调整下：LLM 本质是概率驱动的文本续写器，能力取决于训练数据与算力。它没有真实世界感知，也不能保证事实正确。',
    expectOk: true,
    forbid: /那调整|首先第一句/,
  },
];

describe('hover extract / sanitize', () => {
  for (const c of cases) {
    it(c.name, () => {
      const extracted = extractHoverAnswer(c.text, '') || extractHoverAnswer('', c.text);
      const ok = Boolean(extracted);
      const leak = c.forbid && extracted ? c.forbid.test(extracted) : false;
      const missing = c.include && extracted ? !c.include.test(extracted) : false;
      const dirtyPass =
        !c.expectOk &&
        (isCompleteHoverAnswer(c.text) ||
          (isLikelyHoverTeaching(c.text) &&
            !looksLikeHoverPlanning(c.text) &&
            isCompleteHoverAnswer(c.text)));
      const pass = c.expectOk ? ok && !leak && !missing : !ok && !isCompleteHoverAnswer(c.text);

      expect({ pass, dirtyPass, extracted, leak, missing }).toEqual({
        pass: true,
        dirtyPass: false,
        extracted,
        leak: false,
        missing: false,
      });
    });
  }
});
