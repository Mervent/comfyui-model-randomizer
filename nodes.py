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
