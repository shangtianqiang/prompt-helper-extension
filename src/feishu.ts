import type { Prompt, PromptImage } from "./types";

export type FeishuConfig = {
  appToken: string;
  tableId: string;
  personalToken: string;
  sourceUrl: string;
};

const configKey = "prompt-helper-feishu-config";
const recordMapKey = "prompt-helper-feishu-record-map";
const fileMapKey = "prompt-helper-feishu-file-map";

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

function readJsonMap(key: string): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeJsonMap(key: string, map: Record<string, string>) {
  window.localStorage.setItem(key, JSON.stringify(map));
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

async function uploadImage(config: FeishuConfig, image: PromptImage): Promise<string> {
  const fileMap = readJsonMap(fileMapKey);
  if (fileMap[image.id]) return fileMap[image.id];

  const blob = await (await fetch(image.data_url)).blob();
  const fileName = image.name || "image.png";
  const form = new FormData();
  form.append("file_name", fileName);
  form.append("parent_type", "bitable_image");
  form.append("parent_node", config.appToken);
  form.append("size", String(blob.size));
  form.append("file", blob, fileName);

  const response = await fetch("https://base-api.feishu.cn/open-apis/drive/v1/medias/upload_all", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.personalToken}` },
    body: form
  });
  const body = (await response.json()) as FeishuResponse<{ file_token: string }>;
  if (body.code !== 0) {
    throw new Error(`图片上传失败（${body.code}）：${body.msg}`);
  }

  fileMap[image.id] = body.data.file_token;
  writeJsonMap(fileMapKey, fileMap);
  return body.data.file_token;
}

async function promptToFields(config: FeishuConfig, prompt: Prompt) {
  const attachments: Array<{ file_token: string }> = [];
  for (const image of prompt.prompt_images ?? []) {
    attachments.push({ file_token: await uploadImage(config, image) });
  }

  return {
    标题: prompt.title,
    正文: prompt.content,
    分类: prompt.categories?.name ?? "",
    标签: prompt.prompt_tags
      .map((row) => row.tags?.name)
      .filter(Boolean)
      .join(", "),
    图片: attachments
  };
}

async function findRecordIdByTitle(config: FeishuConfig, title: string): Promise<string | null> {
  const data = await request<{ items?: Array<{ record_id: string }> }>(config, "/records/search?page_size=1", {
    method: "POST",
    body: JSON.stringify({
      filter: {
        conjunction: "and",
        conditions: [{ field_name: "标题", operator: "is", value: [title] }]
      }
    })
  });
  return data.items?.[0]?.record_id ?? null;
}

export async function upsertPromptRecord(config: FeishuConfig, prompt: Prompt) {
  const fields = await promptToFields(config, prompt);
  const map = readJsonMap(recordMapKey);
  const cached = map[prompt.id];

  if (cached) {
    try {
      await request(config, `/records/${cached}`, {
        method: "PUT",
        body: JSON.stringify({ fields })
      });
      return;
    } catch {
      delete map[prompt.id];
      writeJsonMap(recordMapKey, map);
    }
  }

  const existing = await findRecordIdByTitle(config, prompt.title);
  if (existing) {
    await request(config, `/records/${existing}`, {
      method: "PUT",
      body: JSON.stringify({ fields })
    });
    map[prompt.id] = existing;
  } else {
    const data = await request<{ record: { record_id: string } }>(config, "/records", {
      method: "POST",
      body: JSON.stringify({ fields })
    });
    map[prompt.id] = data.record.record_id;
  }
  writeJsonMap(recordMapKey, map);
}

export async function deletePromptRecord(config: FeishuConfig, prompt: Pick<Prompt, "id" | "title">) {
  const map = readJsonMap(recordMapKey);
  const recordId = map[prompt.id] ?? (await findRecordIdByTitle(config, prompt.title));
  if (!recordId) return;

  try {
    await request(config, `/records/${recordId}`, { method: "DELETE" });
  } catch (caught) {
    // 记录已不存在时视为删除成功
    if (!(caught instanceof Error) || !caught.message.includes("Record")) {
      throw caught;
    }
  }
  delete map[prompt.id];
  writeJsonMap(recordMapKey, map);
}

export async function syncPromptsToFeishu(config: FeishuConfig, prompts: Prompt[]) {
  for (const prompt of prompts) {
    await upsertPromptRecord(config, prompt);
  }
}
