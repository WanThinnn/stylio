"""A single small student, with Style logits and Style-conditional parameters."""

import torch
from torch import nn
from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small

MEAN = [.485, .456, .406]
STD = [.229, .224, .225]


class StyleStudent(nn.Module):
    def __init__(self, style_ids, pretrained=True):
        super().__init__()
        backbone = mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.DEFAULT if pretrained else None)
        self.features = backbone.features
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.shared = nn.Sequential(nn.Linear(576, 128), nn.Hardswish(), nn.Dropout(.1))
        self.style_head = nn.Linear(128, len(style_ids))
        self.parameter_head = nn.Linear(128, len(style_ids)*3)
        self.style_ids = list(style_ids)
        self.register_buffer("standard_mask", torch.tensor([i == 1 for i in style_ids]))

    def forward(self, pixel_values):
        features = self.shared(self.pool(self.features(pixel_values)).flatten(1))
        raw = self.parameter_head(features).reshape(-1, len(self.style_ids), 3)
        palette = torch.where(self.standard_mask[None,:], torch.ones_like(raw[:,:,2]), raw[:,:,2].sigmoid())
        parameters = torch.stack((raw[:,:,0].tanh(), raw[:,:,1].tanh(), palette), dim=-1)
        return self.style_head(features), parameters

    def configure_backbone(self, blocks=0):
        for parameter in self.features.parameters(): parameter.requires_grad_(False)
        if blocks:
            for block in list(self.features.children())[-blocks:]:
                for parameter in block.parameters(): parameter.requires_grad_(True)

    def train(self, mode=True):
        super().train(mode)
        # Small batches: preserve pretrained BN statistics, including frozen blocks.
        self.features.eval()
        return self
