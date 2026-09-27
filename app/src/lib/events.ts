import { useAppStore } from "./store";

let initialized = false;

export function initEvents() {
  if (initialized) return;
  const bridge = window.clefVoice;
  if (!bridge?.on) return;
  initialized = true;

  bridge.on("status", (data: any) => {
    if (data?.status) {
      useAppStore.getState().setStatus(data.status, data.message || "");
    }
  });

  bridge.on("modelProgress", (data: any) => {
    useAppStore.getState().setProgress(data.progress ?? 0);
  });

  bridge.on("transcribed", () => {
    window.dispatchEvent(new CustomEvent("clefVoice:transcribed"));
  });

  bridge.on("history", (data: any) => {
    window.dispatchEvent(new CustomEvent("clefVoice:history", { detail: data?.items || [] }));
  });

  bridge.on("stats", (data: any) => {
    window.dispatchEvent(new CustomEvent("clefVoice:stats", { detail: data }));
  });

  for (const type of ["settings", "permissions"]) {
    bridge.on(type, (data: any) => {
      window.dispatchEvent(new CustomEvent(`clefVoice:${type}`, { detail: data }));
    });
  }

  bridge.on("navigateTab", (data: any) => {
    window.dispatchEvent(new CustomEvent("clefVoice:navigateTab", { detail: data }));
  });
}
