import React from "react";
import ReactDOM from "react-dom/client";
import { Check, Copy, Download, Edit2, Expand, ImagePlus, Plus, Search, Settings, Trash2, Upload, X } from "lucide-react";
import type { Category, Prompt, PromptFormState, PromptImage, Tag } from "./types";
import "./styles.css";

const emptyForm: PromptFormState = {
  title: "",
  content: "",
  categoryName: "",
  tagNames: "",
  images: []
};

const defaultCategoryNames = ["文本", "绘图", "视频"];
const localStorageKey = "prompt-helper-local-data";
const oldDemoStorageKey = "prompt-helper-demo-data";

type DemoData = {
  categories: Category[];
  tags: Tag[];
  prompts: Prompt[];
};

function splitTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,，\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function getPromptTags(prompt: Prompt) {
  return prompt.prompt_tags.map((row) => row.tags).filter((tag): tag is Tag => Boolean(tag));
}

function fileToPromptImage(file: File): Promise<PromptImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        id: crypto.randomUUID(),
        prompt_id: "",
        name: file.name || "粘贴图片",
        data_url: String(reader.result),
        created_at: new Date().toISOString()
      });
    };
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });
}

function normalizeData(data: Partial<DemoData>): DemoData {
  return {
    categories: Array.isArray(data.categories) ? data.categories : [],
    tags: Array.isArray(data.tags) ? data.tags : [],
    prompts: Array.isArray(data.prompts) ? data.prompts : []
  };
}

function isExportWrapper(value: unknown): value is { data: Partial<DemoData> } {
  return Boolean(value && typeof value === "object" && "data" in value);
}

function readLocalData(): DemoData {
  const raw = window.localStorage.getItem(localStorageKey) ?? window.localStorage.getItem(oldDemoStorageKey);
  if (!raw) {
    const data = createLocalData();
    writeLocalData(data);
    return data;
  }

  try {
    const data = normalizeData(JSON.parse(raw) as Partial<DemoData>);
    writeLocalData(data);
    return data;
  } catch {
    const data = createLocalData();
    writeLocalData(data);
    return data;
  }
}

function writeLocalData(data: DemoData) {
  window.localStorage.setItem(localStorageKey, JSON.stringify(data));
}

function createLocalData(): DemoData {
  return seedDefaultCategories({ categories: [], tags: [], prompts: [] });
}

function seedDefaultCategories(data: DemoData): DemoData {
  const now = new Date().toISOString();
  const existingNames = new Set(data.categories.map((category) => category.name));
  const missingCategories = defaultCategoryNames
    .filter((name) => !existingNames.has(name))
    .map((name) => ({
      id: `demo-${name}`,
      user_id: "demo",
      name,
      created_at: now
    }));

  if (missingCategories.length === 0) {
    return data;
  }

  const nextData = {
    ...data,
    categories: [...data.categories, ...missingCategories]
  };
  return nextData;
}

function App() {
  const importInputRef = React.useRef<HTMLInputElement | null>(null);
  const [error, setError] = React.useState("");
  const [copyState, setCopyState] = React.useState<string | null>(null);
  const [prompts, setPrompts] = React.useState<Prompt[]>([]);
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [tags, setTags] = React.useState<Tag[]>([]);
  const [query, setQuery] = React.useState("");
  const [categoryFilter, setCategoryFilter] = React.useState("");
  const [tagFilter, setTagFilter] = React.useState("");
  const [editingPrompt, setEditingPrompt] = React.useState<Prompt | null>(null);
  const [isEditorOpen, setIsEditorOpen] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [previewImage, setPreviewImage] = React.useState<PromptImage | null>(null);
  const [form, setForm] = React.useState<PromptFormState>(emptyForm);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    loadData();
  }, []);

  React.useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      return;
    }

    void chrome.storage.local.get(["prompt-helper-filters"]).then((result) => {
      const filters = result["prompt-helper-filters"] as Partial<{
        query: string;
        categoryFilter: string;
        tagFilter: string;
      }> | undefined;

      if (!filters) return;
      setQuery(filters.query ?? "");
      setCategoryFilter(filters.categoryFilter ?? "");
      setTagFilter(filters.tagFilter ?? "");
    });
  }, []);

  React.useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      return;
    }

    void chrome.storage.local.set({
      "prompt-helper-filters": { query, categoryFilter, tagFilter }
    });
  }, [query, categoryFilter, tagFilter]);

  function loadData() {
    const data = readLocalData();
    setCategories(data.categories);
    setTags(data.tags);
    setPrompts([...data.prompts].sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
  }

  function openCreateEditor() {
    setEditingPrompt(null);
    setForm(emptyForm);
    setError("");
    setIsEditorOpen(true);
  }

  function openEditEditor(prompt: Prompt) {
    setEditingPrompt(prompt);
    setError("");
    setForm({
      title: prompt.title,
      content: prompt.content,
      categoryName: prompt.categories?.name ?? "",
      tagNames: getPromptTags(prompt)
        .map((tag) => tag.name)
        .join(", "),
      images: prompt.prompt_images ?? []
    });
    setIsEditorOpen(true);
  }

  async function addImageFiles(files: FileList | File[]) {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      setError("请选择图片文件。");
      return;
    }

    try {
      const nextImages = await Promise.all(imageFiles.map(fileToPromptImage));
      setForm((current) => ({
        ...current,
        images: [...current.images, ...nextImages]
      }));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "图片读取失败。");
    }
  }

  async function handlePaste(event: React.ClipboardEvent) {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;

    event.preventDefault();
    await addImageFiles(files);
  }

  function removeImage(imageId: string) {
    setForm((current) => ({
      ...current,
      images: current.images.filter((image) => image.id !== imageId)
    }));
  }

  async function ensureCategory(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return null;

    const existing = categories.find((category) => category.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;

    return crypto.randomUUID();
  }

  async function ensureTags(names: string[]) {
    const ids: string[] = [];

    for (const name of names) {
      const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        ids.push(existing.id);
        continue;
      }

      ids.push(crypto.randomUUID());
    }

    return ids;
  }

  async function savePrompt(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title.trim() || !form.content.trim()) {
      setError("标题和正文不能为空。");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const categoryId = await ensureCategory(form.categoryName);
      const tagIds = await ensureTags(splitTags(form.tagNames));
      const tagNames = splitTags(form.tagNames);

      const current = readLocalData();
      const now = new Date().toISOString();
      let nextCategories = current.categories;
      let nextTags = current.tags;
      let category: Category | null = null;

      if (form.categoryName.trim()) {
        category =
          nextCategories.find((item) => item.name.toLowerCase() === form.categoryName.trim().toLowerCase()) ?? null;

        if (!category) {
          category = {
            id: categoryId ?? crypto.randomUUID(),
            user_id: "local",
            name: form.categoryName.trim(),
            created_at: now
          };
          nextCategories = [...nextCategories, category];
        }
      }

      const selectedTags = tagNames.map((name, index) => {
        const existing = nextTags.find((item) => item.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing;

        const tag = {
          id: tagIds[index] ?? crypto.randomUUID(),
          user_id: "local",
          name,
          created_at: now
        };
        nextTags = [...nextTags, tag];
        return tag;
      });

      const promptId = editingPrompt?.id ?? crypto.randomUUID();
      const prompt: Prompt = {
        id: promptId,
        user_id: "local",
        title: form.title.trim(),
        content: form.content.trim(),
        category_id: category?.id ?? null,
        categories: category,
        prompt_tags: selectedTags.map((tag) => ({ tag_id: tag.id, tags: tag })),
        prompt_images: form.images.map((image) => ({
          ...image,
          prompt_id: promptId
        })),
        created_at: editingPrompt?.created_at ?? now,
        updated_at: now
      };

      const nextPrompts = editingPrompt
        ? current.prompts.map((item) => (item.id === editingPrompt.id ? prompt : item))
        : [prompt, ...current.prompts];

      writeLocalData({
        categories: nextCategories,
        tags: nextTags,
        prompts: nextPrompts
      });

      setIsEditorOpen(false);
      loadData();
    } catch (caught) {
      if (caught instanceof DOMException && (caught.name === "QuotaExceededError" || caught.code === 22)) {
        setError("存储空间不足：本地存储约有 5MB 上限，图片占用最大。请删除部分带图提示词或压缩图片后重试。");
      } else {
        setError(caught instanceof Error ? caught.message : "保存失败，请稍后重试。");
      }
    } finally {
      setSaving(false);
    }
  }

  async function deletePrompt(prompt: Prompt) {
    const ok = window.confirm(`确定删除「${prompt.title}」吗？`);
    if (!ok) return;

    setError("");

    const current = readLocalData();
    writeLocalData({
      ...current,
      prompts: current.prompts.filter((item) => item.id !== prompt.id)
    });
    loadData();
  }

  function renameCategory(category: Category) {
    const next = window.prompt("重命名分类", category.name)?.trim();
    if (!next || next === category.name) return;

    const current = readLocalData();
    if (current.categories.some((item) => item.id !== category.id && item.name.toLowerCase() === next.toLowerCase())) {
      window.alert("已存在同名分类。");
      return;
    }

    writeLocalData({
      ...current,
      categories: current.categories.map((item) => (item.id === category.id ? { ...item, name: next } : item)),
      prompts: current.prompts.map((item) =>
        item.category_id === category.id && item.categories ? { ...item, categories: { ...item.categories, name: next } } : item
      )
    });
    loadData();
  }

  function deleteCategory(category: Category) {
    const count = prompts.filter((item) => item.category_id === category.id).length;
    const suffix = count > 0 ? `${count} 条提示词将变为未分类。` : "";
    const ok = window.confirm(`确定删除分类「${category.name}」吗？${suffix}`);
    if (!ok) return;

    const current = readLocalData();
    writeLocalData({
      ...current,
      categories: current.categories.filter((item) => item.id !== category.id),
      prompts: current.prompts.map((item) =>
        item.category_id === category.id ? { ...item, category_id: null, categories: null } : item
      )
    });
    if (categoryFilter === category.id) setCategoryFilter("");
    loadData();
  }

  function renameTag(tag: Tag) {
    const next = window.prompt("重命名标签", tag.name)?.trim();
    if (!next || next === tag.name) return;

    const current = readLocalData();
    if (current.tags.some((item) => item.id !== tag.id && item.name.toLowerCase() === next.toLowerCase())) {
      window.alert("已存在同名标签。");
      return;
    }

    writeLocalData({
      ...current,
      tags: current.tags.map((item) => (item.id === tag.id ? { ...item, name: next } : item)),
      prompts: current.prompts.map((item) => ({
        ...item,
        prompt_tags: item.prompt_tags.map((row) =>
          row.tag_id === tag.id && row.tags ? { ...row, tags: { ...row.tags, name: next } } : row
        )
      }))
    });
    loadData();
  }

  function deleteTag(tag: Tag) {
    const count = prompts.filter((item) => item.prompt_tags.some((row) => row.tag_id === tag.id)).length;
    const suffix = count > 0 ? `${count} 条提示词将移除该标签。` : "";
    const ok = window.confirm(`确定删除标签「${tag.name}」吗？${suffix}`);
    if (!ok) return;

    const current = readLocalData();
    writeLocalData({
      ...current,
      tags: current.tags.filter((item) => item.id !== tag.id),
      prompts: current.prompts.map((item) => ({
        ...item,
        prompt_tags: item.prompt_tags.filter((row) => row.tag_id !== tag.id)
      }))
    });
    if (tagFilter === tag.id) setTagFilter("");
    loadData();
  }

  async function copyPrompt(prompt: Prompt) {
    setCopyState(null);
    try {
      await navigator.clipboard.writeText(prompt.content);
      setCopyState(prompt.id);
      window.setTimeout(() => setCopyState(null), 1600);
    } catch {
      setError("复制失败，请检查浏览器剪贴板权限。");
    }
  }

  const filteredPrompts = prompts.filter((prompt) => {
    const normalizedQuery = query.trim().toLowerCase();
    const matchesQuery =
      !normalizedQuery ||
      prompt.title.toLowerCase().includes(normalizedQuery) ||
      prompt.content.toLowerCase().includes(normalizedQuery);
    const matchesCategory = !categoryFilter || prompt.category_id === categoryFilter;
    const matchesTag = !tagFilter || getPromptTags(prompt).some((tag) => tag.id === tagFilter);
    return matchesQuery && matchesCategory && matchesTag;
  });

  function exportJson() {
    const data = readLocalData();
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), data }, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `提示词助手-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importJsonFile(file: File) {
    try {
      const ok = window.confirm("导入会覆盖当前全部提示词、分类、标签和图片，确定继续吗？");
      if (!ok) return;

      const parsed = JSON.parse(await file.text()) as unknown;
      const imported = isExportWrapper(parsed) ? parsed.data : parsed;
      writeLocalData(normalizeData(imported as Partial<DemoData>));
      setError("");
      loadData();
    } catch {
      setError("导入失败，请确认选择的是提示词助手导出的 JSON 文件。");
    }
  }

  return (
    <main className="popup">
      <header className="topbar">
        <div>
          <h1>提示词助手</h1>
          <p>收藏、分类、搜索并复制你的常用提示词。</p>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" onClick={() => setIsSettingsOpen(true)} title="设置" aria-label="设置">
            <Settings size={17} />
          </button>
          <input
            ref={importInputRef}
            className="hidden-file-input"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importJsonFile(file);
              event.target.value = "";
            }}
          />
        </div>
      </header>

      <section className="toolbar">
        <div className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或正文" />
        </div>
        <div className="filters">
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="">全部分类</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
            <option value="">全部标签</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </div>
        <button className="primary-button" onClick={openCreateEditor}>
          <Plus size={16} />
          新建提示词
        </button>
      </section>

      {error ? <p className="error-banner">{error}</p> : null}

      <section className="prompt-list" aria-live="polite">
        {filteredPrompts.length === 0 ? (
          <div className="empty-state compact">
            <p>{prompts.length === 0 ? "还没有提示词，先新建一条。" : "没有符合条件的提示词。"}</p>
          </div>
        ) : (
          filteredPrompts.map((prompt) => {
            const promptTags = getPromptTags(prompt);
            return (
              <article key={prompt.id} className="prompt-card">
                <div className="prompt-card-header">
                  <div>
                    <h2>{prompt.title}</h2>
                    <p>{prompt.categories?.name ?? "未分类"}</p>
                  </div>
                  <div className="card-actions">
                    <button className="icon-button" onClick={() => copyPrompt(prompt)} title="复制正文" aria-label="复制正文">
                      {copyState === prompt.id ? <Check size={17} /> : <Copy size={17} />}
                    </button>
                    <button className="icon-button" onClick={() => openEditEditor(prompt)} title="编辑" aria-label="编辑">
                      <Edit2 size={17} />
                    </button>
                    <button className="icon-button danger" onClick={() => deletePrompt(prompt)} title="删除" aria-label="删除">
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>
                <p className="prompt-content">{prompt.content}</p>
                {prompt.prompt_images && prompt.prompt_images.length > 0 ? (
                  <div className="image-row">
                    {prompt.prompt_images.map((image) => (
                      <div key={image.id} className="image-thumb">
                        <img src={image.data_url} alt={image.name} />
                        <button
                          type="button"
                          onClick={() => setPreviewImage(image)}
                          aria-label={`放大图片：${image.name}`}
                          title="放大图片"
                        >
                          <Expand size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {promptTags.length > 0 ? (
                  <div className="tag-row">
                    {promptTags.map((tag) => (
                      <span key={tag.id}>{tag.name}</span>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </section>

      <footer className="app-footer">
        <a href="https://github.com/shangtianqiang/prompt-helper-extension" target="_blank" rel="noreferrer">
          项目来源：prompt-helper-extension
        </a>
      </footer>

      {isEditorOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-label={editingPrompt ? "编辑提示词" : "新建提示词"}>
            <header className="modal-header">
              <h2>{editingPrompt ? "编辑提示词" : "新建提示词"}</h2>
              <button className="icon-button" onClick={() => setIsEditorOpen(false)} title="关闭" aria-label="关闭">
                <X size={18} />
              </button>
            </header>
            <form className="editor-form" onSubmit={savePrompt} onPaste={handlePaste}>
              <label>
                标题
                <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
              </label>
              <label>
                正文
                <textarea value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} required />
              </label>
              <label>
                分类
                <input
                  list="category-options"
                  value={form.categoryName}
                  onChange={(event) => setForm({ ...form, categoryName: event.target.value })}
                  placeholder="例如：写作"
                />
                <datalist id="category-options">
                  {categories.map((category) => (
                    <option key={category.id} value={category.name} />
                  ))}
                </datalist>
              </label>
              <label>
                标签
                <input
                  value={form.tagNames}
                  onChange={(event) => setForm({ ...form, tagNames: event.target.value })}
                  placeholder="用逗号分隔，例如：SEO, 周报"
                />
              </label>
              <label>
                示例图片
                <div className="image-upload">
                  <ImagePlus size={18} />
                  <span>上传图片，或直接在正文粘贴截图/图片</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) => {
                      if (event.target.files) {
                        void addImageFiles(event.target.files);
                        event.target.value = "";
                      }
                    }}
                  />
                </div>
              </label>
              {form.images.length > 0 ? (
                <div className="image-preview-grid">
                  {form.images.map((image) => (
                    <figure key={image.id}>
                      <img src={image.data_url} alt={image.name} />
                      <button type="button" onClick={() => removeImage(image.id)} aria-label="移除图片" title="移除图片">
                        <X size={14} />
                      </button>
                    </figure>
                  ))}
                </div>
              ) : null}
              {error ? <p className="error-text">{error}</p> : null}
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setIsEditorOpen(false)}>
                  取消
                </button>
                <button type="submit" className="primary-button" disabled={saving}>
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {isSettingsOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal settings-modal" role="dialog" aria-modal="true" aria-label="设置">
            <header className="modal-header">
              <h2>设置</h2>
              <button className="icon-button" onClick={() => setIsSettingsOpen(false)} title="关闭" aria-label="关闭">
                <X size={18} />
              </button>
            </header>
            <div className="settings-content">
              <p>本地存储：可用 JSON 迁移到新电脑。</p>
              <button className="secondary-button" type="button" onClick={() => importInputRef.current?.click()}>
                <Upload size={16} />
                导入覆盖 JSON
              </button>
              <button className="secondary-button" type="button" onClick={exportJson}>
                <Download size={16} />
                导出全部 JSON
              </button>
              <div className="manage-section">
                <h3>分类管理</h3>
                {categories.length === 0 ? (
                  <p className="manage-empty">暂无分类</p>
                ) : (
                  <ul className="manage-list">
                    {categories.map((category) => (
                      <li key={category.id}>
                        <span>{category.name}</span>
                        <div className="manage-actions">
                          <button
                            className="icon-button small"
                            onClick={() => renameCategory(category)}
                            title="重命名"
                            aria-label={`重命名分类：${category.name}`}
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            className="icon-button small danger"
                            onClick={() => deleteCategory(category)}
                            title="删除"
                            aria-label={`删除分类：${category.name}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <h3>标签管理</h3>
                {tags.length === 0 ? (
                  <p className="manage-empty">暂无标签</p>
                ) : (
                  <ul className="manage-list">
                    {tags.map((tag) => (
                      <li key={tag.id}>
                        <span>{tag.name}</span>
                        <div className="manage-actions">
                          <button
                            className="icon-button small"
                            onClick={() => renameTag(tag)}
                            title="重命名"
                            aria-label={`重命名标签：${tag.name}`}
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            className="icon-button small danger"
                            onClick={() => deleteTag(tag)}
                            title="删除"
                            aria-label={`删除标签：${tag.name}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {previewImage ? (
        <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="图片预览">
          <section>
            <header>
              <span>{previewImage.name}</span>
              <button className="icon-button" onClick={() => setPreviewImage(null)} title="关闭" aria-label="关闭">
                <X size={18} />
              </button>
            </header>
            <img src={previewImage.data_url} alt={previewImage.name} />
          </section>
        </div>
      ) : null}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
