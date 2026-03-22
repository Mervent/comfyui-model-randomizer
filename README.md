# ComfyUI Model Randomizer

A custom node for [ComfyUI](https://github.com/comfyanonymous/ComfyUI) that randomly selects a checkpoint from a configurable list of models. Each model entry has its own CFG range, probability weight, and enable/disable toggle.

Replaces the common chain of **Load Checkpoint → Context Big → Fast Muter → Random Unmuter** with a single, self-contained node.

## Features

- **Weighted random selection** — assign probability weights to favor certain models
- **Per-model CFG range** — set a min/max CFG for each entry; a random value is picked within the range
- **Enable/disable toggle** — temporarily exclude models without removing them
- **Seed control** — use a fixed seed for reproducible selections, or `0` for fully random
- **Checkpoint caching** — skips reloading when the same model is selected consecutively
- **Drag-to-reorder** — move entries up/down with built-in buttons
- **Add/remove entries** — dynamically grow or shrink the model list

## Outputs

| Output | Description |
|---|---|
| `MODEL` | Diffusion model from the selected checkpoint |
| `CLIP` | CLIP model from the selected checkpoint |
| `VAE` | VAE model from the selected checkpoint |
| `MODEL_NAME` | Filename of the selected checkpoint |
| `CFG` | Random CFG value within the selected model's range |

## Installation

Clone into the `custom_nodes` directory:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Mervent/comfyui-model-randomizer.git
```

Restart ComfyUI. The node appears under **loaders → Model Randomizer**.

## Usage

1. Add the **Model Randomizer** node to your workflow
2. Click **Add Model** to create model entries
3. For each entry, select a checkpoint and configure:
   - **CFG Min / Max** — the range for random CFG generation
   - **Weight** — relative probability (higher = more likely to be picked)
   - **Enabled** — toggle to include/exclude from selection
4. Connect the outputs to the rest of your pipeline

Set **seed** to a non-zero value for reproducible results across runs, or leave at `0` for a fresh random pick every time.

## License

[MIT](LICENSE)
