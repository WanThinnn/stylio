"""Export the isolated research student and verify ONNX Runtime numerical parity."""

import hashlib
import json
import inspect
from pathlib import Path

import numpy as np
import torch

from adaptive_styles.model import MEAN, STD
from adaptive_styles.training import load_student


def export_onnx(checkpoint, output):
    import onnx
    import onnxruntime as ort
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    model, state = load_student(checkpoint)
    torch.manual_seed(42)
    inputs = torch.randn(2,3,224,224)
    model_path = output/"adaptive-styles.onnx"
    export_options = {"dynamo": False} if "dynamo" in inspect.signature(torch.onnx.export).parameters else {}
    torch.onnx.export(model, inputs, str(model_path), input_names=["pixel_values"],
                      output_names=["style_logits", "style_parameters"], opset_version=17,
                      dynamic_axes={name: {0: "batch"} for name in ("pixel_values", "style_logits", "style_parameters")}, **export_options)
    onnx.checker.check_model(onnx.load(model_path))
    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    with torch.inference_mode(): expected = [value.numpy() for value in model(inputs)]
    actual = session.run(None, {"pixel_values": inputs.numpy()})
    errors = [float(np.max(np.abs(a-b))) for a,b in zip(expected, actual)]
    if max(errors) > 1e-4: raise ValueError(f"ONNX parity failed: {errors}")
    # Verify dynamic batch=1 as required by mobile callers.
    if session.run(None, {"pixel_values": inputs[:1].numpy()})[0].shape != (1,len(model.style_ids)):
        raise ValueError("Unexpected ONNX output shape")
    metadata = {"schema": 1, "research_only": True, "file": model_path.name,
                "bytes": model_path.stat().st_size, "sha256": hashlib.sha256(model_path.read_bytes()).hexdigest(),
                "style_ids": model.style_ids, "contract_sha256": state["contract_sha256"],
                "data_fingerprint": state["settings"]["fingerprint"],
                "checkpoint_sha256": hashlib.sha256(Path(checkpoint).read_bytes()).hexdigest(),
                "checkpoint_epoch": state["epoch"]+1,
                "input": {"name": "pixel_values", "size": 224, "layout": "nchw-rgb", "mean": MEAN, "std": STD,
                          "resize": "PIL bicubic contain plus centered padding RGB(128,128,128)"},
                "outputs": ["style_logits", "style_parameters"], "parameter_order": ["tone", "color", "palette"],
                "selection": "argmax logits -> style_ids[index]; parameters[batch,index,:]",
                "confidence": "softmax(logits)[index]; uncalibrated teacher-label agreement only",
                "parity_max_absolute_error": errors,
                "integration": "New research contract; not a drop-in replacement for the app embedding model."}
    (output/"model.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps(metadata, indent=2), flush=True)
    return metadata
