/** 全局类型定义：学习快照、AI 选词方案、文章、题目、任务、设置。 */

export type ExamMode = 'cet4' | 'cet6' | 'kaoyan1' | 'kaoyan2';

/** AI 接口来源：官方 DeepSeek，或用户自填的 OpenAI 兼容服务 */
export type ApiProvider = 'deepseek' | 'custom';

/** 墨墨反馈状态（对应 StudyResponse 枚举，仅取学习侧可取到的四种） */
export type StudyResponse = 'FAMILIAR' | 'VAGUE' | 'FORGET' | 'WELL_FAMILIAR';

/** 单日学习单词（来自 /memo/study/get_today_items） */
export interface StudyWord {
  vocId?: string;
  spelling: string;
  order: number;
  response?: StudyResponse;
  isNew: boolean;
  isFinished: boolean;
}

export interface StudyProgress {
  finished: number;
  total: number;
  studyTimeMs: number;
}

/** 一次「当日学习数据」快照，按账号 + 本地日期隔离 */
export interface StudySnapshot {
  id: string;
  accountId: string;
  date: string;
  fetchedAt: number;
  source: 'maimemo' | 'demo';
  progress: StudyProgress | null;
  words: StudyWord[];
  /** 计划外的补充信息，例如未初始化、接口公测提示 */
  note?: string;
}

export type WordRole = 'core' | 'support';

export interface WordPick {
  word: string;
  role: WordRole;
  reason: string;
}

export interface PlannedArticle {
  title: string;
  angle: string;
  targetWords: string[];
}

/** AI 智能选词与组篇规划（第一阶段产物） */
export interface SelectionPlan {
  summary: string;
  picks: WordPick[];
  dropped: { word: string; reason: string }[];
  articles: PlannedArticle[];
  /** AI 判断是否需要多篇；1~3 */
  articleCount: number;
}

export interface ArticleWord {
  word: string;
  /** 文中实际出现的形态，例如 sustained */
  surface: string;
  meaning: string;
  inContext: string;
  note?: string;
}

export interface Article {
  id: string;
  taskId: string;
  accountId: string;
  sessionId: string;
  date: string;
  exam: ExamMode;
  title: string;
  subtitle?: string;
  paragraphs: string[];
  translation: string[];
  words: ArticleWord[];
  wordCount: number;
  readMinutes: number;
  createdAt: number;
  favorite: boolean;
  themeHint?: string;
}

export type QuestionType = 'detail' | 'main' | 'inference' | 'vocab' | 'attitude' | 'structure';

export interface Question {
  id: string;
  articleId: string;
  index: number;
  type: QuestionType;
  stem: string;
  options: string[];
  answerIndex: number;
  evidence: string;
  explanation: string;
}

export interface QuizAttempt {
  id: string;
  articleId: string;
  answers: (number | null)[];
  score: number;
  total: number;
  createdAt: number;
}

export type TaskStage = 'snapshot' | 'selection' | 'article' | 'questions' | 'qa' | 'save' | 'done';
export type TaskStatus = 'running' | 'interrupted' | 'complete' | 'failed';

/** 一次生成任务：分阶段存档，支持中断恢复 */
export interface GenerationTask {
  id: string;
  accountId: string;
  date: string;
  exam: ExamMode;
  createdAt: number;
  updatedAt: number;
  status: TaskStatus;
  stage: TaskStage;
  progress: number;
  articleIndex: number;
  totalArticles: number;
  sessionId: string;
  options: GenerateOptions;
  snapshotId?: string;
  plan?: SelectionPlan;
  articles: Article[];
  questions: Record<string, Question[]>;
  /** 流式正文缓存（可能不完整） */
  partialTitle?: string;
  partialText?: string;
  error?: string;
  /** 质量检查给出的提醒 */
  qaNotes?: string[];
  usage?: UsageTotal;
  /** 演示任务标记 */
  demo?: boolean;
}

export interface GenerateOptions {
  exam: ExamMode;
  theme: string;
  length: 'short' | 'medium' | 'long';
  difficulty: 1 | 2 | 3 | 4 | 5;
  questionCount: number;
  articleMode: 'single' | 'auto';
  continueSession: boolean;
  webSearch: boolean;
  model: string;
  thinking: boolean;
  /** 任务创建时使用的接口；旧任务缺省视为官方 DeepSeek，用于恢复时避免把模型名发错服务 */
  apiProvider?: ApiProvider;
}

export interface UsageTotal {
  promptTokens: number;
  completionTokens: number;
  costCny: number;
  calls: number;
  searchCalls: number;
  /** false 表示费用由自定义服务商结算，本应用无法估算；旧任务缺省视为 true */
  costKnown?: boolean;
}

/** DeepSeek 账单口径的价格（元 / 百万 token），来源：官方定价页 2026-10 */
export interface ModelPrice {
  id: string;
  label: string;
  inputCachedCny: number;
  inputMissCny: number;
  outputCny: number;
  note: string;
}

export interface MaimemoAuthState {
  mode: 'none' | 'token' | 'oidc';
  /** 展示用标识，token / access_token 本身不落在这里 */
  accountId?: string;
  displayName?: string;
  expiresAt?: number;
  scope?: string;
}

export interface AppSettings {
  accountId: string;
  apiProvider: ApiProvider;
  /** 自定义 OpenAI 兼容服务的版本根地址，例如 https://api.openai.com/v1 */
  customApiBase: string;
  customApiModel: string;
  customApiKey: string;
  customApiKeyPersist: boolean;
  deepseekKey: string;
  deepseekKeyPersist: boolean;
  model: string;
  thinking: boolean;
  webSearch: boolean;
  exam: ExamMode;
  length: 'short' | 'medium' | 'long';
  difficulty: 1 | 2 | 3 | 4 | 5;
  questionCount: number;
  articleMode: 'single' | 'auto';
  continueSession: boolean;
  theme: string;
  maimemoMode: 'none' | 'token' | 'oidc';
  maimemoToken: string;
  maimemoTokenPersist: boolean;
  oidcClientId: string;
  oidcScope: string;
  relayUrl: string;
  costWarnCny: number;
  themeMode: 'light' | 'dark' | 'auto';
  reduceMotion: boolean;
  onboarded: boolean;
}

export interface WordGloss {
  key: string;
  word: string;
  meaning: string;
  context: string;
  collocation?: string;
  createdAt: number;
}

export interface ExportBundle {
  app: 'memo-reader';
  version: 1;
  exportedAt: number;
  settings: Omit<AppSettings, 'deepseekKey' | 'maimemoToken' | 'customApiKey'>;
  snapshots: StudySnapshot[];
  articles: Article[];
  questions: Question[];
  attempts: QuizAttempt[];
  tasks: GenerationTask[];
}
