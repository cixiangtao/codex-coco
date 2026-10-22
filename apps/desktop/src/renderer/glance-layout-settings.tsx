import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown, Plus, X } from "lucide-react";
import { Button } from "@codex-coco/ui/components/button";
import { SettingsGroup, SettingsRow } from "@codex-coco/ui/components/settings-group";
import { FieldLabel, FieldDescription } from "@codex-coco/ui/components/field";
import { Alert, AlertTitle, AlertDescription } from "@codex-coco/ui/components/alert";
import { glanceBlocks, defaultGlanceLayout, type GlanceLayout } from "../contracts/glance-layout";
import type { GlanceSnapshot } from "../contracts/glance";
import { acceptGlanceLayout, useGlanceLayout } from "./client/glance-layout";
import { GlanceBoard } from "./components/glance-board";

export function GlanceLayoutSettings({ active }: { active: boolean }) {
  const saved = useGlanceLayout();
  const [draft, setDraft] = useState<{ revision: number; value: GlanceLayout } | null>(null);
  const [preview, setPreview] = useState<GlanceSnapshot | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const accept = (snapshot: GlanceSnapshot) => {
      if (live) {
        setNow(Date.now());
      }
      if (live)
        setPreview((previous) =>
          !previous || snapshot.revision >= previous.revision ? snapshot : previous,
        );
    };
    const off = window.codexCoco.onGlanceChanged(accept);
    void window.codexCoco
      .glancePreview()
      .then((result) => {
        if (result.ok) accept(result.value);
      })
      .catch(() => {
        if (live) setMessage("速览预览暂不可用。");
      });
    return () => {
      live = false;
      off();
    };
  }, [active]);
  if (!saved) return null;
  const value = draft?.value ?? saved.value;
  const unavailable = !["ok", "missing"].includes(saved.health);
  const conflict = draft !== null && draft.revision !== saved.revision;
  const edit = (blocks: GlanceLayout["blocks"]) => {
    setDraft({ revision: draft?.revision ?? saved.revision, value: { blocks } });
    setMessage("");
  };
  async function save() {
    if (!draft) return;
    setPending(true);
    try {
      const result = await window.codexCoco.saveGlanceLayout({
        expectedRevision: draft.revision,
        value: draft.value,
      });
      if (result.ok) {
        acceptGlanceLayout(result.value);
        setDraft(null);
        setMessage("速览组合已保存。");
      } else setMessage(result.error.message);
    } catch {
      setMessage("速览组合未能保存，请重试。");
    } finally {
      setPending(false);
    }
  }
  return (
    <section aria-label="速览面板设置" className="settings-sections">
      <div>
        <h3>速览面板</h3>
        <p className="usage-source">
          选择信息块、调整顺序，组成自己的菜单栏速览。预览不改变当前悬浮窗。
        </p>
      </div>
      {unavailable && (
        <Alert variant="destructive">
          <AlertTitle>速览设置需要恢复</AlertTitle>
          <AlertDescription>
            <p>原配置已保留，恢复时先备份原文件。</p>
            <Button
              disabled={pending}
              variant="outline"
              onClick={async () => {
                setPending(true);
                try {
                  const result = await window.codexCoco.resetGlanceLayout();
                  if (result.ok) {
                    acceptGlanceLayout(result.value);
                    setDraft(null);
                    setMessage("速览设置已备份并恢复。");
                  } else setMessage(result.error.message);
                } catch {
                  setMessage("恢复未完成，原配置已保留。");
                } finally {
                  setPending(false);
                }
              }}
            >
              备份并恢复速览设置
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {conflict && (
        <Alert>
          <AlertTitle>速览组合已在其他窗口更新</AlertTitle>
          <AlertDescription>当前草稿保留，请取消修改后基于最新组合编辑。</AlertDescription>
        </Alert>
      )}
      <div className="glance-editor">
        <div className="settings-sections">
          <SettingsGroup
            title="已添加的信息块"
            description="相邻的额度窗口或消耗指标自动合并展示。移除只改变展示，不会停用来源模块。"
            disabled={pending || unavailable}
          >
            {!value.blocks.length && (
              <SettingsRow layout="stacked">
                <FieldLabel>尚未添加信息块</FieldLabel>
                <FieldDescription>从下方选择，也可以恢复默认组合。</FieldDescription>
              </SettingsRow>
            )}
            {value.blocks.map((id, index) => {
              const block = glanceBlocks.find((entry) => entry.id === id)!;
              return (
                <SettingsRow key={id}>
                  <FieldLabel>{block.title}</FieldLabel>
                  <div className="glance-editor-actions">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`上移${block.title}`}
                      disabled={index === 0}
                      onClick={() => {
                        const next = [...value.blocks];
                        [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                        edit(next);
                      }}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`下移${block.title}`}
                      disabled={index === value.blocks.length - 1}
                      onClick={() => {
                        const next = [...value.blocks];
                        [next[index + 1], next[index]] = [next[index]!, next[index + 1]!];
                        edit(next);
                      }}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`移除${block.title}`}
                      onClick={() => edit(value.blocks.filter((entry) => entry !== id))}
                    >
                      <X />
                    </Button>
                  </div>
                </SettingsRow>
              );
            })}
          </SettingsGroup>
          <SettingsGroup title="可添加的信息块" disabled={pending || unavailable}>
            {glanceBlocks
              .filter((block) => !value.blocks.includes(block.id))
              .map((block) => (
                <SettingsRow key={block.id}>
                  <FieldLabel>{block.title}</FieldLabel>
                  <FieldDescription>
                    {block.moduleId === "usage"
                      ? "用量"
                      : block.moduleId === "appearance"
                        ? "外观"
                        : "系统与菜单栏"}
                  </FieldDescription>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`添加${block.title}`}
                    onClick={() => edit([...value.blocks, block.id])}
                  >
                    <Plus data-icon="inline-start" />
                    添加
                  </Button>
                </SettingsRow>
              ))}
            {value.blocks.length === glanceBlocks.length && (
              <SettingsRow layout="stacked">
                <FieldLabel>所有信息块均已添加</FieldLabel>
              </SettingsRow>
            )}
          </SettingsGroup>
        </div>
        <aside className="glance-editor-preview" aria-label="速览实时预览">
          <h4>
            实时预览 <span>{draft ? "未保存" : "已保存"}</span>
          </h4>
          <div>
            {!active ? null : preview ? (
              <GlanceBoard snapshot={preview} layout={value} now={now} busy onOpen={() => {}} />
            ) : (
              <p>正在载入公开摘要…</p>
            )}
          </div>
        </aside>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={pending || !draft || unavailable || conflict}
          onClick={() => {
            void save();
          }}
        >
          保存速览组合
        </Button>
        <Button
          variant="outline"
          disabled={pending || !draft}
          onClick={() => {
            setDraft(null);
            setMessage("");
          }}
        >
          取消速览修改
        </Button>
        <Button
          variant="ghost"
          disabled={pending || unavailable}
          onClick={() => edit([...defaultGlanceLayout.blocks])}
        >
          恢复默认组合
        </Button>
      </div>
      <output aria-live="polite">{message}</output>
    </section>
  );
}
