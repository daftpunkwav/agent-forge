import { describe, expect, it } from 'vitest';
import { can } from './permissions.js';
import { isSafeHoverPublicAnswer, looksLikeHoverPlanning } from './hoverSanitize.js';

describe('permissions.can', () => {
  it('游客仅可读内容与话题', () => {
    expect(can(null, 'content.read')).toBe(true);
    expect(can(null, 'annotation.read')).toBe(true);
    expect(can(null, 'author.workspace')).toBe(false);
    expect(can(null, 'domain.manage')).toBe(false);
  });
  it('adminLevel≥50 可管理领域', () => {
    expect(
      can({ role: 'admin', authorTier: 'none', adminLevel: 50 }, 'domain.manage'),
    ).toBe(true);
    expect(
      can({ role: 'admin', authorTier: 'none', adminLevel: 10 }, 'domain.manage'),
    ).toBe(false);
  });
});

describe('hoverSanitize 冒烟', () => {
  it('正常讲解通过', () => {
    expect(
      isSafeHoverPublicAnswer('ReAct 把推理与行动交替进行。模型先想再调用工具，再根据观察继续。'),
    ).toBe(true);
  });
  it('策划口吻被拒', () => {
    expect(looksLikeHoverPlanning('我需要：先写大纲，再写正文。')).toBe(true);
  });
});
