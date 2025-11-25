import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface Tag {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

export interface TagWithCount extends Tag {
  atom_count: number;
  children: TagWithCount[];
}

interface TagsStore {
  tags: TagWithCount[];
  isLoading: boolean;
  error: string | null;
  fetchTags: () => Promise<void>;
  createTag: (name: string, parentId?: string) => Promise<Tag>;
  updateTag: (id: string, name: string, parentId?: string) => Promise<Tag>;
  deleteTag: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useTagsStore = create<TagsStore>((set) => ({
  tags: [],
  isLoading: false,
  error: null,

  fetchTags: async () => {
    set({ isLoading: true, error: null });
    try {
      const tags = await invoke<TagWithCount[]>('get_all_tags');
      set({ tags, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  createTag: async (name: string, parentId?: string) => {
    set({ error: null });
    try {
      const tag = await invoke<Tag>('create_tag', {
        name,
        parentId: parentId || null,
      });
      // Refetch tags to get updated tree structure
      const tags = await invoke<TagWithCount[]>('get_all_tags');
      set({ tags });
      return tag;
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateTag: async (id: string, name: string, parentId?: string) => {
    set({ error: null });
    try {
      const tag = await invoke<Tag>('update_tag', {
        id,
        name,
        parentId: parentId || null,
      });
      // Refetch tags to get updated tree structure
      const tags = await invoke<TagWithCount[]>('get_all_tags');
      set({ tags });
      return tag;
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteTag: async (id: string) => {
    set({ error: null });
    try {
      await invoke('delete_tag', { id });
      // Refetch tags to get updated tree structure
      const tags = await invoke<TagWithCount[]>('get_all_tags');
      set({ tags });
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));

