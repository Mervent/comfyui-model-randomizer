import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const WIDGETS_PER_ENTRY = 6; // header, ckpt, cfg_min, cfg_max, weight, enabled
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

function drawSmallButton(ctx, x, y, w, h, label, isPressed, disabled, colors) {
    const radius = 3;
    const lowQ = isLowQuality();

    const c = colors || {};
    const bgColor = c.bg || "#4a4a4a";
    const pressedColor = c.pressed || "#3a3a3a";
    const borderColor = c.border || "#666";
    const textColor = c.text || "#ddd";
    const textPressedColor = c.textPressed || "#ccc";
    const disabledBg = c.disabledBg || "#2a2a2a";
    const disabledBorder = c.disabledBorder || "#3a3a3a";
    const disabledText = c.disabledText || "#555";

    if (disabled) {
        drawRoundedRect(ctx, x, y, w, h, radius, disabledBg, lowQ ? null : disabledBorder);
        if (!lowQ) {
            ctx.save();
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = disabledText;
            ctx.font = "11px Arial";
            ctx.fillText(label, x + w / 2, y + h / 2);
            ctx.restore();
        }
        return;
    }

    if (!lowQ && !isPressed) {
        drawRoundedRect(ctx, x + 0.5, y + 0.5, w, h, radius, "#00000033");
    }

    const offsetY = isPressed ? 1 : 0;
    drawRoundedRect(
        ctx, x, y + offsetY, w, h, radius,
        isPressed ? pressedColor : bgColor,
        lowQ ? null : borderColor
    );

    if (lowQ) return;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = isPressed ? textPressedColor : textColor;
    ctx.font = "11px Arial";
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

function createEntryHeaderWidget(index, onMoveUp, onMoveDown, onDelete) {
    return {
        name: `header_${index}`,
        type: "custom",
        value: "",
        y: 0,
        last_y: 0,
        options: { serialize: false },
        _entryIndex: index,
        _upPressed: false,
        _downPressed: false,
        _deletePressed: false,
        _upBounds: null,
        _downBounds: null,
        _deleteBounds: null,
        _mouseDownTarget: null,

        draw(ctx, node, width, y, height) {
            this.last_y = y;
            const margin = 15;
            const lowQ = isLowQuality();

            // Top divider line
            if (!lowQ) {
                ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(margin, y + 4);
                ctx.lineTo(width - margin, y + 4);
                ctx.stroke();
            }

            if (lowQ) return;

            // Vertical center for label and buttons (shifted down past divider)
            const centerY = y + height * 0.5 + 4;

            // Label
            ctx.save();
            ctx.fillStyle = "#999";
            ctx.font = "11px Arial";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(`Model ${this._entryIndex}`, margin + 2, centerY);
            ctx.restore();

            // Button layout (right-aligned): [▲] [▼]  [✕]
            const btnH = 16;
            const btnW = 20;
            const btnGap = 4;
            const deleteSeparation = 10;
            const btnY = centerY - btnH / 2;

            const isFirst = this._entryIndex === 1;
            const isLast = this._entryIndex === node._modelCount;
            const isOnly = node._modelCount <= 1;

            const deleteColors = {
                bg: "#5a2a2a",
                pressed: "#4a1a1a",
                border: "#8a3a3a",
                text: "#e66",
                textPressed: "#c55",
            };

            // ✕ Delete (rightmost)
            const delX = width - margin - btnW;
            this._deleteBounds = [delX, btnY, btnW, btnH];
            drawSmallButton(ctx, delX, btnY, btnW, btnH, "\u2715", this._deletePressed, isOnly, deleteColors);

            // ▼ Move Down
            const downX = delX - btnW - deleteSeparation;
            this._downBounds = [downX, btnY, btnW, btnH];
            drawSmallButton(ctx, downX, btnY, btnW, btnH, "\u25BC", this._downPressed, isLast);

            // ▲ Move Up
            const upX = downX - btnW - btnGap;
            this._upBounds = [upX, btnY, btnW, btnH];
            drawSmallButton(ctx, upX, btnY, btnW, btnH, "\u25B2", this._upPressed, isFirst);
        },

        _hitTest(pos) {
            const tests = [
                ["up", this._upBounds],
                ["down", this._downBounds],
                ["delete", this._deleteBounds],
            ];
            for (const [name, bounds] of tests) {
                if (bounds &&
                    pos[0] >= bounds[0] && pos[0] <= bounds[0] + bounds[2] &&
                    pos[1] >= bounds[1] && pos[1] <= bounds[1] + bounds[3]) {
                    return name;
                }
            }
            return null;
        },

        _isDisabled(target, node) {
            if (target === "up") return this._entryIndex === 1;
            if (target === "down") return this._entryIndex === node._modelCount;
            if (target === "delete") return node._modelCount <= 1;
            return false;
        },

        mouse(event, pos, node) {
            if (event.type === "pointerdown") {
                const target = this._hitTest(pos);
                if (!target || this._isDisabled(target, node)) return false;
                this._mouseDownTarget = target;
                if (target === "up") this._upPressed = true;
                if (target === "down") this._downPressed = true;
                if (target === "delete") this._deletePressed = true;
                app.graph.setDirtyCanvas(true, false);
                return true;
            }

            if (event.type === "pointerup") {
                const wasTarget = this._mouseDownTarget;
                this._upPressed = false;
                this._downPressed = false;
                this._deletePressed = false;
                this._mouseDownTarget = null;
                app.graph.setDirtyCanvas(true, false);
                if (!wasTarget) return false;

                const target = this._hitTest(pos);
                if (target === wasTarget && !this._isDisabled(target, node)) {
                    if (target === "up") onMoveUp.call(node, this._entryIndex);
                    if (target === "down") onMoveDown.call(node, this._entryIndex);
                    if (target === "delete") onDelete.call(node, this._entryIndex);
                }
                return true;
            }

            if (event.type === "pointermove") {
                if (!this._mouseDownTarget) return false;
                const target = this._hitTest(pos);
                this._upPressed = (this._mouseDownTarget === "up" && target === "up");
                this._downPressed = (this._mouseDownTarget === "down" && target === "down");
                this._deletePressed = (this._mouseDownTarget === "delete" && target === "delete");
                app.graph.setDirtyCanvas(true, false);
                return true;
            }

            return false;
        },

        computeSize(width) {
            return [width, LiteGraph.NODE_WIDGET_HEIGHT + 12];
        },

        serializeValue() { return null; },
    };
}

function createAddButtonWidget(addCallback) {
    return {
        name: "model_actions",
        type: "custom",
        value: "",
        y: 0,
        last_y: 0,
        options: { serialize: false },
        _pressed: false,
        _bounds: null,
        _mouseDown: false,

        draw(ctx, node, width, y, height) {
            this.last_y = y;
            const margin = 15;
            const w = width - margin * 2;
            this._bounds = [margin, y, w, height];

            drawStyledButton(ctx, margin, y, w, height,
                "\u2795 Add Model", this._pressed,
                { bg: "#2a4a2a", pressed: "#1a3a1a", border: "#3a6a3a", text: "#9fcf9f" });
        },

        _isInside(pos) {
            const b = this._bounds;
            return b && pos[0] >= b[0] && pos[0] <= b[0] + b[2] &&
                pos[1] >= b[1] && pos[1] <= b[1] + b[3];
        },

        mouse(event, pos, node) {
            if (event.type === "pointerdown") {
                if (!this._isInside(pos)) return false;
                this._mouseDown = true;
                this._pressed = true;
                app.graph.setDirtyCanvas(true, false);
                return true;
            }

            if (event.type === "pointerup") {
                const wasDown = this._mouseDown;
                this._pressed = false;
                this._mouseDown = false;
                app.graph.setDirtyCanvas(true, false);
                if (!wasDown) return false;
                if (this._isInside(pos)) addCallback.call(node);
                return true;
            }

            if (event.type === "pointermove") {
                if (!this._mouseDown) return false;
                this._pressed = this._isInside(pos);
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

// ── Entry Manipulation ─────────────────────────────────────────────

function swapModelEntries(node, idxA, idxB) {
    const fields = ["ckpt", "cfg_min", "cfg_max", "weight", "enabled"];
    for (const field of fields) {
        const wA = node.widgets.find((w) => w.name === `${field}_${idxA}`);
        const wB = node.widgets.find((w) => w.name === `${field}_${idxB}`);
        if (wA && wB) {
            const tmp = wA.value;
            wA.value = wB.value;
            wB.value = tmp;
        }
    }
}

function removeModelEntryAt(node, targetIndex) {
    if (node._modelCount <= 1) return false;

    const prefixes = ["header", "ckpt", "cfg_min", "cfg_max", "weight", "enabled"];

    for (const prefix of prefixes) {
        const idx = node.widgets.findIndex((w) => w.name === `${prefix}_${targetIndex}`);
        if (idx >= 0) node.widgets.splice(idx, 1);
    }

    for (let i = targetIndex + 1; i <= node._modelCount; i++) {
        const newIdx = i - 1;
        for (const prefix of prefixes) {
            const w = node.widgets.find((w) => w.name === `${prefix}_${i}`);
            if (w) {
                w.name = `${prefix}_${newIdx}`;
                if (prefix === "header") {
                    w._entryIndex = newIdx;
                }
            }
        }
    }

    node._modelCount--;
    node.properties = node.properties || {};
    node.properties.modelCount = node._modelCount;

    return true;
}

// ── Entry Action Callbacks (called with `this` = node) ─────────────

function handleMoveUp(entryIndex) {
    if (entryIndex <= 1) return;
    swapModelEntries(this, entryIndex, entryIndex - 1);
    app.graph.setDirtyCanvas(true, true);
}

function handleMoveDown(entryIndex) {
    if (entryIndex >= this._modelCount) return;
    swapModelEntries(this, entryIndex, entryIndex + 1);
    app.graph.setDirtyCanvas(true, true);
}

function handleDeleteEntry(entryIndex) {
    if (removeModelEntryAt(this, entryIndex)) {
        resizeNodeToFit(this);
        app.graph.setDirtyCanvas(true, true);
    }
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

    newWidgets.push(
        node.addCustomWidget(
            createEntryHeaderWidget(index, handleMoveUp, handleMoveDown, handleDeleteEntry)
        )
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
            this.addCustomWidget(createAddButtonWidget(
                // Add Model callback
                async function () {
                    const freshCheckpoints = await fetchCheckpoints(true);
                    this._modelCount++;
                    addModelEntry(this, this._modelCount, freshCheckpoints);
                    this.properties = this.properties || {};
                    this.properties.modelCount = this._modelCount;
                    resizeNodeToFit(this);
                    app.graph.setDirtyCanvas(true, true);
                }
            ));

            // Default first entry
            this._modelCount++;
            addModelEntry(this, this._modelCount, checkpoints);
            this.properties = this.properties || {};
            this.properties.modelCount = this._modelCount;
            this.setSize(this.computeSize());
        };

        const origOnSerialize = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function (o) {
            origOnSerialize?.apply(this, arguments);
            const entries = [];
            for (let i = 1; i <= this._modelCount; i++) {
                entries.push({
                    ckpt: this.widgets.find(w => w.name === `ckpt_${i}`)?.value,
                    cfg_min: this.widgets.find(w => w.name === `cfg_min_${i}`)?.value,
                    cfg_max: this.widgets.find(w => w.name === `cfg_max_${i}`)?.value,
                    weight: this.widgets.find(w => w.name === `weight_${i}`)?.value,
                    enabled: this.widgets.find(w => w.name === `enabled_${i}`)?.value,
                });
            }
            o.properties = o.properties || {};
            o.properties.modelEntries = entries;
            o.properties.modelCount = this._modelCount;
        };

        const origConfigure = nodeType.prototype.configure;
        nodeType.prototype.configure = function (info) {
            // Nuke model widgets BEFORE super.configure so LiteGraph's
            // widgets_values restoration has nothing to mismatch against.
            // Includes both header_ (current) and sep_ (legacy) prefixes.
            for (let i = this.widgets.length - 1; i >= 0; i--) {
                const n = this.widgets[i]?.name;
                if (n && (n.startsWith("header_") || n.startsWith("sep_") ||
                    n.startsWith("ckpt_") || n.startsWith("cfg_min_") ||
                    n.startsWith("cfg_max_") || n.startsWith("weight_") ||
                    n.startsWith("enabled_"))) {
                    this.widgets.splice(i, 1);
                }
            }
            this._modelCount = 0;

            origConfigure?.apply(this, arguments);

            const entries = info.properties?.modelEntries || [];
            const savedCount = entries.length || info.properties?.modelCount || 0;

            for (let i = 0; i < savedCount; i++) {
                this._modelCount++;
                addModelEntry(this, this._modelCount, checkpoints, entries[i]);
            }

            resizeNodeToFit(this);
            app.graph.setDirtyCanvas(true, true);
        };
    },
});
