import type { Prompt } from "./types";

export type FeishuConfig = {
  appToken: string;
  tableId: string;
  personalToken: string;
  sourceUrl: string;
};

const configKey = "prompt-helper-feishu-config";
const recordMapKey = "prompt-helper-feishu-record-map";

export function parseBaseUrl(input: string): { appToken: string; tableId: string } | null {
  const appToken = input.trim().match(/\/base\/([A-Za-z0-9]+)/);
  const tableId = input.trim().match(/table=([A-Za-z0-9]+)/);
  if (!appToken || !tableId) return null;
  return { appToken: appToken[1], tableId: tableId[1] };
}

export async function loadFeishuConfig(): Promise<FeishuConfig | null> {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    const result = await chrome.storage.local.get([configKey]);
    return (result[configKey] as FeishuConfig | undefined) ?? null;
  }
  const raw = window.localStorage.getItem(configKey);
  return raw ? (JSON.parse(raw) as FeishuConfig) : null;
}

export async function saveFeishuConfig(config: FeishuConfig | null) {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    if (config) {
      await chrome.storage.local.set({ [configKey]: config });
    } else {
      await chrome.storage.local.remove([configKey]);
    }
    return;
  }
  if (config) {
    window.localStorage.setItem(configKey, JSON.stringify(config));
  } else {
    window.localStorage.removeItem(configKey);
  }
}

function readRecordMap(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(recordMapKey) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeRecordMap(map: Record<string, string>) {
  window.localStorage.setItem(recordMapKey, JSON.stringify(map));
}

function apiBase(config: FeishuConfig) {
  return `https://base-api.feishu.cn/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}`;
}

type FeishuResponse<T> = { code: number; msg: string; data: T };

async function request<T>(config: FeishuConfig, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase(config)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.personalToken}`,
      "Content-Type": "application/json; charset=utf-8",
      ...init?.headers
    }
  });
  const body = (await response.json()) as FeishuResponse<T>;
  if (body.code !== 0) {
    throw new Error(`飞书接口返回错误（${body.code}）：${body.msg}`);
  }
  return body.data;
}

function promptToFields(prompt: Prompt) {
  return {
    标题: prompt.title,
    正文: prompt.content,
    分类: prompt.categories?.name ?? "",
    标签: prompt.prompt_tags
      .map((row) => row.tags?.name)
      .filter(Boolean)
      .join(", "),
    图片数量: prompt.prompt_images?.length ?? 0,
    创建时间: Date.parse(prompt.created_at),
    更新时间: Date.parse(prompt.updated_at),
    提示词ID: prompt.id
  };
}

async function findRecordId(config: FeishuConfig, promptId: string): Promise<string | null> {
  const data = await request<{ items?: Array<{ record_id: string }> }>(config, "/records/search?page_size=1", {
    method: "POST",
    body: JSON.stringify({
      filter: {
        conjunction: "and",
        conditions: [{ field_name: "提示词ID", operator: "is", value: [promptId] }]
      }
    })
  });
  return data.items?.[0]?.record_id ?? null;
}

async function createRecord(config: FeishuConfig, prompt: Prompt): Promise<string> {
  const data = await request<{ record: { record_id: string } }>(config, "/records", {
    method: "POST",
    body: JSON.stringify({ fields: promptToFields(prompt) })
  });
  return data.record.record_id;
}

export async function upsertPromptRecord(config: FeishuConfig, prompt: Prompt) {
  const map = readRecordMap();
  const cached = map[prompt.id];

  if (cached) {
    try {
      await request(config, `/records/${cached}`, {
        method: "PUT",
        body: JSON.stringify({ fields: promptToFields(prompt) })
      });
      return;
    } catch {
      delete map[prompt.id];
      writeRecordMap(map);
    }
  }

  const existing = await findRecordId(config, prompt.id);
  if (existing) {
    await request(config, `/records/${existing}`, {
      method: "PUT",
      body: JSON.stringify({ fields: promptToFields(prompt) })
    });
    map[prompt.id] = existing;
  } else {
    map[prompt.id] = await createRecord(config, prompt);
  }
  writeRecordMap(map);
}

export async function deletePromptRecord(config: FeishuConfig, promptId: string) {
  const map = readRecordMap();
  const recordId = map[promptId] ?? (await findRecordId(config, promptId));
  if (!recordId) return;

  try {
    await request(config, `/records/${recordId}`, { method: "DELETE" });
  } catch (caught) {
    // 记录已不存在时视为删除成功
    if (!(caught instanceof Error) || !caught.message.includes("Record")) {
      throw caught;
    }
  }
  delete map[promptId];
  writeRecordMap(map);
}

export async function syncPromptsToFeishu(config: FeishuConfig, prompts: Prompt[]) {
  for (const prompt of prompts) {
    await upsertPromptRecord(config, prompt);
  }
}
