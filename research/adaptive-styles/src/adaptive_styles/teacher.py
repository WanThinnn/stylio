"""Pinned CLIP ViT-B/32 + LAION aesthetic V1 teacher, used only while labeling."""

import hashlib
import os
from pathlib import Path
from urllib.request import urlopen

import numpy as np
import torch
from torch import nn
os.environ["USE_TF"] = "0"
os.environ["USE_FLAX"] = "0"
from transformers import CLIPVisionConfig, CLIPVisionModelWithProjection

CLIP_SHA = "40d365715913c9da98579312b702a82c18be219cc2a73407c4526f58eba950af"
CLIP_URL = f"https://openaipublic.azureedge.net/clip/models/{CLIP_SHA}/ViT-B-32.pt"
HEAD_REVISION = "6d122adad522ab246644d9dc1c6d7a3810ee255f"
HEAD_SHA = "c7b14cead230694acc7b9447974d3cad78003c72da032e402a303b6c2429e85f"
HEAD_URL = f"https://raw.githubusercontent.com/LAION-AI/aesthetic-predictor/{HEAD_REVISION}/sa_0_4_vit_b_32_linear.pth"
TEACHER_ID = f"clip-b32-{CLIP_SHA}:laion-v1-{HEAD_SHA}:full-frame-letterbox224"


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024*1024), b""): digest.update(block)
    return digest.hexdigest()


def fetch(url, path, expected):
    path = Path(path)
    if path.exists() and sha256_file(path) == expected:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix+".partial")
    print(f"Downloading teacher asset: {path.name}", flush=True)
    try:
        with urlopen(url, timeout=60) as response, temporary.open("wb") as stream:
            for block in iter(lambda: response.read(1024*1024), b""): stream.write(block)
        if sha256_file(temporary) != expected:
            raise ValueError(f"Checksum mismatch: {path.name}")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def converted_visual(state):
    """Map verified OpenAI visual weights into the standard Transformers model."""
    mapped = {}
    direct = {
        "conv1.weight": "vision_model.embeddings.patch_embedding.weight",
        "class_embedding": "vision_model.embeddings.class_embedding",
        "positional_embedding": "vision_model.embeddings.position_embedding.weight",
        "ln_pre.weight": "vision_model.pre_layrnorm.weight",
        "ln_pre.bias": "vision_model.pre_layrnorm.bias",
        "ln_post.weight": "vision_model.post_layernorm.weight",
        "ln_post.bias": "vision_model.post_layernorm.bias",
    }
    for old, new in direct.items(): mapped[new] = state["visual."+old]
    mapped["visual_projection.weight"] = state["visual.proj"].T
    for i in range(12):
        old, new = f"visual.transformer.resblocks.{i}.", f"vision_model.encoder.layers.{i}."
        for kind in ("weight", "bias"):
            for name, value in zip(("q", "k", "v"), state[old+f"attn.in_proj_{kind}"].chunk(3)):
                mapped[new+f"self_attn.{name}_proj.{kind}"] = value
            for source, target in (("attn.out_proj", "self_attn.out_proj"), ("ln_1", "layer_norm1"),
                                   ("ln_2", "layer_norm2"), ("mlp.c_fc", "mlp.fc1"), ("mlp.c_proj", "mlp.fc2")):
                mapped[new+target+"."+kind] = state[old+source+"."+kind]
    return mapped


class AestheticTeacher:
    def __init__(self, cache, device="cuda"):
        torch.set_num_threads(4)
        self.device = torch.device(device)
        if self.device.type == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA is unavailable. Install CUDA-enabled PyTorch, or use --device cpu.")
        clip_path = fetch(CLIP_URL, Path(cache)/"ViT-B-32.pt", CLIP_SHA)
        head_path = fetch(HEAD_URL, Path(cache)/"laion-b32-linear.pth", HEAD_SHA)
        # This TorchScript is an official OpenAI artifact verified by its published hash.
        archive = torch.jit.load(str(clip_path), map_location="cpu")
        config = CLIPVisionConfig(hidden_size=768, intermediate_size=3072, num_hidden_layers=12,
                                 num_attention_heads=12, projection_dim=512, patch_size=32,
                                 image_size=224, hidden_act="quick_gelu")
        self.encoder = CLIPVisionModelWithProjection(config)
        self.encoder.load_state_dict(converted_visual(archive.state_dict()), strict=True)
        del archive
        self.encoder.eval().requires_grad_(False).to(self.device)
        if self.device.type == "cuda": self.encoder.half()
        self.head = nn.Linear(512, 1)
        self.head.load_state_dict(torch.load(head_path, map_location="cpu", weights_only=True))
        self.head.eval().requires_grad_(False).to(self.device)
        self.mean = torch.tensor([.48145466, .4578275, .40821073], device=self.device)[None,:,None,None]
        self.std = torch.tensor([.26862954, .26130258, .27577711], device=self.device)[None,:,None,None]

    @torch.inference_mode()
    def score(self, images, batch_size=8):
        scores = []
        for start in range(0, len(images), batch_size):
            values = np.stack([np.asarray(image, dtype=np.float32)/255 for image in images[start:start+batch_size]])
            inputs = torch.from_numpy(values).permute(0,3,1,2).to(self.device)
            inputs = (inputs-self.mean)/self.std
            inputs = inputs.to(next(self.encoder.parameters()).dtype)
            embeddings = self.encoder(pixel_values=inputs).image_embeds.float()
            embeddings = torch.nn.functional.normalize(embeddings, dim=-1)
            scores.extend(self.head(embeddings).flatten().cpu().tolist())
        if not np.isfinite(scores).all(): raise ValueError("Non-finite teacher scores")
        return np.asarray(scores, dtype=np.float64)
