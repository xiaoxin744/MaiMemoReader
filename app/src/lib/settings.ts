/** 设置：默认值、读写、以及「密钥不进设置对象持久化」的处理。 */
import { kv } from './db';
import { secrets } from './vault';
import type { AppSettings } from '../types';

export const DEFAULT_SETTINGS: AppSettings = {
  accountId: 'local',
  apiProvider: 'deepseek',
  customApiBase: '',
  customApiModel: '',
  customApiKey: '',
  customApiKeyPersist: false,
  deepseekKey: '',
  deepseekKeyPersist: false,
  model: 'deepseek-flash',
  thinking: false,
  webSearch: false,
  exam: 'cet6',
  length: 'medium',
  difficulty: 3,
  questionCount: 4,
  articleMode: 'single',
  continueSession: false,
  theme: '',
  maimemoMode: 'none',
  maimemoToken: '',
  maimemoTokenPersist: true,
  oidcClientId: '',
  oidcScope: 'openid profile',
  relayUrl: '',
  costWarnCny: 0.5,
  themeMode: 'auto',
  reduceMotion: false,
  onboarded: false,
};

const SETTINGS_KEY = 'settings';

type PersistedSettings = Omit<AppSettings, 'deepseekKey' | 'customApiKey' | 'maimemoToken'>;

export async function loadSettings(): Promise<AppSettings> {
  const stored = (await kv.get<Partial<PersistedSettings>>(SETTINGS_KEY)) ?? {};
  const merged: AppSettings = { ...DEFAULT_SETTINGS, ...stored } as AppSettings;
  merged.deepseekKey = await secrets.get('deepseekKey');
  merged.customApiKey = await secrets.get('customApiKey');
  merged.maimemoToken = await secrets.get('maimemoToken');
  merged.deepseekKeyPersist = await secrets.isPersisted('deepseekKey');
  merged.customApiKeyPersist = await secrets.isPersisted('customApiKey');
  return merged;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const { deepseekKey, customApiKey, maimemoToken, ...rest } = settings;
  await kv.set(SETTINGS_KEY, rest satisfies PersistedSettings);
  await secrets.set('deepseekKey', deepseekKey.trim(), settings.deepseekKeyPersist);
  await secrets.set('customApiKey', customApiKey.trim(), settings.customApiKeyPersist);
  await secrets.set('maimemoToken', maimemoToken.trim(), settings.maimemoTokenPersist);
}

export async function resetSettings(): Promise<AppSettings> {
  await kv.del(SETTINGS_KEY);
  await secrets.clear('deepseekKey');
  await secrets.clear('customApiKey');
  await secrets.clear('maimemoToken');
  return { ...DEFAULT_SETTINGS };
}
