/** 统一错误解释：把两套 API 的状态码 / 异常翻译成中文 + 可执行建议。 */
import type { ApiProvider } from '../types';

export type ErrorSource = 'deepseek' | 'maimemo' | 'oidc' | 'local' | 'parse';

export interface ExplainedError {
  title: string;
  detail: string;
  action: string;
  /** safe=可安全重试（不会重复计费）；billed=重试可能重复计费；no=不要重试 */
  retry: 'safe' | 'billed' | 'no';
  source: ErrorSource;
  status?: number;
}

export class AppError extends Error {
  source: ErrorSource;
  status?: number;
  code?: string;
  raw?: string;
  /** 仅 source='deepseek' 时有意义：区分官方接口与自定义 OpenAI 兼容接口 */
  provider?: ApiProvider;

  constructor(
    source: ErrorSource,
    message: string,
    opts: { status?: number; code?: string; raw?: string; provider?: ApiProvider } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.source = source;
    this.status = opts.status;
    this.code = opts.code;
    this.raw = opts.raw;
    this.provider = opts.provider;
  }
}

interface DeepSeekBody {
  error?: { message?: string; type?: string; code?: string };
}

export function explainDeepSeek(
  status: number,
  body: unknown,
  provider: ApiProvider = 'deepseek',
): ExplainedError {
  const message = (body as DeepSeekBody | null)?.error?.message ?? '';
  const tail = message ? `\n服务端原文：${message}` : '';
  const custom = provider === 'custom';
  const label = custom ? '自定义接口' : 'DeepSeek';
  switch (status) {
    case 400:
      return {
        title: '请求参数不被接受',
        detail: `请求格式或字段不合法${tail}`,
        action: custom
          ? '检查 Base URL 与模型名；若服务不支持 JSON 模式（response_format），换一个支持的模型再试。'
          : '检查模型名、JSON 模式与 max_tokens 设置后重试。',
        retry: 'no',
        source: 'deepseek',
        status,
      };
    case 401:
      return {
        title: custom ? '自定义接口拒绝了这次请求' : 'DeepSeek API Key 无效',
        detail: custom
          ? `服务端未接受当前凭证。有些服务要求额外的鉴权头，本应用只发送标准的 Authorization: Bearer。${tail}`
          : `密钥校验失败，请确认 Key 复制完整且未过期。${tail}`,
        action: custom
          ? '到「设置 → AI 接口」检查 API Key；本地服务若无需鉴权可留空。'
          : '到「设置 → AI 接口」重新填写并点击验证。',
        retry: 'no',
        source: 'deepseek',
        status,
      };
    case 402:
      return {
        title: custom ? '服务商余额不足或额度用尽' : 'DeepSeek 账户余额不足',
        detail: `请求已被拒绝，未产生生成内容。${tail}`,
        action: custom
          ? '前往你的服务商控制台充值后重试；本篇不会自动重发。'
          : '前往 platform.deepseek.com 充值后重试；本篇不会自动重发。',
        retry: 'no',
        source: 'deepseek',
        status,
      };
    case 422:
      return {
        title: custom ? '自定义接口参数错误' : 'DeepSeek 参数错误',
        detail: `某个字段取值不是合法范围${tail}`,
        action: custom
          ? '确认模型名存在，并检查该服务是否支持 stream / max_tokens 等参数。'
          : '把模型切回 deepseek-flash 再试，或关闭「深度思考」后重试。',
        retry: 'no',
        source: 'deepseek',
        status,
      };
    case 429:
      return {
        title: `触发 ${label} 限流`,
        detail: '短时间内请求过多，或并发达到账号上限。',
        action: '等 30 秒后继续；已完成阶段的结果已保存，不会重做。',
        retry: 'safe',
        source: 'deepseek',
        status,
      };
    case 500:
    case 502:
    case 503:
    case 504:
      return {
        title: `${label} 服务临时不可用`,
        detail: `服务端返回 ${status}，通常与网络或服务负载有关。`,
        action: '稍后重试；若正文阶段中断，只需重新生成该阶段。',
        retry: 'safe',
        source: 'deepseek',
        status,
      };
    default:
      return {
        title: `${label} 请求失败（${status}）`,
        detail: `未预期的状态码。${tail}`,
        action: '保留当前任务，稍后在「历史任务」里继续。',
        retry: 'no',
        source: 'deepseek',
        status,
      };
  }
}

export function explainMaimemo(status: number, payload: unknown): ExplainedError {
  const errs = (payload as { errors?: { code?: string; msg?: string; info?: string }[] } | null)?.errors ?? [];
  const first = errs[0];
  const code = first?.code ?? '';
  const msg = first?.msg ?? '';
  const tail = msg ? `\n服务端原文：${msg}` : '';
  if (status === 401 || code.includes('unauthorized') || code.includes('token')) {
    return {
      title: '墨墨凭证无效或已过期',
      detail: `开放 API 拒绝了这次请求。${tail}`,
      action: '到「设置 → 墨墨背单词」替换 Token，或重新授权登录。',
      retry: 'no',
      source: 'maimemo',
      status,
    };
  }
  if (status === 403 || code.includes('permission') || code.includes('scope')) {
    return {
      title: '缺少该接口的权限',
      detail: `当前应用或 Token 未被授予读取学习数据的权限。${tail}`,
      action: '在开放平台核对授权范围（只读学习数据），或改用个人 Token 模式。',
      retry: 'no',
      source: 'maimemo',
      status,
    };
  }
  if (status === 404) {
    return {
      title: '接口不存在或应用未通过审核',
      detail: '学习数据接口仍处于公测，路径或权限可能随版本调整。',
      action: '先使用个人 Token 模式读取；如仍失败，请在设置中改用中继并查看返回内容。',
      retry: 'no',
      source: 'maimemo',
      status,
    };
  }
  if (status === 429) {
    return {
      title: '触发墨墨接口频控',
      detail: '限流为 10 秒 20 次 / 60 秒 40 次 / 5 小时 2000 次。',
      action: '等十几秒后重新拉取；已取到的快照会保留。',
      retry: 'safe',
      source: 'maimemo',
      status,
    };
  }
  return {
    title: `墨墨接口返回 ${status}`,
    detail: `请求未被正常处理。${tail}`,
    action: '稍后重试；若持续失败可在设置页开启中继查看原始响应。',
    retry: 'safe',
    source: 'maimemo',
    status,
  };
}

/** 浏览器里最常见的两类「看起来是网络错误」的情况 */
export function explainNetwork(
  source: 'deepseek' | 'maimemo' | 'oidc',
  detail?: string,
  provider: ApiProvider = 'deepseek',
): ExplainedError {
  if (source === 'maimemo') {
    return {
      title: '请求没有到达墨墨，或被跨域策略拦下',
      detail:
        '墨墨开放 API 的错误响应不返回跨域头，浏览器会把「Token 错误」也报成网络失败，两者在前端无法区分。' +
        (detail ? `\n捕获信息：${detail}` : ''),
      action: '先在设置里点「连接测试」；若怀疑是跨域限制，可填写自建中继地址后再测。',
      retry: 'safe',
      source,
    };
  }
  if (source === 'oidc') {
    return {
      title: '授权服务器不可达',
      detail: '可能是网络中断，或当前网络拦截了 accounts.maimemo.com。',
      action: '切换网络后重新点击「墨墨授权登录」。',
      retry: 'safe',
      source,
    };
  }
  if (provider === 'custom') {
    return {
      title: '与自定义接口的连接中断',
      detail:
        detail ||
        '浏览器未能完成请求。常见原因：Base URL 写错、服务未启动，或该服务没有允许当前页面跨域（CORS）。',
      action: '确认 Base URL 能在浏览器直接访问，并在服务端允许跨域；本地 Ollama / LM Studio 需要显式开启 CORS。',
      retry: 'safe',
      source,
    };
  }
  return {
    title: '与 DeepSeek 的连接中断',
    detail: detail || '浏览器未能完成请求，常见于网络切换、代理或服务端长连接被切断。',
    action: '检查网络后重试；已生成的阶段结果会保留。',
    retry: 'safe',
    source,
  };
}

export function explainAny(error: unknown): ExplainedError {
  if (error instanceof AppError) {
    switch (error.source) {
      case 'deepseek':
        if (error.status) return explainDeepSeek(error.status, { error: { message: error.raw } }, error.provider);
        return explainNetwork('deepseek', error.message, error.provider);
      case 'maimemo':
        if (error.status) return explainMaimemo(error.status, { errors: [{ code: error.code, msg: error.raw }] });
        return explainNetwork('maimemo', error.message);
      case 'oidc':
        return {
          title: '墨墨授权流程未完成',
          detail: error.message,
          action: '重新点击授权登录；回调地址必须与开放平台登记的一致。',
          retry: 'safe',
          source: 'oidc',
        };
      case 'parse':
        return {
          title: 'AI 返回的结构不符合约定',
          detail: error.message,
          action: '已保留原始返回，点「重试本阶段」通常可以解决；必要时换一个更擅长 JSON 输出的模型。',
          retry: 'billed',
          source: 'parse',
        };
      default:
        return {
          title: '本地处理失败',
          detail: error.message,
          action: '刷新页面后重试；数据已保存在本机。',
          retry: 'safe',
          source: 'local',
        };
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    title: '出现未预期的错误',
    detail: message,
    action: '可以重试；如果反复出现，请在设置页导出数据后反馈。',
    retry: 'safe',
    source: 'local',
  };
}
