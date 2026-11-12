import { describe, expect, it } from 'vitest';
import { costOf, extractJson, isPeakNow, MODELS } from '../src/api/deepseek';
import { previewFromPartial } from '../src/ai/pipeline';
import { DEMO_ARTICLE, DEMO_QUESTIONS } from '../src/ai/demo';

describe('费用核算', () => {
  it('按缓存命中 / 未命中 / 输出分别计价', () => {
    const usage = {
      prompt_tokens: 1_000_000,
      completion_tokens: 1_000_000,
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 1_000_000,
    };
    const offPeak = costOf('deepseek-flash', usage);
    // 1M 未命中输入 = 1 元；1M 输出 = 4 元；高峰时段乘 2
    expect([5, 10]).toContain(Number(offPeak.toFixed(2)));
    expect(costOf('deepseek-v4-pro', usage)).toBeGreaterThan(offPeak);
  });

  it('缓存命中的输入更便宜', () => {
    const miss = { prompt_tokens: 1000, completion_tokens: 0, prompt_cache_miss_tokens: 1000 };
    const hit = { prompt_tokens: 1000, completion_tokens: 0, prompt_cache_hit_tokens: 1000, prompt_cache_miss_tokens: 0 };
    expect(costOf('deepseek-v4-pro', hit)).toBeLessThan(costOf('deepseek-v4-pro', miss));
  });

  it('Search 调用按次计费', () => {
    const base = costOf('deepseek-flash', null, 0);
    expect(costOf('deepseek-flash', null, 1000)).toBeGreaterThan(base);
  });

  it('价格表里两个模型都在', () => {
    expect(MODELS.map((m) => m.id)).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
  });

  it('高峰时段判断：工作日 10 点算高峰，周六不算', () => {
    expect(isPeakNow(new Date('2026-10-28T10:00:00+08:00'))).toBe(true);
    expect(isPeakNow(new Date('2026-10-28T20:00:00+08:00'))).toBe(false);
    expect(isPeakNow(new Date('2026-10-31T10:00:00+08:00'))).toBe(false);
  });
});

describe('extractJson', () => {
  it('剥离 ```json 围栏', () => {
    const raw = '```json\n{"a":1}\n```';
    expect(extractJson<{ a: number }>(raw).a).toBe(1);
  });

  it('容忍前后多余文字', () => {
    const raw = '好的，结果如下：{"title":"x"} 希望有帮助';
    expect(extractJson<{ title: string }>(raw).title).toBe('x');
  });

  it('没有 JSON 时抛错', () => {
    expect(() => extractJson('这里没有 JSON')).toThrow();
  });
});

describe('流式预览', () => {
  it('从未完成的 JSON 里抽出已经写完的段落', () => {
    const partial = '{"title":"T","paragraphs":["This is a long enough paragraph to preview.","Another long paragraph that is also long enough."],"translation":["';
    const preview = previewFromPartial(partial);
    expect(preview).toContain('long enough paragraph');
    expect(preview.length).toBeGreaterThan(30);
  });

  it('早期内容较少时回退为尾部切片', () => {
    expect(previewFromPartial('{"title":').length).toBeGreaterThan(0);
  });
});

describe('演示素材一致性', () => {
  it('题目 evidence 都出现在正文中', () => {
    const body = DEMO_ARTICLE.paragraphs.join(' ');
    DEMO_QUESTIONS.forEach((q) => {
      expect(body).toContain(q.evidence.replace(/\s+/g, ' ').trim().replace(/^/, ''));
    });
  });

  it('每题四个选项且答案在范围内', () => {
    DEMO_QUESTIONS.forEach((q) => {
      expect(q.options).toHaveLength(4);
      expect(q.answerIndex).toBeGreaterThanOrEqual(0);
      expect(q.answerIndex).toBeLessThan(4);
    });
  });

  it('目标词确实出现在正文（含词形变化）', () => {
    const body = DEMO_ARTICLE.paragraphs.join(' ').toLowerCase();
    DEMO_ARTICLE.words.forEach((w) => {
      expect(body.includes(w.surface.toLowerCase())).toBe(true);
    });
  });
});
