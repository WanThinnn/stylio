"""Research entry point. Run `python train.py --help` for all stages."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT/"src"))

if __name__ == "__main__":
    from adaptive_styles.cli import main
    main(ROOT)
