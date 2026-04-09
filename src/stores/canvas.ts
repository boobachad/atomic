import { create } from 'zustand';
import type { GlobalCanvasData } from '../lib/api';

interface CanvasController {
  zoomToCluster: (label: string) => void;
  focusAtom: (atomId: string) => void;
}

interface CanvasStore {
  // Registered controller functions (set by SigmaCanvas on mount)
  controller: CanvasController | null;
  registerController: (ctrl: CanvasController) => void;
  unregisterController: () => void;

  // Canvas data (clusters for chat context)
  canvasData: GlobalCanvasData | null;
  setCanvasData: (data: GlobalCanvasData) => void;

}

export const useCanvasStore = create<CanvasStore>()((set) => ({
  controller: null,
  canvasData: null,

  registerController: (ctrl) => set({ controller: ctrl }),
  unregisterController: () => set({ controller: null }),

  setCanvasData: (data) => set({ canvasData: data }),
}));
