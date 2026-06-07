from .nodes import ModelRandomizer, WAN22LoraRandomizer

NODE_CLASS_MAPPINGS = {
    "ModelRandomizer": ModelRandomizer,
    "WAN22LoraRandomizer": WAN22LoraRandomizer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ModelRandomizer": "Model Randomizer",
    "WAN22LoraRandomizer": "WAN2.2 LoRA Randomizer",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
