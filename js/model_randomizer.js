import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const WIDGETS_PER_ENTRY = 5; // ckpt, cfg_min, cfg_max, weight, enabled
const NODE_CLASS = "ModelRandomizer";

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

/**
 * Adds a group of 5 widgets for one model entry at the given 1-based index.
 * Widgets are inserted before the button widgets to maintain visual order.
 */
function addModelEntry(node, index, checkpoints, defaults) {
    const ckptDefault = defaults?.ckpt ?? checkpoints[0] ?? "";
    const cfgMinDefault = defaults?.cfg_min ?? 5.0;
    const cfgMaxDefault = defaults?.cfg_max ?? 8.0;
    const weightDefault = defaults?.weight ?? 1.0;
    const enabledDefault = defaults?.enabled ?? true;

    // Find the insertion point (before the button widgets)
    const addBtnIdx = node.widgets.findIndex((w) => w.name === "add_model");

    const newWidgets = [];

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

    // Reorder: move new widgets before the buttons
    if (addBtnIdx >= 0) {
        for (let i = 0; i < newWidgets.length; i++) {
            const w = newWidgets[i];
            const currentIdx = node.widgets.indexOf(w);
            if (currentIdx >= 0) {
                node.widgets.splice(currentIdx, 1);
                node.widgets.splice(addBtnIdx + i, 0, w);
            }
        }
    }

    return newWidgets;
}

/**
 * Removes the last model entry's widgets (last WIDGETS_PER_ENTRY widgets before buttons).
 */
function removeLastModelEntry(node) {
    if (node._modelCount <= 1) return false;

    const addBtnIdx = node.widgets.findIndex((w) => w.name === "add_model");
    if (addBtnIdx < WIDGETS_PER_ENTRY) return false;

    // Remove the WIDGETS_PER_ENTRY widgets just before the buttons
    const removeStart = addBtnIdx - WIDGETS_PER_ENTRY;
    node.widgets.splice(removeStart, WIDGETS_PER_ENTRY);
    node._modelCount--;

    // Persist to properties for workflow save/load
    node.properties = node.properties || {};
    node.properties.modelCount = node._modelCount;

    return true;
}

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

            this.addWidget("button", "add_model", "Add Model", async () => {
                const freshCheckpoints = await fetchCheckpoints(true);
                this._modelCount++;
                addModelEntry(this, this._modelCount, freshCheckpoints);
                this.properties = this.properties || {};
                this.properties.modelCount = this._modelCount;
                this.setSize(this.computeSize());
                app.graph.setDirtyCanvas(true, true);
            }, { serialize: false });

            this.addWidget("button", "remove_model", "Remove Last", () => {
                if (removeLastModelEntry(this)) {
                    this.setSize(this.computeSize());
                    app.graph.setDirtyCanvas(true, true);
                }
            }, { serialize: false });

            this._modelCount++;
            addModelEntry(this, this._modelCount, checkpoints);
            this.properties = this.properties || {};
            this.properties.modelCount = this._modelCount;
            this.setSize(this.computeSize());
        };

        const origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            const savedCount = info.properties?.modelCount || 0;

            if (savedCount > 0) {
                // Remove the default entry created by onNodeCreated
                for (let i = this.widgets.length - 1; i >= 0; i--) {
                    const n = this.widgets[i]?.name;
                    if (n && (n.startsWith("ckpt_") || n.startsWith("cfg_min_") ||
                        n.startsWith("cfg_max_") || n.startsWith("weight_") ||
                        n.startsWith("enabled_"))) {
                        this.widgets.splice(i, 1);
                    }
                }
                this._modelCount = 0;

                for (let i = 0; i < savedCount; i++) {
                    this._modelCount++;
                    addModelEntry(this, this._modelCount, checkpoints);
                }
            }

            // Now let ComfyUI restore widget values by index
            origOnConfigure?.apply(this, arguments);

            this.setSize(this.computeSize());
            app.graph.setDirtyCanvas(true, true);
        };
    },
});
