import { describe, expect, it } from 'vitest';
import {
  buildFormIndex,
  countWords,
  findSurface,
  inflections,
  locateEvidence,
  normaliseWord,
  sentenceAround,
  tokenize,
} from '../src/lib/text';

describe('inflections / 词形匹配', () => {
  it('覆盖常见规则变形', () => {
    const forms = inflections('sustain');
    expect(forms).toContain('sustain');
    expect(forms).toContain('sustains');
    expect(forms).toContain('sustaining');
    expect(forms).toContain('sustained');
  });

  it('去掉不发音的 e 再加 ing', () => {
    expect(inflections('undermine')).toContain('undermining');
    expect(inflections('reclaim')).toContain('reclaiming');
  });

  it('y → ies / ied', () => {
    expect(inflections('carry')).toContain('carries');
    expect(inflections('carry')).toContain('carried');
  });

  it('不规则变形', () => {
    expect(inflections('seek')).toContain('sought');
    expect(inflections('child')).toContain('children');
  });

  it('形态索引能把文中形态映射回原形', () => {
    const index = buildFormIndex(['sustain', 'undermine']);
    expect(index.get('sustaining')).toBe('sustain');
    expect(index.get('undermines')).toBe('undermine');
  });

  it('findSurface 定位真实形态', () => {
    expect(findSurface('reclaim', ['Reclaiming attention is hard.'])).toBe('Reclaiming');
    expect(findSurface('absent', ['nothing here'])).toBeNull();
  });

  it('normaliseWord 去掉所有格与标点', () => {
    expect(normaliseWord('Reader’s')).toBe('reader');
    expect(normaliseWord('(attention),')).toBe('attention');
  });
});

describe('tokenize / 句子定位', () => {
  const paragraph =
    'The ritual feels harmless. Yet the cumulative effect is not harmless at all. What looks like small choices is a transfer of sovereignty.';

  it('拆出单词与标点，并保留空格', () => {
    const tokens = tokenize(paragraph);
    const words = tokens.filter((t) => t.type === 'word').map((t) => t.text);
    expect(words[0]).toBe('The');
    expect(words).toContain('cumulative');
    expect(tokens.some((t) => t.type === 'space')).toBe(true);
  });

  it('找得到 evidence 所在段落并给出近似位置', () => {
    const hit = locateEvidence([paragraph], 'the cumulative effect is not harmless at all.');
    expect(hit).not.toBeNull();
    expect(hit?.paragraphIndex).toBe(0);
    expect(hit?.start).toBeGreaterThan(20);
  });

  it('找不到时返回 null，交给 UI 降级显示', () => {
    expect(locateEvidence([paragraph], 'this sentence does not exist')).toBeNull();
  });

  it('sentenceAround 回溯到完整句子', () => {
    const idx = paragraph.indexOf('cumulative');
    expect(sentenceAround(paragraph, idx)).toContain('cumulative');
    expect(sentenceAround(paragraph, idx).startsWith('Yet')).toBe(true);
  });

  it('countWords 只统计单词', () => {
    expect(countWords(['one two three.', 'four!'])).toBe(4);
  });
});
