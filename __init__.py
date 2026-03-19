from .nodes import ModelRandomizer

NODE_CLASS_MAPPINGS = {
    "ModelRandomizer": ModelRandomizer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ModelRandomizer": "Model Randomizer",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
