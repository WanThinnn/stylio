"""Run the downloader from this workspace without installing the package itself."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from adaptive_styles.unsplash import main

if __name__ == "__main__":
    main()
