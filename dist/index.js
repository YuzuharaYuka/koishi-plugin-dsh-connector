// client/index.ts
import { defineComponent, h, inject, onUnmounted, ref } from "vue";
var NAV_SECTIONS = [
  {
    title: "基础",
    items: [
      { label: "连接", header: "连接" },
      { label: "会话", header: "会话" }
    ]
  },
  {
    title: "消息",
    items: [
      { label: "回复", header: "回复" },
      { label: "图片", header: "图片" },
      { label: "用量", header: "用量" }
    ]
  },
  {
    title: "其他",
    items: [
      { label: "交互", header: "交互" },
      { label: "权限", header: "权限" },
      { label: "附件", header: "附件" },
      { label: "调试", header: "调试" }
    ]
  }
];
var LABEL_BY_HEADER = /* @__PURE__ */ new Map();
for (const section of NAV_SECTIONS) {
  for (const item of section.items) LABEL_BY_HEADER.set(item.header, item.label);
}
var PLUGIN_NAME = "koishi-plugin-dsh-connector";
var EDGE = 8;
var ACTIVE_LINE = 140;
var PANEL_CSS = `
.dsh-nav{position:fixed;z-index:2000;width:150px;max-height:70vh;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--k-card-border,#e5e7eb);border-radius:8px;background:var(--k-card-bg,#fff);box-shadow:var(--k-card-shadow,0 4px 16px rgba(0,0,0,.12));font-size:13px;user-select:none}
.dsh-nav-header{display:flex;align-items:center;justify-content:space-between;height:28px;padding:0 6px 0 10px;border-bottom:1px solid var(--k-color-divider,#ebeef5);background:var(--k-hover-bg,#f5f6f8);color:var(--k-text-light,#909399);cursor:move}
.dsh-nav-title{font-size:12px;font-weight:600}
.dsh-nav-toggle{padding:2px 6px;border:0;background:transparent;color:inherit;font-size:12px;line-height:1;cursor:pointer}
.dsh-nav-body{overflow-y:auto;padding:4px 0}
.dsh-nav-section{padding:6px 10px 2px;color:var(--k-text-light,#909399);font-size:11px;font-weight:600}
.dsh-nav-item{padding:5px 12px;border-left:3px solid transparent;color:var(--k-text-normal,#606266);cursor:pointer;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.dsh-nav-item:hover{background:var(--k-hover-bg,#f5f6f8);color:var(--k-text-active,#303133)}
.dsh-nav-item.is-active{border-left-color:var(--k-color-primary,#409eff);background:var(--k-activity-bg,rgba(64,158,255,.08));color:var(--k-color-primary,#409eff);font-weight:500}
.dsh-nav.is-collapsed .dsh-nav-body{display:none}
`;
var styleInjected = false;
function ensureStyle() {
  if (styleInjected || typeof document === "undefined") return;
  styleInjected = true;
  const style = document.createElement("style");
  style.dataset.dshConnectorNav = "1";
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
}
function collectHeaders() {
  return Array.from(document.querySelectorAll(".k-schema-header"));
}
function resolveHeader(header) {
  return collectHeaders().find((el) => (el.textContent ?? "").trim() === header) ?? null;
}
function findScroller(el) {
  let parent = el.parentElement;
  while (parent) {
    const style = getComputedStyle(parent);
    if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight) return parent;
    parent = parent.parentElement;
  }
  return null;
}
function pointOf(event) {
  if ("touches" in event) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    return { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 };
  }
  return { x: event.clientX, y: event.clientY };
}
var ConfigNav = defineComponent({
  name: "DshConnectorConfigNav",
  setup() {
    ensureStyle();
    const collapsed = ref(false);
    const active = ref("");
    const origin = ref({ top: 120, right: 16 });
    const available = ref(/* @__PURE__ */ new Set());
    const drag = { ing: false, startX: 0, startY: 0, startTop: 0, startRight: 0, width: 0, height: 0 };
    function collectTargets() {
      const targets = [];
      for (const el of collectHeaders()) {
        const label = LABEL_BY_HEADER.get((el.textContent ?? "").trim());
        if (label) targets.push({ el, label });
      }
      return targets;
    }
    let scroller = null;
    function currentScroller(targets) {
      if (scroller?.isConnected) return scroller;
      scroller = targets.length > 0 ? findScroller(targets[0].el) : null;
      return scroller;
    }
    function refresh() {
      const found = /* @__PURE__ */ new Set();
      for (const el of collectHeaders()) {
        const text = (el.textContent ?? "").trim();
        if (LABEL_BY_HEADER.has(text)) found.add(text);
      }
      if (found.size !== available.value.size || [...found].some((text) => !available.value.has(text))) {
        available.value = found;
      }
    }
    function syncActive() {
      const targets = collectTargets();
      if (targets.length === 0) return;
      const box = currentScroller(targets);
      if (box && box.scrollTop + box.clientHeight >= box.scrollHeight - 8) {
        active.value = targets[targets.length - 1].label;
        return;
      }
      let current = targets[0].label;
      for (const target of targets) {
        if (target.el.getBoundingClientRect().top <= ACTIVE_LINE) current = target.label;
        else break;
      }
      active.value = current;
    }
    function jump(item) {
      const target = resolveHeader(item.header);
      if (!target) return;
      active.value = item.label;
      target.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    function onDragStart(event) {
      const panel = event.currentTarget.closest(".dsh-nav");
      const rect = panel?.getBoundingClientRect();
      if (rect) {
        drag.width = rect.width;
        drag.height = rect.height;
      }
      const point = pointOf(event);
      drag.ing = true;
      drag.startX = point.x;
      drag.startY = point.y;
      drag.startTop = origin.value.top;
      drag.startRight = origin.value.right;
    }
    function onDragMove(event) {
      if (!drag.ing) return;
      const point = pointOf(event);
      const maxTop = Math.max(EDGE, window.innerHeight - drag.height - EDGE);
      const maxRight = Math.max(EDGE, window.innerWidth - drag.width - EDGE);
      origin.value = {
        top: Math.min(Math.max(drag.startTop + point.y - drag.startY, EDGE), maxTop),
        right: Math.min(Math.max(drag.startRight - (point.x - drag.startX), EDGE), maxRight)
      };
    }
    function onDragEnd() {
      drag.ing = false;
    }
    window.addEventListener("scroll", syncActive, true);
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
    window.addEventListener("touchmove", onDragMove);
    window.addEventListener("touchend", onDragEnd);
    let timer = null;
    const observer = new MutationObserver(() => {
      scroller = null;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        refresh();
        syncActive();
      }, 120);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    refresh();
    syncActive();
    onUnmounted(() => {
      window.removeEventListener("scroll", syncActive, true);
      window.removeEventListener("mousemove", onDragMove);
      window.removeEventListener("mouseup", onDragEnd);
      window.removeEventListener("touchmove", onDragMove);
      window.removeEventListener("touchend", onDragEnd);
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    });
    return () => {
      if (available.value.size === 0) return null;
      const sections = NAV_SECTIONS.map((section) => ({ section, items: section.items.filter((item) => available.value.has(item.header)) })).filter((entry) => entry.items.length > 0);
      return h(
        "div",
        { class: ["dsh-nav", collapsed.value && "is-collapsed"], style: { top: `${origin.value.top}px`, right: `${origin.value.right}px` } },
        [
          h("div", { class: "dsh-nav-header", onMousedown: onDragStart, onTouchstart: onDragStart }, [
            h("span", { class: "dsh-nav-title" }, "配置导航"),
            h(
              "button",
              {
                class: "dsh-nav-toggle",
                type: "button",
                title: collapsed.value ? "展开" : "收起",
                onClick: () => {
                  collapsed.value = !collapsed.value;
                }
              },
              collapsed.value ? "▸" : "▾"
            )
          ]),
          h("div", { class: "dsh-nav-body" }, sections.flatMap(({ section, items }) => [
            h("div", { class: "dsh-nav-section" }, section.title),
            ...items.map(
              (item) => h(
                "div",
                { class: ["dsh-nav-item", active.value === item.label && "is-active"], onClick: () => jump(item) },
                item.label
              )
            )
          ]))
        ]
      );
    };
  }
});
var ConfigNavLoader = defineComponent({
  name: "DshConnectorConfigNavLoader",
  setup() {
    const pluginName = inject("plugin:name");
    return () => pluginName?.value === PLUGIN_NAME ? h(ConfigNav) : null;
  }
});
function apply(ctx) {
  ctx.slot({ type: "plugin-details", component: ConfigNavLoader, order: -997 });
}
export {
  apply as default
};
