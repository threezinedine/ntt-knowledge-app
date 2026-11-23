import { describe, expect, it } from 'vitest';
import { classifyKey, classifyLayout, classifyText } from './keyboardInput';

describe('keyboard input language', () => {
  it('reads Latin letters off letter/digit keys', () => {
    expect(classifyKey({ key: 'j', code: 'KeyJ' })).toBe('latin');
    expect(classifyKey({ key: '5', code: 'Digit5' })).toBe('latin');
  });

  it('spots Vietnamese typing (Telex tools send the composed letter, often with no code)', () => {
    expect(classifyKey({ key: 'ư', code: '' })).toBe('vietnamese');
    expect(classifyKey({ key: 'Đ', code: 'KeyD' })).toBe('vietnamese');
    expect(classifyText('ố')).toBe('vietnamese');
  });

  it('spots an IME composing', () => {
    expect(classifyKey({ key: 'Process', code: 'KeyJ', keyCode: 229 })).toBe('ime');
    expect(classifyKey({ key: 'j', code: 'KeyJ', isComposing: true })).toBe('ime');
  });

  it('ignores shortcuts and named keys', () => {
    expect(classifyKey({ key: 'p', code: 'KeyP', ctrlKey: true })).toBeNull();
    expect(classifyKey({ key: 'Enter', code: 'Enter' })).toBeNull();
    expect(classifyKey({ key: 'Shift', code: 'ShiftLeft' })).toBeNull();
  });

  it('reads a layout map', () => {
    expect(
      classifyLayout(
        new Map([
          ['KeyQ', 'q'],
          ['Digit1', '1'],
        ]),
      ),
    ).toBe('latin');
    expect(
      classifyLayout(
        new Map([
          ['KeyQ', 'q'],
          ['Digit1', 'ă'],
        ]),
      ),
    ).toBe('vietnamese');
    expect(classifyLayout(new Map([['KeyQ', 'й']]))).toBe('other');
    expect(classifyLayout(new Map())).toBeNull();
  });
});
