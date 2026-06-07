import random
import folder_paths
import comfy.sd


class AnyType(str):
    """A special string type that passes ComfyUI's type-checking for dynamic inputs.
    __ne__ always returns False so any type comparison succeeds."""

    def __ne__(self, __value: object) -> bool:
        return False


class FlexibleOptionalInputType(dict):
    """Dict subclass that accepts any key for dynamic widget inputs.
    Returns a valid type tuple for any key ComfyUI's validator queries,
    allowing **kwargs in the execute function to receive dynamic widget values."""

    def __init__(self, type):
        self.type = type

    def __contains__(self, key):
        return True

    def __getitem__(self, key):
        return (self.type,)


any_type = AnyType("*")


class ModelRandomizer:
    """Loads a randomly selected checkpoint from a configurable list of models.
    Each model entry has a checkpoint, CFG range, probability weight, and enable toggle.
    Replaces the chain of Load Checkpoint + Context Big + Fast Muter + Random Unmuter."""

    _cache = {}  # Instance-level cache, set in __init__

    def __init__(self):
        self._cache = {"name": None, "result": None}

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "seed": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 0xFFFFFFFFFFFFFFFF,
                    "control_after_generate": True,
                    "tooltip": "Seed for reproducible selection. 0 = random every time.",
                }),
            },
            "optional": FlexibleOptionalInputType(any_type),
            "hidden": {},
        }

    RETURN_TYPES = ("MODEL", "CLIP", "VAE", "STRING", "FLOAT")
    RETURN_NAMES = ("MODEL", "CLIP", "VAE", "MODEL_NAME", "CFG")
    OUTPUT_TOOLTIPS = (
        "The diffusion model from the selected checkpoint.",
        "The CLIP model from the selected checkpoint.",
        "The VAE model from the selected checkpoint.",
        "Filename of the selected checkpoint.",
        "Random CFG value within the selected model's range.",
    )
    FUNCTION = "execute"
    CATEGORY = "loaders"
    DESCRIPTION = (
        "Randomly selects a checkpoint from a configurable list of models. "
        "Each entry has its own CFG range and probability weight. "
        "Outputs MODEL, CLIP, VAE, the model filename, and a random CFG value."
    )

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        for key, value in kwargs.items():
            if key.startswith("ckpt_") and isinstance(value, str) and value:
                if not folder_paths.get_full_path("checkpoints", value):
                    return f"Checkpoint not found: {value}"
        return True

    def _parse_entries(self, kwargs):
        """Parse kwargs into a list of model entry dicts, keyed by index."""
        indices = set()
        for key in kwargs:
            if key.startswith("ckpt_"):
                try:
                    idx = int(key.split("_", 1)[1])
                    indices.add(idx)
                except (ValueError, IndexError):
                    continue

        entries = []
        for idx in sorted(indices):
            ckpt = kwargs.get(f"ckpt_{idx}")
            if not ckpt:
                continue

            enabled = kwargs.get(f"enabled_{idx}", True)
            if not enabled:
                continue

            cfg_min = float(kwargs.get(f"cfg_min_{idx}", 7.0))
            cfg_max = float(kwargs.get(f"cfg_max_{idx}", 7.0))
            weight = float(kwargs.get(f"weight_{idx}", 1.0))

            if weight <= 0:
                continue

            # Swap if min > max
            if cfg_min > cfg_max:
                cfg_min, cfg_max = cfg_max, cfg_min

            entries.append({
                "ckpt": ckpt,
                "cfg_min": cfg_min,
                "cfg_max": cfg_max,
                "weight": weight,
            })

        return entries

    def _load_checkpoint(self, name):
        """Load a checkpoint, using cache if the same model was loaded last time."""
        if self._cache.get("name") != name:
            path = folder_paths.get_full_path_or_raise("checkpoints", name)
            result = comfy.sd.load_checkpoint_guess_config(
                path,
                output_vae=True,
                output_clip=True,
                embedding_directory=folder_paths.get_folder_paths("embeddings"),
            )
            self._cache["name"] = name
            self._cache["result"] = result[:3]  # (MODEL, CLIP, VAE)

        cached = self._cache["result"]
        if cached is None:
            raise RuntimeError(f"Failed to load checkpoint: {name}")
        return cached

    def execute(self, seed=0, **kwargs):
        entries = self._parse_entries(kwargs)

        if not entries:
            raise ValueError(
                "Model Randomizer: No enabled models with weight > 0. "
                "Add at least one model entry and ensure it is enabled."
            )

        # Local RNG — never touches global state
        rng = random.Random(seed) if seed != 0 else random.Random()

        # Weighted random selection
        weights = [e["weight"] for e in entries]
        selected = rng.choices(entries, weights=weights, k=1)[0]

        # Random CFG within range
        cfg_value = round(rng.uniform(selected["cfg_min"], selected["cfg_max"]), 1)

        # Load checkpoint (cached if same as last time)
        model, clip, vae = self._load_checkpoint(selected["ckpt"])

        return (model, clip, vae, selected["ckpt"], cfg_value)


class WAN22LoraRandomizer:
    """Randomly selects WAN2.2 LoRA pairs from a configurable list.
    Each entry is a high/low LoRA pair with a chance of being applied.
    Outputs two CR-compatible LORA_STACKs: one for high LoRAs, one for low.
    In exclusive mode, only one pair is selected via weighted random choice."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "seed": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 0xFFFFFFFFFFFFFFFF,
                    "control_after_generate": True,
                    "tooltip": "Seed for reproducible selection. 0 = random every time.",
                }),
                "exclusive_mode": ("BOOLEAN", {
                    "default": False,
                    "tooltip": (
                        "When enabled, only one LoRA pair is selected using "
                        "chance values as relative weights."
                    ),
                }),
            },
            "optional": FlexibleOptionalInputType(any_type),
            "hidden": {},
        }

    RETURN_TYPES = ("LORA_STACK", "LORA_STACK")
    RETURN_NAMES = ("LORA_STACK_HIGH", "LORA_STACK_LOW")
    OUTPUT_TOOLTIPS = (
        "CR-compatible LoRA stack containing the high LoRAs from selected pairs.",
        "CR-compatible LoRA stack containing the low LoRAs from selected pairs.",
    )
    FUNCTION = "execute"
    CATEGORY = "loaders"
    DESCRIPTION = (
        "Randomly selects WAN2.2 LoRA pairs from a configurable list. "
        "Each entry is a high/low pair with its own chance and strength. "
        "Outputs two CR-compatible LORA_STACKs for high and low LoRAs."
    )

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        for key, value in kwargs.items():
            if (key.startswith("lora_high_") or key.startswith("lora_low_")) \
                    and isinstance(value, str) and value and value != "None":
                if not folder_paths.get_full_path("loras", value):
                    return f"LoRA not found: {value}"
        return True

    def _parse_entries(self, kwargs):
        """Parse kwargs into a list of LoRA pair entry dicts, keyed by index."""
        indices = set()
        for key in kwargs:
            if key.startswith("lora_high_"):
                try:
                    idx = int(key.split("_", 2)[2])
                    indices.add(idx)
                except (ValueError, IndexError):
                    continue

        entries = []
        for idx in sorted(indices):
            lora_high = kwargs.get(f"lora_high_{idx}")
            lora_low = kwargs.get(f"lora_low_{idx}")

            if not lora_high or lora_high == "None":
                continue
            if not lora_low or lora_low == "None":
                continue

            enabled = kwargs.get(f"enabled_{idx}", True)
            if not enabled:
                continue

            chance = float(kwargs.get(f"chance_{idx}", 1.0))
            if chance <= 0:
                continue

            model_weight = float(kwargs.get(f"model_weight_{idx}", 1.0))
            clip_weight = float(kwargs.get(f"clip_weight_{idx}", 1.0))

            entries.append({
                "lora_high": lora_high,
                "lora_low": lora_low,
                "chance": chance,
                "model_weight": model_weight,
                "clip_weight": clip_weight,
            })

        return entries

    def execute(self, seed=0, exclusive_mode=False, **kwargs):
        entries = self._parse_entries(kwargs)

        if not entries:
            return ([], [])

        rng = random.Random(seed) if seed != 0 else random.Random()

        selected = []

        if exclusive_mode:
            # Treat chance values as relative weights, pick exactly one
            weights = [e["chance"] for e in entries]
            winner = rng.choices(entries, weights=weights, k=1)[0]
            selected.append(winner)
        else:
            # Each entry independently evaluated against its chance
            for entry in entries:
                if rng.random() < entry["chance"]:
                    selected.append(entry)

        # Build CR-compatible stacks: [(lora_name, model_weight, clip_weight), ...]
        stack_high = [
            (e["lora_high"], e["model_weight"], e["clip_weight"])
            for e in selected
        ]
        stack_low = [
            (e["lora_low"], e["model_weight"], e["clip_weight"])
            for e in selected
        ]

        return (stack_high, stack_low)
