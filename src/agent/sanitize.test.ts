import { describe, expect, it } from 'vitest';
import { stripThinkingTags } from './sanitize.js';

describe('stripThinkingTags', () => {
  it('removes complete think blocks', () => {
    expect(stripThinkingTags('<think>reasoning</think>\nAnswer')).toBe('Answer');
  });

  it('removes dangling closing think tags from local model output', () => {
    expect(stripThinkingTags('</think>\nAnswer')).toBe('Answer');
  });

  it('removes unterminated think blocks', () => {
    expect(stripThinkingTags('<think>reasoning that never closed')).toBe('');
  });
});
