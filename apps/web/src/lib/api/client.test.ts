import { describe, expect, it } from 'vitest';
import { ApiError } from './client.js';

describe('ApiError', () => {
  it('保留 status 与 code', () => {
    const err = new ApiError(404, 'NOT_FOUND', '不存在');
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('不存在');
    expect(err.name).toBe('ApiError');
  });
});
