"""Command-line stages and an end-to-end baseline runner."""

import argparse
import json
from pathlib import Path


def main(workspace):
    root = Path(workspace).resolve()
    config = json.loads((root/"configs/baseline.json").read_text(encoding="utf-8"))
    defaults = config["training"]
    parser = argparse.ArgumentParser(description="Stylio mobile Adaptive Styles training")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "label", "review", "train", "run", "evaluate", "export", "predict"):
        command = sub.add_parser(name)
        if name in ("prepare", "label", "review", "train", "run", "evaluate"):
            command.add_argument("--data", type=Path, default=root/config["prepared_dataset"])
        if name in ("prepare", "run"): command.add_argument("--max-images", type=int)
        if name in ("label", "train", "run", "evaluate", "predict"):
            command.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
        if name in ("label", "train", "run"):
            command.add_argument("--batch-size", type=int, default=defaults["batch_size"])
        if name in ("train", "run"):
            command.add_argument("--run", type=Path, default=root/config["run_directory"])
            command.add_argument("--epochs", type=int, default=defaults["epochs"])
            command.add_argument("--accumulation", type=int, default=defaults["gradient_accumulation"])
            command.add_argument("--learning-rate", type=float, default=defaults["learning_rate"])
            command.add_argument("--warmup-epochs", type=int, default=defaults["warmup_epochs"])
            command.add_argument("--resume", type=Path)
            command.add_argument("--overrides", type=Path)
            command.add_argument("--max-batches", type=int, help="Smoke testing only; caps training batches per epoch")
            command.add_argument("--no-pretrained", action="store_true", help="Smoke testing only; random student backbone")
        if name == "review":
            command.add_argument("--output", type=Path, default=root/"outputs/label-review")
            command.add_argument("--limit", type=int, default=50)
        if name in ("evaluate", "export", "predict"): command.add_argument("--checkpoint", type=Path, required=True)
        if name == "evaluate":
            command.add_argument("--split", choices=("validation", "test"), default="validation")
            command.add_argument("--overrides", type=Path)
        if name == "export": command.add_argument("--output", type=Path, default=root/"exports/baseline-v1")
        if name == "predict": command.add_argument("--image", type=Path, required=True)
    args = parser.parse_args()
    if hasattr(args, "batch_size") and args.batch_size < 1: parser.error("batch-size must be positive")
    if hasattr(args, "max_images") and args.max_images is not None and args.max_images < 10:
        parser.error("max-images must be at least 10")
    if hasattr(args, "max_batches") and args.max_batches is not None and args.max_batches < 1:
        parser.error("max-batches must be positive")
    if hasattr(args, "limit") and args.limit < 1: parser.error("limit must be positive")
    if args.command in ("prepare", "run"):
        from adaptive_styles.prepare import prepare
        if args.command == "prepare" or not (args.data/"manifest.json").exists():
            prepare(root, args.data, limit=args.max_images, seed=config["seed"])
        else: print("Reusing frozen prepared dataset; --max-images is ignored.", flush=True)
    if args.command in ("label", "run"):
        from adaptive_styles.label import label
        label(root, args.data, device=args.device, batch_size=args.batch_size)
    if args.command == "review":
        from adaptive_styles.review import review
        review(root, args.data, args.output, args.limit)
    if args.command in ("train", "run"):
        from adaptive_styles.training import train
        resume = args.resume
        if args.command == "run" and not resume and (args.run/"last.pt").exists(): resume = args.run/"last.pt"
        train(root, args.data, args.run, epochs=args.epochs, batch_size=args.batch_size,
              accumulation=args.accumulation, learning_rate=args.learning_rate,
              warmup_epochs=args.warmup_epochs, device=args.device, resume=resume,
              overrides=args.overrides, max_batches=args.max_batches, pretrained=not args.no_pretrained)
    if args.command == "evaluate":
        from adaptive_styles.training import evaluate
        print(json.dumps(evaluate(args.checkpoint, args.data, args.split, args.overrides, args.device), indent=2))
    if args.command == "predict":
        from adaptive_styles.training import predict
        print(json.dumps(predict(args.checkpoint, args.image, args.device), indent=2))
    if args.command == "export":
        from adaptive_styles.export import export_onnx
        export_onnx(args.checkpoint, args.output)
