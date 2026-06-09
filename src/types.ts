export type Category = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
};

export type Tag = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
};

export type PromptTagRow = {
  tag_id: string;
  tags: Tag | null;
};

export type PromptImage = {
  id: string;
  prompt_id: string;
  name: string;
  data_url: string;
  created_at: string;
};

export type Prompt = {
  id: string;
  user_id: string;
  title: string;
  content: string;
  category_id: string | null;
  created_at: string;
  updated_at: string;
  categories: Category | null;
  prompt_tags: PromptTagRow[];
  prompt_images?: PromptImage[];
};

export type PromptFormState = {
  title: string;
  content: string;
  categoryName: string;
  tagNames: string;
  images: PromptImage[];
};
