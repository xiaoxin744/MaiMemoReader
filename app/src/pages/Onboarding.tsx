import { useState } from 'react';
import { navigate } from '../lib/router';
import { useApp } from '../state/store';
import { DEMO_SNAPSHOT } from '../ai/demo';
import { todayKey } from '../api/maimemo';

const STEPS = [
  {
    eyebrow: '01 · 它读什么',
    title: '先看今天背了哪些词',
    body:
      '连接墨墨账号后，网站只读取当日的学习进度、新学与复习状态，以及每个词当天的第一次反馈（认识 / 模糊 / 忘记 / 熟知）。不读词库，不写回数据。',
  },
  {
    eyebrow: '02 · 它怎么写',
    title: '让 AI 决定词的去留',
    body:
      'AI 会按记忆状态、语义关联和你选的考试模式挑词：该用的用，不该用的写清理由放弃。不会为了覆盖 200 个词而拼出一段谁也读不下去的话。',
  },
  {
    eyebrow: '03 · 你怎么用',
    title: '读、点词、做题、看依据',
    body:
      '文章按四六级 / 考研的句法与命题习惯生成，点任意单词可看语境释义；交卷后每道题都给出原文依据。所有内容存在本机，可导出。',
  },
];

export default function Onboarding() {
  const { setSettings, persistNow, saveSnapshot, accountId, notify, settings } = useApp();
  const [step, setStep] = useState(0);

  const finish = async (mode: 'demo' | 'settings' | 'later') => {
    const next = { ...settings, onboarded: true };
    setSettings({ onboarded: true });
    await persistNow(next);
    if (mode === 'demo') {
      await saveSnapshot({ ...DEMO_SNAPSHOT, accountId, id: todayKey(accountId), fetchedAt: Date.now() });
      notify('演示数据已就绪', 'ok');
      navigate('');
      return;
    }
    if (mode === 'settings') {
      navigate('settings');
      return;
    }
    navigate('');
  };

  const current = STEPS[step];

  return (
    <div className="onboarding">
      <div className="onboarding__brand">
        <span className="brand__mark">M</span>
        <div>
          <div className="brand__name">MaiMemo Reader</div>
          <div className="brand__sub">墨墨学习数据 · AI 英语精读</div>
        </div>
      </div>

      <div className="onboarding__card">
        <p className="eyebrow">{current.eyebrow}</p>
        <h1 className="display display--sm">{current.title}</h1>
        <p className="lede">{current.body}</p>

        <div className="onboarding__dots">
          {STEPS.map((s, i) => (
            <button
              key={s.title}
              type="button"
              className={`dot-btn ${i === step ? 'is-active' : ''}`}
              onClick={() => setStep(i)}
              aria-label={s.title}
            />
          ))}
        </div>

        <div className="onboarding__actions">
          {step > 0 ? (
            <button type="button" className="btn btn--quiet" onClick={() => setStep(step - 1)}>
              上一步
            </button>
          ) : (
            <button type="button" className="btn btn--quiet" onClick={() => finish('later')}>
              先随便看看
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn--primary" onClick={() => setStep(step + 1)}>
              继续
            </button>
          ) : (
            <>
              <button type="button" className="btn btn--ghost" onClick={() => finish('settings')}>
                去配置账号
              </button>
              <button type="button" className="btn btn--primary" onClick={() => finish('demo')}>
                用演示数据开始
              </button>
            </>
          )}
        </div>
      </div>

      <p className="onboarding__foot meta">
        密钥只留在本机 · 无账号体系 · 无追踪 · 可随时导出或清除
      </p>
    </div>
  );
}
