"""Archive fixtures exercise the same verifier CLI used by the native job."""

from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest
import zipfile


VERIFIER = Path(__file__).with_name("verify-ios-ipa.py")
IDENTIFIER = "moe.sable.next"
MAIN = "Payload/Sable v2.app/Info.plist"


class VerifyIpaTests(unittest.TestCase):
    def verify(self, entries):
        with tempfile.TemporaryDirectory() as directory:
            ipa = Path(directory) / "Sable v2.ipa"
            with zipfile.ZipFile(ipa, "w") as archive:
                for name, value, fmt in entries:
                    archive.writestr(name, plistlib.dumps(value, fmt=fmt))
            return subprocess.run(
                [sys.executable, str(VERIFIER), str(ipa), IDENTIFIER],
                capture_output=True, text=True,
            )

    def test_selects_main_app_after_nested_resource_and_extension_plists(self):
        for fmt in (plistlib.FMT_XML, plistlib.FMT_BINARY):
            with self.subTest(format=fmt):
                result = self.verify([
                    ("Payload/Sable v2.app/app_iOS/Info.plist", {}, fmt),
                    ("Payload/Sable v2.app/Resources.bundle/Info.plist", {}, fmt),
                    ("Payload/Sable v2.app/PlugIns/Share.appex/Info.plist",
                     {"CFBundleIdentifier": IDENTIFIER + ".share"}, fmt),
                    (MAIN, {"CFBundleIdentifier": IDENTIFIER}, fmt),
                ])
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(MAIN, result.stdout)

    def test_rejects_wrong_or_missing_main_identity_even_with_matching_decoy(self):
        for info in ({}, {"CFBundleIdentifier": "moe.sable.app"}):
            with self.subTest(info=info):
                result = self.verify([
                    (MAIN, info, plistlib.FMT_BINARY),
                    ("Payload/Sable v2.app/Resources.bundle/Info.plist",
                     {"CFBundleIdentifier": IDENTIFIER}, plistlib.FMT_XML),
                ])
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("expected CFBundleIdentifier", result.stderr)

    def test_rejects_missing_or_multiple_main_app_plists(self):
        for paths in ([], [MAIN, "Payload/Other.app/Info.plist"]):
            with self.subTest(paths=paths):
                result = self.verify([
                    (path, {"CFBundleIdentifier": IDENTIFIER}, plistlib.FMT_XML)
                    for path in paths
                ])
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Expected one main app Info.plist", result.stderr)


if __name__ == "__main__":
    unittest.main()
