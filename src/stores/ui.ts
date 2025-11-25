import { create } from 'zustand';

export type DrawerMode = 'editor' | 'viewer' | 'wiki';
export type ViewMode = 'grid' | 'list';

interface DrawerState {
  isOpen: boolean;
  mode: DrawerMode;
  atomId: string | null;
}

interface UIStore {
  selectedTagId: string | null;
  drawerState: DrawerState;
  viewMode: ViewMode;
  searchQuery: string;
  setSelectedTag: (tagId: string | null) => void;
  openDrawer: (mode: DrawerMode, atomId?: string) => void;
  closeDrawer: () => void;
  setViewMode: (mode: ViewMode) => void;
  setSearchQuery: (query: string) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  selectedTagId: null,
  drawerState: {
    isOpen: false,
    mode: 'viewer',
    atomId: null,
  },
  viewMode: 'grid',
  searchQuery: '',

  setSelectedTag: (tagId: string | null) => set({ selectedTagId: tagId }),

  openDrawer: (mode: DrawerMode, atomId?: string) =>
    set({
      drawerState: {
        isOpen: true,
        mode,
        atomId: atomId || null,
      },
    }),

  closeDrawer: () =>
    set((state) => ({
      drawerState: {
        ...state.drawerState,
        isOpen: false,
      },
    })),

  setViewMode: (mode: ViewMode) => set({ viewMode: mode }),

  setSearchQuery: (query: string) => set({ searchQuery: query }),
}));

