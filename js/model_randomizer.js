import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const WIDGETS_PER_ENTRY = 6; // separator, ckpt, cfg_min, cfg_max, weight, enabled
const NODE_CLASS = "ModelRandomizer";
const ANCHOR_WIDGET = "action_separator";

let cachedCheckpoints = null;

async function fetchCheckpoints(forceRefresh = false) {
    if (cachedCheckpoints && !forceRefresh) return cachedCheckpoints;
    try {
        const resp = await api.fetchApi("/models/checkpoints");
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        cachedCheckpoints = await resp.json();
    } catch (e) {
        console.warn("[ModelRandomizer] Failed to fetch checkpoints:", e);
        cachedCheckpoints = [];
    }
    return cachedCheckpoints;
}

// ── Drawing Helpers ────────────────────────────────────────────────

function isLowQuality() {
    return (app.canvas?.ds?.scale || 1) <= 0.5;
}

function drawRoundedRect(ctx, x, y, w, h, radius, fill, stroke) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, [radius]);
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

function drawStyledButton(ctx, x, y, w, h, label, isPressed, colors) {
    const radius = 4;
    const lowQ = isLowQuality();

    // Shadow
    if (!lowQ && !isPressed) {
        drawRoundedRect(ctx, x + 1, y + 1, w, h, radius, "#00000055");
    }

    // Main fill + border
    const offsetY = isPressed ? 1 : 0;
    drawRoundedRect(
        ctx, x, y + offsetY, w, h, radius,
        isPressed ? colors.pressed : colors.bg,
        lowQ ? null : colors.border
    );

    if (lowQ) return;

    // Text
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = colors.text;
    ctx.fillText(label, x + w / 2, y + h / 2 + offsetY);
    ctx.restore();
}

// ── Custom Widgets ─────────────────────────────────────────────────

function createDividerWidget(name, opts = {}) {
    const marginTop = opts.marginTop ?? 4;
    const marginBottom = opts.marginBottom ?? 4;
    const thickness = opts.thickness ?? 1;
    const color = opts.color ?? LiteGraph.WIDGET_OUTLINE_COLOR;

    return {
        name,
        type: "custom",
        value: "",
        y: 0,
        last_y: 0,
        options: { serialize: false },

        draw(ctx, node, width, y, height) {
            this.last_y = y;
            if (isLowQuality() || !thickness) return;
            const margin = 15;
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = thickness;
            ctx.beginPath();
            ctx.moveTo(margin, y + marginTop);
            ctx.lineTo(width - margin, y + marginTop);
            ctx.stroke();
            ctx.restore();
        },

        mouse() { return false; },

        computeSize(width) {
            return [width, marginTop + marginBottom + thickness];
        },

        serializeValue() { return null; },
    };
}

function createActionButtonsWidget(addCallback, removeCallback) {
    return {
        name: "model_actions",
        type: "custom",
        value: "",
        y: 0,
        last_y: 0,
        options: { serialize: false },
        _addPressed: false,
        _removePressed: false,
        _addBounds: null,
        _removeBounds: null,
        _mouseDownTarget: null,

        draw(ctx, node, width, y, height) {
            this.last_y = y;
            const margin = 15;
            const gap = 4;
            const totalW = width - margin * 2;
            const addW = Math.floor(totalW * 0.58);
            const removeW = totalW - addW - gap;

            // Store bounds for hit testing
            this._addBounds = [margin, y, addW, height];
            this._removeBounds = [margin + addW + gap, y, removeW, height];

            drawStyledButton(ctx, margin, y, addW, height,
                "\u2795 Add Model", this._addPressed,
                { bg: "#2a4a2a", pressed: "#1a3a1a", border: "#3a6a3a", text: "#9fcf9f" });

            drawStyledButton(ctx, margin + addW + gap, y, removeW, height,
                "\u2796 Remove", this._removePressed,
                { bg: "#4a2a2a", pressed: "#3a1a1a", border: "#6a3a3a", text: "#cf9f9f" });
        },

        _hitTest(pos) {
            const a = this._addBounds;
            if (a && pos[0] >= a[0] && pos[0] <= a[0] + a[2] &&
                pos[1] >= a[1] && pos[1] <= a[1] + a[3]) return "add";
            const r = this._removeBounds;
            if (r && pos[0] >= r[0] && pos[0] <= r[0] + r[2] &&
                pos[1] >= r[1] && pos[1] <= r[1] + r[3]) return "remove";
            return null;
        },

        mouse(event, pos, node) {
            if (event.type === "pointerdown") {
                const target = this._hitTest(pos);
                if (!target) return false;
                this._mouseDownTarget = target;
                if (target === "add") this._addPressed = true;
                if (target === "remove") this._removePressed = true;
                app.graph.setDirtyCanvas(true, false);
                return true;
            }

            if (event.type === "pointerup") {
                const wasTarget = this._mouseDownTarget;
                this._addPressed = false;
                this._removePressed = false;
                this._mouseDownTarget = null;
                app.graph.setDirtyCanvas(true, false);
                if (!wasTarget) return false;

                const target = this._hitTest(pos);
                if (target === wasTarget) {
                    if (target === "add") addCallback.call(node);
                    if (target === "remove") removeCallback.call(node);
                }
                return true;
            }

            if (event.type === "pointermove") {
                if (!this._mouseDownTarget) return false;
                const target = this._hitTest(pos);
                this._addPressed = (this._mouseDownTarget === "add" && target === "add");
                this._removePressed = (this._mouseDownTarget === "remove" && target === "remove");
                app.graph.setDirtyCanvas(true, false);
                return true;
            }

            return false;
        },

        computeSize(width) {
            return [width, LiteGraph.NODE_WIDGET_HEIGHT];
        },

        serializeValue() { return null; },
    };
}

// ── Resize Helper ──────────────────────────────────────────────────

function resizeNodeToFit(node) {
    const sz = node.computeSize();
    node.setSize([Math.max(node.size[0], sz[0]), sz[1]]);
}

// ── Core Widget Management ─────────────────────────────────────────

function addModelEntry(node, index, checkpoints, defaults) {
    const ckptDefault = defaults?.ckpt ?? checkpoints[0] ?? "";
    const cfgMinDefault = defaults?.cfg_min ?? 5.0;
    const cfgMaxDefault = defaults?.cfg_max ?? 8.0;
    const weightDefault = defaults?.weight ?? 1.0;
    const enabledDefault = defaults?.enabled ?? true;

    const anchorIdx = node.widgets.findIndex((w) => w.name === ANCHOR_WIDGET);

    const newWidgets = [];

    // Entry divider — visual <hr> between model groups
    newWidgets.push(
        node.addCustomWidget(createDividerWidget(`sep_${index}`))
    );

    newWidgets.push(
        node.addWidget("combo", `ckpt_${index}`, ckptDefault, () => {}, {
            values: checkpoints,
        })
    );
    newWidgets.push(
        node.addWidget("number", `cfg_min_${index}`, cfgMinDefault, () => {}, {
            min: 0.0,
            max: 100.0,
            step: 5,
            precision: 1,
        })
    );
    newWidgets.push(
        node.addWidget("number", `cfg_max_${index}`, cfgMaxDefault, () => {}, {
            min: 0.0,
            max: 100.0,
            step: 5,
            precision: 1,
        })
    );
    newWidgets.push(
        node.addWidget("number", `weight_${index}`, weightDefault, () => {}, {
            min: 0.0,
            max: 10.0,
            step: 1,
            precision: 1,
        })
    );
    newWidgets.push(
        node.addWidget("toggle", `enabled_${index}`, enabledDefault, () => {}, {})
    );

    if (anchorIdx >= 0) {
        for (let i = 0; i < newWidgets.length; i++) {
            const w = newWidgets[i];
            const currentIdx = node.widgets.indexOf(w);
            if (currentIdx >= 0) {
                node.widgets.splice(currentIdx, 1);
                node.widgets.splice(anchorIdx + i, 0, w);
            }
        }
    }

    return newWidgets;
}

function removeLastModelEntry(node) {
    if (node._modelCount <= 1) return false;

    const anchorIdx = node.widgets.findIndex((w) => w.name === ANCHOR_WIDGET);
    if (anchorIdx < WIDGETS_PER_ENTRY) return false;

    // Remove the WIDGETS_PER_ENTRY widgets just before the anchor
    const removeStart = anchorIdx - WIDGETS_PER_ENTRY;
    node.widgets.splice(removeStart, WIDGETS_PER_ENTRY);
    node._modelCount--;

    // Persist to properties for workflow save/load
    node.properties = node.properties || {};
    node.properties.modelCount = node._modelCount;

    return true;
}

// ── Extension Registration ─────────────────────────────────────────

app.registerExtension({
    name: "comfyui.ModelRandomizer",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== NODE_CLASS) return;

        const checkpoints = await fetchCheckpoints();

        // --- onNodeCreated: set up initial widgets ---
        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnNodeCreated?.apply(this, arguments);

            this._modelCount = 0;

            this.addCustomWidget(createDividerWidget(ANCHOR_WIDGET));
            this.addCustomWidget(createActionButtonsWidget(
                // Add Model callback
                async function () {
                    const freshCheckpoints = await fetchCheckpoints(true);
                    this._modelCount++;
                    addModelEntry(this, this._modelCount, freshCheckpoints);
                    this.properties = this.properties || {};
                    this.properties.modelCount = this._modelCount;
                    resizeNodeToFit(this);
                    app.graph.setDirtyCanvas(true, true);
                },
                // Remove Model callback
                function () {
                    if (removeLastModelEntry(this)) {
                        resizeNodeToFit(this);
                        app.graph.setDirtyCanvas(true, true);
                    }
                }
            ));

            // Default first entry
            this._modelCount++;
            addModelEntry(this, this._modelCount, checkpoints);
            this.properties = this.properties || {};
            this.properties.modelCount = this._modelCount;
            this.setSize(this.computeSize());
        };

        // --- onConfigure: restore from saved workflow ---
        const origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            const savedCount = info.properties?.modelCount || 0;

            if (savedCount > 0) {
                // Remove the default entry created by onNodeCreated
                for (let i = this.widgets.length - 1; i >= 0; i--) {
                    const n = this.widgets[i]?.name;
                    if (n && (n.startsWith("sep_") || n.startsWith("ckpt_") ||
                        n.startsWith("cfg_min_") || n.startsWith("cfg_max_") ||
                        n.startsWith("weight_") || n.startsWith("enabled_"))) {
                        this.widgets.splice(i, 1);
                    }
                }
                this._modelCount = 0;

                for (let i = 0; i < savedCount; i++) {
                    this._modelCount++;
                    addModelEntry(this, this._modelCount, checkpoints);
                }
            }

            // Let ComfyUI restore widget values by index
            origOnConfigure?.apply(this, arguments);

            resizeNodeToFit(this);
            app.graph.setDirtyCanvas(true, true);
        };
    },
});
