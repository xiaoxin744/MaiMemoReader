/** 文本处理：分词、目标词形态匹配、句界定位、字数统计。 */

export interface Token {
  type: 'word' | 'space' | 'punct';
  text: string;
  /** 归一化后的拼写，用于查词 / 匹配目标词 */
  key?: string;
}

const WORD_RE = /[A-Za-z][A-Za-z'’-]*/g;

export function normaliseWord(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[’']s$/, '')
    .replace(/^[^a-z]+|[^a-z]+$/g, '');
}

/** 常见不规则变形，目标词以考试词汇为主，覆盖高频不规则即可 */
const IRREGULAR: Record<string, string[]> = {
  be: ['is', 'are', 'was', 'were', 'been', 'being', 'am'],
  have: ['has', 'had', 'having'],
  do: ['does', 'did', 'done', 'doing'],
  go: ['goes', 'went', 'gone', 'going'],
  make: ['makes', 'made', 'making'],
  take: ['takes', 'took', 'taken', 'taking'],
  give: ['gives', 'gave', 'given', 'giving'],
  see: ['sees', 'saw', 'seen', 'seeing'],
  come: ['comes', 'came', 'coming'],
  think: ['thinks', 'thought', 'thinking'],
  find: ['finds', 'found', 'finding'],
  hold: ['holds', 'held', 'holding'],
  keep: ['keeps', 'kept', 'keeping'],
  leave: ['leaves', 'left', 'leaving'],
  feel: ['feels', 'felt', 'feeling'],
  bring: ['brings', 'brought', 'bringing'],
  begin: ['begins', 'began', 'begun', 'beginning'],
  grow: ['grows', 'grew', 'grown', 'growing'],
  rise: ['rises', 'rose', 'risen', 'rising'],
  seek: ['seeks', 'sought', 'seeking'],
  lose: ['loses', 'lost', 'losing'],
  pay: ['pays', 'paid', 'paying'],
  mean: ['means', 'meant', 'meaning'],
  lead: ['leads', 'led', 'leading'],
  build: ['builds', 'built', 'building'],
  spend: ['spends', 'spent', 'spending'],
  stand: ['stands', 'stood', 'standing'],
  understand: ['understands', 'understood', 'understanding'],
  choose: ['chooses', 'chose', 'chosen', 'choosing'],
  speak: ['speaks', 'spoke', 'spoken', 'speaking'],
  break: ['breaks', 'broke', 'broken', 'breaking'],
  draw: ['draws', 'drew', 'drawn', 'drawing'],
  fall: ['falls', 'fell', 'fallen', 'falling'],
  forget: ['forgets', 'forgot', 'forgotten', 'forgetting'],
  hide: ['hides', 'hid', 'hidden', 'hiding'],
  meet: ['meets', 'met', 'meeting'],
  run: ['runs', 'ran', 'running'],
  sell: ['sells', 'sold', 'selling'],
  send: ['sends', 'sent', 'sending'],
  teach: ['teaches', 'taught', 'teaching'],
  write: ['writes', 'wrote', 'written', 'writing'],
  read: ['reads', 'reading'],
  child: ['children'],
  person: ['people'],
  man: ['men'],
  woman: ['women'],
  foot: ['feet'],
  tooth: ['teeth'],
  life: ['lives'],
  knife: ['knives'],
  analysis: ['analyses'],
  crisis: ['crises'],
  phenomenon: ['phenomena'],
  criterion: ['criteria'],
  datum: ['data'],
  medium: ['media'],
};

/** 生成一个词可能出现的形态（含规则变形），用于在文章里定位 */
export function inflections(word: string): string[] {
  const w = normaliseWord(word);
  if (!w) return [];
  const out = new Set<string>([w]);
  const irr = IRREGULAR[w];
  if (irr) irr.forEach((x) => out.add(x));

  // 复数 / 三单
  if (/(s|x|z|ch|sh)$/.test(w)) out.add(`${w}es`);
  else if (/[^aeiou]y$/.test(w)) out.add(`${w.slice(0, -1)}ies`);
  else out.add(`${w}s`);

  // 过去式 / 过去分词
  if (w.endsWith('e')) out.add(`${w}d`);
  else if (/[^aeiou]y$/.test(w)) out.add(`${w.slice(0, -1)}ied`);
  else {
    out.add(`${w}ed`);
    if (/[^aeiou][aeiou][bdgklmnprtvz]$/.test(w)) out.add(`${w}${w.slice(-1)}ed`);
  }

  // 现在分词
  if (w.endsWith('ie')) out.add(`${w.slice(0, -2)}ying`);
  else if (w.endsWith('e') && !w.endsWith('ee')) out.add(`${w.slice(0, -1)}ing`);
  else {
    out.add(`${w}ing`);
    if (/[^aeiou][aeiou][bdgklmnprtvz]$/.test(w)) out.add(`${w}${w.slice(-1)}ing`);
  }

  // 派生
  if (/[^aeiou]y$/.test(w)) out.add(`${w.slice(0, -1)}ily`);
  out.add(`${w}ly`);
  if (w.endsWith('e')) out.add(`${w.slice(0, -1)}er`);
  out.add(`${w}er`);
  out.add(`${w}est`);

  return [...out];
}

/** 目标词 -> 形态索引：命中小写 surface 即可回查目标词 */
export function buildFormIndex(targets: string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const t of targets) {
    for (const form of inflections(t)) {
      if (!index.has(form)) index.set(form, normaliseWord(t));
    }
  }
  return index;
}

export function tokenize(paragraph: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of paragraph.matchAll(WORD_RE)) {
    const start = m.index ?? 0;
    if (start > last) {
      const gap = paragraph.slice(last, start);
      tokens.push({ type: /\s/.test(gap) ? 'space' : 'punct', text: gap });
    }
    const text = m[0];
    tokens.push({ type: 'word', text, key: normaliseWord(text) });
    last = start + text.length;
  }
  if (last < paragraph.length) {
    const gap = paragraph.slice(last);
    tokens.push({ type: /\s/.test(gap) ? 'space' : 'punct', text: gap });
  }
  return tokens;
}

/** 目标词在文章中的真实出现形态 */
export function findSurface(word: string, paragraphs: string[]): string | null {
  const forms = inflections(word);
  for (const p of paragraphs) {
    for (const m of p.matchAll(WORD_RE)) {
      const key = normaliseWord(m[0]);
      if (forms.includes(key)) return m[0];
    }
  }
  return null;
}

export function countWords(paragraphs: string[]): number {
  return paragraphs.reduce((sum, p) => sum + (p.match(WORD_RE)?.length ?? 0), 0);
}

/** 从字符位置回溯到完整句子，用于「原文依据定位」 */
export function sentenceAround(paragraph: string, charIndex: number): string {
  const boundaries = /[.!?]["”’)]?\s/g;
  let start = 0;
  let end = paragraph.length;
  for (const m of paragraph.matchAll(boundaries)) {
    const at = m.index ?? 0;
    if (at < charIndex) start = at + m[0].length;
    else if (at >= charIndex) {
      end = at + m[0].length;
      break;
    }
  }
  return paragraph.slice(start, end).trim();
}

/** 找到 evidence 句子所在的段落序号，并给出词边界位置 */
export function locateEvidence(
  paragraphs: string[],
  evidence: string,
): { paragraphIndex: number; start: number; end: number } | null {
  const needle = evidence.trim().replace(/\s+/g, ' ');
  if (!needle) return null;
  for (let i = 0; i < paragraphs.length; i += 1) {
    const hay = paragraphs[i];
    const flat = hay.replace(/\s+/g, ' ');
    const at = flat.indexOf(needle);
    if (at >= 0) {
      const ratio = at / Math.max(flat.length, 1);
      const approxStart = Math.floor(ratio * hay.length);
      return { paragraphIndex: i, start: approxStart, end: approxStart + needle.length };
    }
    // 退化匹配：取前 40 个字符定位
    const head = needle.slice(0, 40);
    const headAt = flat.indexOf(head);
    if (head && headAt >= 0) {
      const ratio = headAt / Math.max(flat.length, 1);
      const approxStart = Math.floor(ratio * hay.length);
      return { paragraphIndex: i, start: approxStart, end: approxStart + needle.length };
    }
  }
  return null;
}

export function readingMinutes(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / 190));
}
