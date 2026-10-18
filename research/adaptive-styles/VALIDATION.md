# Local pipeline verification — 2026-10-16

This is an execution check, not an aesthetic-quality benchmark.

- Device: NVIDIA GeForce RTX 3050 6 GB Laptop GPU.
- Python 3.10.8; torch 2.2.2+cu121; torchvision 0.17.2+cu121;
  NumPy 1.26.4; Pillow 12.0.0; transformers 4.57.3.
- Prepared 24 real local photos into 24 independent heuristic groups: 20 train,
  2 validation, 2 test. The test split was not evaluated.
- Scored all 55 candidates for all 24 images using the real pretrained teacher.
- Trained two epochs with two training batches per epoch, then successfully
  resumed to epochs three and four, including through the end-to-end `run` command.
- Validation teacher-label agreement was **0/2** in this tiny run. It is not a
  useful accuracy estimate and does not establish improvement over Standard.
- Student: 1,008,088 parameters. Measured PyTorch peak allocated CUDA memory was
  approximately 164.34 MiB for the batch-4 smoke training run. A separate teacher
  batch-8 check measured approximately 203.98 MiB. These figures exclude CUDA
  context/driver allocations, allocator reservation and other applications.
- Compared the mapped teacher vision encoder with the official OpenAI TorchScript
  encoder: minimum embedding cosine similarity 0.99999839, maximum aesthetic-head
  difference approximately 0.00285 in the FP16 probe.
- Exported the final epoch-four smoke checkpoint: ONNX file 4,044,069 bytes.
  Maximum PyTorch/ONNX Runtime absolute output differences were below 2e-7;
  batch sizes one and two were checked.
- Prediction, validation evaluation, contact-sheet generation and checkpoint
  loading completed. Review overrides and working-image hash changes are tested.
- All 12 research tests passed, including all 55 candidates compared byte-for-byte
  against the actual JavaScript renderer, duplicate-group split checks, a real
  optimizer update, bounded outputs and download/journal recovery behavior.
- Updated notebooks passed schema and default-execution checks without triggering
  training or downloads. `git diff --check` passed.

Generated evidence is local and ignored by Git:

```text
outputs/smoke-data-v1/
outputs/smoke-run-v1/
outputs/smoke-review-v1/index.html
exports/smoke-v1/model.json
```

The full 1,000-image / 20-epoch baseline has **not** been run. Browser/mobile latency,
human preference gains, confidence calibration, skin-tone behavior and native Apple
Photos/HDR rendering have not been validated by this smoke run. The released app
continues to use its existing model pipeline.
