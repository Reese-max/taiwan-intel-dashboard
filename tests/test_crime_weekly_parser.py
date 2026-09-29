"""Network-free checks for the weekly police ZIP resource lookup."""

import importlib.util
import pathlib
import unittest
import urllib.error
from unittest.mock import patch


SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "lib" / "parse-crime-weekly.py"
SPEC = importlib.util.spec_from_file_location("crime_weekly_parser", SCRIPT)
parser = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(parser)


class CrimeWeeklyDownloadTests(unittest.TestCase):
    def test_discovers_only_this_dataset_official_resource(self):
        current = parser.ZIP_URL.replace("2135CF37-2C60-494B-9286-C5AA44A7A957", "12345678-1234-1234-1234-123456789ABC")
        page = f'<a href="https://other.example/download">other</a><a href="{current}">ZIP</a>'
        with patch.object(parser, "fetch_bytes", return_value=page.encode()):
            self.assertEqual(parser.discover_zip_url(), current)

    def test_retries_transient_502_and_uses_current_resource(self):
        current = parser.ZIP_URL.replace("2135CF37-2C60-494B-9286-C5AA44A7A957", "12345678-1234-1234-1234-123456789ABC")
        bad_gateway = urllib.error.HTTPError(current, 502, "Bad Gateway", {}, None)
        with patch.object(parser, "discover_zip_url", return_value=current), patch.object(
            parser, "fetch_bytes", side_effect=[bad_gateway, bad_gateway, b"PK\x03\x04archive"]
        ) as fetch, patch.object(parser.time, "sleep") as sleep:
            self.assertEqual(parser.download_zip(), b"PK\x03\x04archive")
        self.assertEqual([call.args[0] for call in fetch.call_args_list], [current] * 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [1, 2])

    def test_portal_failure_uses_last_verified_link(self):
        with patch.object(parser, "discover_zip_url", side_effect=OSError("portal unavailable")), patch.object(
            parser, "fetch_bytes", return_value=b"PK\x03\x04archive"
        ) as fetch:
            self.assertEqual(parser.download_zip(), b"PK\x03\x04archive")
        fetch.assert_called_once()
        self.assertEqual(fetch.call_args.args[0], parser.ZIP_URL)

    def test_rejects_non_zip_response(self):
        with patch.object(parser, "discover_zip_url", return_value=parser.ZIP_URL), patch.object(
            parser, "fetch_bytes", return_value=b"<html>blocked</html>"
        ):
            with self.assertRaisesRegex(ValueError, "not a ZIP"):
                parser.download_zip()


if __name__ == "__main__":
    unittest.main()
