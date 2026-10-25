// dsh-tools Client 半边 为 dsh-tools-agents 行提供 Configure 二级页
// 行的模块名必须是裸包名 浏览器半边才会被加载
window.__ModuleLoader__.load({
  id: "dsh-tools",
  factory(require) {
    const React = require("react");
    const h = React.createElement;

    // 字典命名空间 与 Host settings 命名空间区分
    const DICT_NS = "settings.dshToolsAgents";
    // Host settings 命名空间 = cordis.patch.yml 里 insert 行的 id
    const NS = "dsh-tools-agents";
    // 注册 key 必须等于 <bundle 包名>#<row id>
    const ROW_KEY = "dsh-tools#dsh-tools-agents";

    const en = {
      title: "Plugin settings",
      summary: "Plugin settings",
      intro: "",
      everyTurns: "Injection interval (turns)",
      everyTurnsHint: "1-1000 turns.",
      openAgents: "Open AGENTS.md",
      openFailed: "Unable to open AGENTS.md. Check the host file opener.",
      maxSourceBytes: "Source size limit (bytes)",
      maxSourceBytesHint: "Skip AGENTS.md when its size exceeds this limit. Integer 1 - 9007199254740991 (Number.MAX_SAFE_INTEGER).",
      maxInjectBytes: "Injected body budget (bytes)",
      maxInjectBytesHint: "Body budget before truncation. Integer 1 - 9007199254740991 (Number.MAX_SAFE_INTEGER).",
      truncateOversize: "Truncate oversized content",
      truncateOversizeHint: "When checked, truncate and append a marker. When unchecked, skip and warn.",
      wrapSystemReminder: "Wrap in system-reminder",
      wrapSystemReminderHint: "When unchecked, inject plain text without the wrapper tag.",
      onlyIfChanged: "Inject only when changed",
      onlyIfChangedHint: "When checked, skip a hit turn while the file content is unchanged.",
      includeSubagents: "Include subagents",
      includeSubagentsHint: "Only affects agents created after the change.",
      save: "Save",
      reset: "Restore defaults",
      saving: "Saving...",
      saved: "Saved",
      invalidNumber: "Enter a whole number in range.",
      writeFailed: "The deployment did not accept these values. It reloaded the latest ones please review and retry.",
      readOnly: "This deployment stores settings read-only.",
      unavailable: "This plugin is not loaded so it cannot be configured right now.",
    };

    const zh = {
      title: "插件设置",
      summary: "插件设置",
      intro: "",
      everyTurns: "注入间隔（轮）",
      everyTurnsHint: "请输入 1 到 1000 的轮数。",
      openAgents: "打开AGENTS.md",
      openFailed: "无法打开 AGENTS.md，请检查宿主文件打开能力。",
      maxSourceBytes: "源文件大小上限（字节）",
      maxSourceBytesHint: "AGENTS.md 超过此值则整体跳过 整数 1 至 9007199254740991（Number.MAX_SAFE_INTEGER）。",
      maxInjectBytes: "单次注入正文预算（字节）",
      maxInjectBytesHint: "截断前的正文预算 整数 1 至 9007199254740991（Number.MAX_SAFE_INTEGER）。",
      truncateOversize: "超限时截断",
      truncateOversizeHint: "勾选则截断并追加标记 取消勾选则跳过并告警。",
      wrapSystemReminder: "包裹 system-reminder",
      wrapSystemReminderHint: "取消勾选则注入纯文本 不加包裹标签。",
      onlyIfChanged: "内容未变则不注入",
      onlyIfChangedHint: "勾选后命中轮号发现内容与上次注入相同则跳过。",
      includeSubagents: "对子智能体生效",
      includeSubagentsHint: "只影响改动之后新建的 agent。",
      save: "保存",
      reset: "恢复默认值",
      saving: "保存中...",
      saved: "已保存",
      invalidNumber: "请填范围内的整数。",
      writeFailed: "本部署没有接受这些值 已重新加载最新值 请核对后重试。",
      readOnly: "本部署的设置为只读。",
      unavailable: "该插件当前未加载 暂时无法配置。",
    };

    // 二级 Configure 页保留 7 个字段 不新增 enabled
    // min max step 必须与 Config 的 min() max() step() 逐项一致
    const FIELDS = [
      { key: "everyTurns", kind: "number", min: 1, max: 1000, step: 1 },
      { key: "maxSourceBytes", kind: "number", min: 1, max: Number.MAX_SAFE_INTEGER, step: 1 },
      { key: "maxInjectBytes", kind: "number", min: 1, max: Number.MAX_SAFE_INTEGER, step: 1 },
      { key: "truncateOversize", kind: "boolean" },
      { key: "wrapSystemReminder", kind: "boolean" },
      { key: "onlyIfChanged", kind: "boolean" },
      { key: "includeSubagents", kind: "boolean" },
    ];

    // 只用 --dsw-alias token 不写死颜色值
    const styles = {
      section: { display: "flex", flexDirection: "column", gap: "12px", maxWidth: "760px", color: "var(--dsw-alias-label-primary)" },
      title: { margin: 0, fontSize: "18px", fontWeight: 600 },
      hint: { margin: 0, fontSize: "13px", color: "var(--dsw-alias-label-tertiary)" },
      list: { display: "flex", flexDirection: "column", gap: "14px", margin: 0, padding: 0, listStyle: "none" },
      row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" },
      field: { display: "flex", flexDirection: "column", gap: "4px" },
      rowText: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: 1 },
      label: { fontSize: "14px", lineHeight: "22px" },
      input: { width: "180px", boxSizing: "border-box", padding: "6px 10px", font: "inherit", fontSize: "14px", borderRadius: "var(--dsw-radius-sm)", border: ".5px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-2)", color: "var(--dsw-alias-label-primary)" },
      // checkbox + hint 行与 dsh-delete-session 二级配置页保持一致
      checkbox: { flex: "0 0 auto", width: "16px", height: "16px", margin: 0, accentColor: "var(--dsw-alias-brand-primary)", cursor: "pointer" },
      error: { margin: 0, fontSize: "12px", color: "var(--dsw-alias-state-error-primary)" },
      actions: { display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" },
      button: { font: "inherit", fontSize: "14px", lineHeight: "22px", padding: "6px 14px", borderRadius: "var(--dsw-radius-sm)", border: ".5px solid var(--dsw-alias-border-l4)", background: "transparent", color: "var(--dsw-alias-label-primary)", cursor: "pointer", transition: "transform 80ms ease, opacity 80ms ease" },
      primary: { font: "inherit", fontSize: "14px", lineHeight: "22px", padding: "6px 14px", borderRadius: "var(--dsw-radius-sm)", border: "none", background: "var(--dsw-alias-button-primary-fill)", color: "var(--dsw-alias-label-primary-foreground)", cursor: "pointer", transition: "transform 80ms ease, opacity 80ms ease" },
      status: { fontSize: "13px", color: "var(--dsw-alias-label-secondary)" },
      statusError: { fontSize: "13px", color: "var(--dsw-alias-state-error-primary)" },
      statusOk: { fontSize: "13px", color: "var(--dsw-alias-state-success-primary)" },
    };

    function ActionButton(props) {
      const [pressed, setPressed] = React.useState(false);
      return h("button", {
        ...props,
        onPointerDown: () => setPressed(true),
        onPointerUp: () => setPressed(false),
        onPointerCancel: () => setPressed(false),
        onClick: props.onClick,
        style: { ...props.style, transform: pressed ? "scale(0.97)" : "scale(1)" },
      }, props.children);
    }

    // 客户端预校验 Host 侧最终由完整 schema 兜底
    function validate(field, raw) {
      if (field.kind !== "number") return undefined;
      if (typeof raw === "string" && raw.trim() === "") return "invalidNumber";
      const n = Number(raw);
      if (!Number.isSafeInteger(n)) return "invalidNumber";
      if (field.min !== undefined && n < field.min) return "invalidNumber";
      if (field.max !== undefined && n > field.max) return "invalidNumber";
      return undefined;
    }

    // 渲染单行 布尔一行 数字行外加字段级错误
    function renderField(field, view) {
      const hint = view.t(field.key + "Hint");
      const controlId = "dsh-tools-agents-" + field.key;
      const text = field.kind === "boolean"
        ? h("div", { key: "text", style: styles.rowText }, [
            h("label", { key: "label", htmlFor: controlId, style: styles.label }, view.t(field.key)),
            hint ? h("p", { key: "hint", style: styles.hint }, hint) : null,
          ])
        : h("div", { key: "text", style: styles.rowText }, [
            h("span", { key: "label", style: styles.label }, view.t(field.key)),
            hint ? h("p", { key: "hint", style: styles.hint }, hint) : null,
          ]);
      const control = field.kind === "boolean"
        ? h("input", {
            id: controlId,
            key: "control",
            type: "checkbox",
            checked: view.value === true,
            disabled: view.disabled,
            "aria-label": view.t(field.key),
            style: styles.checkbox,
            onChange: (event) => view.onChange(event.target.checked),
          })
        : h("input", {
            key: "control",
            type: "number",
            inputMode: "numeric",
            min: field.min,
            max: field.max,
            step: field.step,
            value: view.value,
            disabled: view.disabled,
            "aria-label": view.t(field.key),
            style: view.error === undefined ? styles.input : { ...styles.input, borderColor: "var(--dsw-alias-state-error-primary)" },
            onChange: (event) => view.onChange(event.target.value),
          });
      if (field.kind === "boolean") {
        return h("li", { key: field.key, style: { ...styles.row, justifyContent: "flex-start", alignItems: "flex-start", gap: "10px" } }, [control, text]);
      }
      return h("li", { key: field.key, style: styles.field }, [
        h("div", { key: "line", style: styles.row }, [text, control]),
        view.error === undefined ? null : h("p", { key: "error", style: styles.error }, view.t(view.error)),
      ]);
    }

    // 表单主体 本地草稿加显式保存 快照由卡片订阅后传入
    function DshAmiForm(props) {
      const t = props.t;
      const form = props.form;
      const state = props.state;
      const openAgents = props.openAgents;
      const value = state.value ?? {};
      const [draft, setDraft] = React.useState(null);
      const [errors, setErrors] = React.useState({});
      const [status, setStatus] = React.useState("idle");
      const [message, setMessage] = React.useState(null);
      const [basedOn, setBasedOn] = React.useState(state.revision);

      // revision 变化说明 Host 值已更新 只在未失败且非写入中时丢弃草稿
      React.useEffect(() => {
        if (state.revision === basedOn) return;
        setBasedOn(state.revision);
        // 失败或写入中保留草稿 否则会丢用户输入与失败提示
        if (status === "failed" || status === "saving") return;
        setDraft(null);
        setErrors({});
      }, [state.revision, basedOn, status]);

      const editor = (field) => {
        const raw = draft === null ? undefined : draft[field.key];
        if (raw !== undefined) return raw;
        const host = value[field.key];
        if (field.kind === "boolean") return host === true;
        return host === undefined || host === null ? "" : String(host);
      };

      const edit = (field, next) => {
        setDraft((prev) => ({ ...(prev ?? {}), [field.key]: next }));
        setErrors((prev) => ({ ...prev, [field.key]: validate(field, next) }));
        setStatus("idle");
        setMessage(null);
      };

      const ops = [];
      for (const field of FIELDS) {
        const raw = draft === null ? undefined : draft[field.key];
        if (raw === undefined) continue;
        if (field.kind === "boolean") {
          const next = raw === true;
          if (next !== (value[field.key] === true)) ops.push({ op: "set", path: [field.key], value: next });
          continue;
        }
        const n = Number(raw);
        if (n !== value[field.key]) ops.push({ op: "set", path: [field.key], value: n });
      }
      const invalid = Object.keys(errors).some((key) => errors[key] !== undefined);
      const busy = status === "saving";
      const disabled = state.writable !== true || busy;

      const save = async () => {
        if (invalid || busy || ops.length === 0) return;
        setStatus("saving");
        setMessage(null);
        try {
          const ok = await form.mutate(ops, state.revision);
          setStatus(ok ? "saved" : "failed");
          if (ok) { setDraft(null); setErrors({}); } else setMessage(t("writeFailed"));
        } catch (error) {
          setStatus("failed");
          setMessage(String(error?.message ?? error));
        }
      };

      const reset = async () => {
        if (busy) return;
        setStatus("saving");
        setMessage(null);
        try {
          const ok = await form.mutate(FIELDS.map((field) => ({ op: "unset", path: [field.key] })), state.revision);
          setStatus(ok ? "saved" : "failed");
          if (ok) { setDraft(null); setErrors({}); } else setMessage(t("writeFailed"));
        } catch (error) {
          setStatus("failed");
          setMessage(String(error?.message ?? error));
        }
      };

      const open = async () => {
        setMessage(null);
        try {
          if (typeof openAgents !== "function") throw new Error(t("openFailed"));
          await openAgents();
        } catch (error) {
          setStatus("failed");
          setMessage(String(error?.message ?? error));
        }
      };

      const statusText = status === "saving" ? t("saving") : status === "saved" ? t("saved") : message;
      const statusStyle = status === "failed" ? styles.statusError : status === "saved" ? styles.statusOk : styles.status;

      return h("div", { style: styles.section }, [
        h("ul", { key: "fields", style: styles.list }, FIELDS.map((field) => renderField(field, {
          t,
          value: editor(field),
          error: errors[field.key],
          disabled,
          onChange: (next) => edit(field, next),
        }))),
        h("div", { key: "actions", style: styles.actions }, [
          h(ActionButton, {
            key: "save",
            type: "button",
            disabled: disabled || invalid || ops.length === 0,
            onClick: save,
            style: { ...styles.primary, opacity: disabled || invalid || ops.length === 0 ? 0.5 : 1 },
          }, t("save")),
          h(ActionButton, {
            key: "reset",
            type: "button",
            disabled,
            onClick: reset,
            style: { ...styles.button, opacity: disabled ? 0.5 : 1 },
          }, t("reset")),
          h(ActionButton, {
            key: "openAgents",
            type: "button",
            disabled: busy,
            onClick: open,
            style: { ...styles.button, opacity: busy ? 0.5 : 1 },
          }, t("openAgents")),
          statusText === null || statusText === undefined ? null : h("span", { key: "status", style: statusStyle }, statusText),
        ]),
      ]);
    }

    // 订阅自持 controller 忽略 owner 传入的 props.form
    function makeCard(form) {
      function DshAmiCard(props) {
        const t = props.t;
        // hooks 必须在任何早返回之前调用
        const [state, setState] = React.useState(() => form.getSnapshot());
        React.useEffect(() => {
          setState(form.getSnapshot());
          return form.subscribe(() => setState(form.getSnapshot()));
        }, [form]);
        if (props.view === "summary") return t("summary");
        if (state.status !== "ready") return h("p", { style: styles.hint }, t("unavailable"));
        const children = [];
        if (state.writable !== true) children.push(h("p", { key: "readOnly", style: styles.hint }, t("readOnly")));
        children.push(h(DshAmiForm, { key: "form", t, form, state, openAgents: props.openAgents }));
        return h("div", { style: styles.section }, children);
      }
      return DshAmiCard;
    }

    const inject = ["slots", "locale", "configForms"];

    function apply(ctx) {
      const t = ctx.locale.bind(DICT_NS);
      const openAgents = async () => {
        const response = await fetch("/api/dsh-tools/agents/open-agents", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        let result;
        try { result = await response.json(); } catch { throw new Error("Invalid host response"); }
        if (!response.ok || result?.ok !== true) throw new Error(result?.error ?? "Unable to open AGENTS.md");
      };
      ctx.effect(() => ctx.locale.register(DICT_NS, { zh, en }), "dsh-tools-agents: dictionaries");
      // controller 由 provider 共享拥有 只订阅不 dispose
      const form = ctx.configForms.get(NS);
      const Card = makeCard(form);
      const mount = (name, key) => ctx.effect(() => ctx.slots.inject(name, () =>
        ctx.slots.register({ name, key, locale: DICT_NS }, (props) => h(Card, { ...props, openAgents }))), "dsh-tools-agents: " + name);
      // 仅挂载 row Configure 二级页
      mount("plugins.row.config", ROW_KEY);
    }

    return { inject, apply };
  },
});
