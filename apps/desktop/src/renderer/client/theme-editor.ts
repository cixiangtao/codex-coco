import { useState } from "react";
import { normalizePrimaryColor, type ThemePreference } from "@codex-coco/ui/theme/contract";
import { useSavedSettings } from "./settings";

/** Window-owned preview survives page navigation; only save broadcasts to other windows. */
export function useThemeEditor() {
  const saved = useSavedSettings();
  const [draft, setDraft] = useState<{ theme: ThemePreference; revision: number } | null>(null);
  const [colorInput, setColorInput] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"theme" | "recovery">("theme");
  const theme = draft?.theme ?? saved.settings.theme;
  const color = colorInput ?? theme.primaryColor ?? "";
  const invalid = color !== "" && normalizePrimaryColor(color) === null;
  const conflict = draft !== null && draft.revision !== saved.settings.revision;
  const unavailable = saved.health === "invalid" || saved.health === "future-version";

  function update(patch: Partial<ThemePreference>) {
    setMessageKind("theme");
    setMessage("");
    setDraft((current) => ({
      theme: { ...(current?.theme ?? saved.settings.theme), ...patch },
      revision: current?.revision ?? saved.settings.revision,
    }));
  }
  function cancel() {
    setMessageKind("theme");
    setDraft(null);
    setColorInput(null);
    setMessage("预览已取消，已恢复保存的设置。");
  }
  async function save() {
    if (invalid || busy || conflict || unavailable) return;
    setMessageKind("theme");
    setBusy(true);
    setMessage("");
    try {
      const result = await window.codexCoco.saveTheme({
        expectedRevision: draft?.revision ?? saved.settings.revision,
        theme,
      });
      if (!result.ok) setMessage(result.error.message);
      else {
        setDraft(null);
        setColorInput(null);
        setMessage("主题已保存。");
      }
    } catch {
      setMessage("无法连接桌面服务，请重新打开窗口后重试。");
    } finally {
      setBusy(false);
    }
  }
  async function recover() {
    setMessageKind("recovery");
    setBusy(true);
    try {
      const result = await window.codexCoco.resetSettings();
      if (!result.ok) setMessage(result.error.message);
      else {
        setDraft(null);
        setColorInput(null);
        setMessage("原文件已备份，默认设置已恢复。");
      }
    } catch {
      setMessage("恢复未完成，请检查目录权限后重试。");
    } finally {
      setBusy(false);
    }
  }

  return {
    theme,
    color,
    invalid,
    conflict,
    unavailable,
    busy,
    message,
    recoveryMessage: messageKind === "recovery" ? message : "",
    dirty: draft !== null || colorInput !== null,
    update,
    cancel,
    save,
    recover,
    changeColor(value: string) {
      setColorInput(value);
      const parsed = normalizePrimaryColor(value);
      if (value === "" || parsed) update({ primaryColor: parsed });
    },
  };
}
export type ThemeEditor = ReturnType<typeof useThemeEditor>;
