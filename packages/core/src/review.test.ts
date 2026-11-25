import { describe, expect, it } from 'vitest';
import {
  digStats,
  isWellDug,
  nextReview,
  REVIEW_STEPS_DAYS,
  reviewAnswerInputSchema,
} from './review.js';

describe('nextReview', () => {
  it('Done climbs the ladder one step at a time and stays on the last', () => {
    expect(nextReview(0, 'done')).toEqual({ step: 1, days: 1 });
    expect(nextReview(1, 'done')).toEqual({ step: 2, days: 3 });
    const last = REVIEW_STEPS_DAYS.length - 1;
    expect(nextReview(last, 'done')).toEqual({ step: last, days: 120 });
    expect(nextReview(99, 'done')).toEqual({ step: last, days: 120 }); // out of range
    expect(nextReview(-3, 'done')).toEqual({ step: 1, days: 1 });
  });

  it('Again starts over, wherever the card was', () => {
    expect(nextReview(5, 'again')).toEqual({ step: 0, days: 1 });
  });
});

describe('isWellDug', () => {
  it('needs both 3 answered whys and one 3 levels deep', () => {
    expect(isWellDug(digStats([1, 2, 3]))).toBe(true);
    expect(isWellDug(digStats([1, 2, 2]))).toBe(false); // 3 whys, 2 deep
    expect(isWellDug(digStats([2, 3]))).toBe(false); // 3 deep, 2 whys
    expect(isWellDug(digStats([]))).toBe(false);
    expect(digStats([1, 4, 2])).toEqual({ answeredWhys: 3, maxDepth: 4 });
  });
});

describe('reviewAnswerInputSchema', () => {
  const id = '0190a6c4-0000-7000-8000-000000000001';
  const other = '0190a6c4-0000-7000-8000-000000000002';
  it('takes one node for dig, two different ones for link', () => {
    expect(
      reviewAnswerInputSchema.safeParse({ kind: 'dig', nodeId: id, result: 'done' }).success,
    ).toBe(true);
    expect(
      reviewAnswerInputSchema.safeParse({
        kind: 'link',
        nodeId: id,
        otherNodeId: other,
        result: 'again',
      }).success,
    ).toBe(true);
    expect(
      reviewAnswerInputSchema.safeParse({ kind: 'link', nodeId: id, result: 'done' }).success,
    ).toBe(false);
    expect(
      reviewAnswerInputSchema.safeParse({
        kind: 'link',
        nodeId: id,
        otherNodeId: id,
        result: 'done',
      }).success,
    ).toBe(false);
  });
});
