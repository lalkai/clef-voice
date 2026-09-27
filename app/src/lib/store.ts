import { create } from "zustand";
import type { AppStatus } from "../types";

interface AppState {
  status: AppStatus;
  message: string;
  progress: number;
  statusRevision: number;
  setProgress: (progress: number) => void;
  setStatus: (status: AppStatus, message: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  status: "loading",
  message: "Preparing model...",
  progress: 0,
  statusRevision: 0,
  setProgress: (progress) => set({ progress }),
  setStatus: (status, message) => set((state) => ({
    status,
    message,
    statusRevision: state.statusRevision + 1,
  })),
}));
