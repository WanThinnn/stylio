"""Offline transfer tests: resume, validation and bounded storage."""

import csv
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from adaptive_styles.unsplash import download_photos, image_url, select_photos


class Response(io.BytesIO):
    def __init__(self, body, known_length=True):
        super().__init__(body)
        self.headers = {"Content-Length": str(len(body))} if known_length else {}


class UnsplashTests(unittest.TestCase):
    def setUp(self):
        test_root = Path(__file__).resolve().parents[1] / "outputs/test-temp"
        test_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=test_root)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        buffer = io.BytesIO()
        Image.new("RGB", (40, 20), "blue").save(buffer, format="JPEG")
        self.jpeg = buffer.getvalue()
        self.rows = [{"photo_id": str(i), "photo_image_url": f"https://images.unsplash.com/photo-{i}"} for i in range(3)]

    def run_download(self, rows=None, **kwargs):
        return download_photos(
            rows or self.rows, self.root / "images", self.root / "manifest.jsonl",
            size=1024, delay=0, progress=lambda _: None,
            opener=kwargs.pop("opener", lambda *a, **k: Response(self.jpeg)), **kwargs)

    def test_url_preserves_frame_and_uses_jpeg(self):
        query = parse_qs(urlsplit(image_url("https://images.unsplash.com/photo-1?crop=faces&sat=50", 1024)).query)
        self.assertEqual(query["fit"], ["max"])
        self.assertEqual(query["fm"], ["jpg"])
        self.assertEqual(query["w"], ["1024"])
        self.assertNotIn("sat", query)
        with self.assertRaises(ValueError):
            image_url("https://other.example/photo.jpg", 1024)

    def test_resume_and_provenance(self):
        self.assertEqual(self.run_download()["downloaded"], 3)
        def no_network(*a, **k):
            raise AssertionError("Cached files must not be downloaded again")
        result = self.run_download(opener=no_network)
        self.assertEqual(result["already_present"], 3)
        records = [json.loads(line) for line in (self.root / "manifest.jsonl").read_text().splitlines() if line]
        self.assertEqual(len(records), 3)
        self.assertTrue(all(record["sha256"] and record["width"] == 40 for record in records))

    def test_known_length_storage_budget(self):
        result = self.run_download(max_bytes=len(self.jpeg) + 10)
        self.assertEqual(result["downloaded"], 1)
        self.assertEqual(result["stop_reason"], "storage_budget")
        self.assertLessEqual(result["bytes_on_disk"], len(self.jpeg) + 10)
        self.assertFalse(list((self.root / "images").glob("*.part")))

    def test_unknown_length_storage_budget(self):
        result = self.run_download(max_bytes=10, opener=lambda *a, **k: Response(self.jpeg, False))
        self.assertEqual(result["downloaded"], 0)
        self.assertEqual(result["stop_reason"], "storage_budget")
        self.assertFalse(list((self.root / "images").iterdir()))

    def test_invalid_response_never_becomes_jpeg(self):
        result = self.run_download(opener=lambda *a, **k: Response(b"not an image"))
        self.assertEqual(result["failed"], 3)
        self.assertFalse(list((self.root / "images").iterdir()))

    def test_existing_invalid_file_is_preserved(self):
        folder = self.root / "images"
        folder.mkdir()
        (folder / "0.jpg").write_bytes(b"keep me")
        result = self.run_download(rows=self.rows[:1])
        self.assertEqual(result["failed"], 1)
        self.assertEqual((folder / "0.jpg").read_bytes(), b"keep me")

    def test_rate_limit_stops_without_looping(self):
        calls = []
        def limited(request, **kwargs):
            calls.append(request)
            raise HTTPError(request.full_url, 429, "rate limited", {}, None)
        result = self.run_download(opener=limited)
        self.assertEqual(len(calls), 1)
        self.assertEqual(result["stop_reason"], "http_429")

    def test_deterministic_selection_and_iphone_filter(self):
        source = self.root / "photos.tsv000"
        with source.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=["photo_id", "photo_image_url", "exif_camera_model"], delimiter="\t")
            writer.writeheader()
            for i, row in enumerate(self.rows):
                writer.writerow({**row, "exif_camera_model": "iPhone 15" if i == 0 else "Other"})
            writer.writerow({"photo_id": "bad-url", "photo_image_url": "https://images.unsplash.company", "exif_camera_model": "Other"})
        self.assertEqual(select_photos(source, 2), select_photos(source, 2))
        self.assertEqual(len(select_photos(source, 100)), 3)
        self.assertEqual(len(select_photos(source, 100, iphone_only=True)), 1)
        with self.assertRaises(ValueError):
            select_photos(source, 0)


if __name__ == "__main__":
    unittest.main()
