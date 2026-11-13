"""Verify the main app identity without selecting bundled resource plists."""

import argparse
import plistlib
import re
import zipfile


def verify_ipa(path, expected_identifier):
    with zipfile.ZipFile(path) as archive:
        plists = [
            entry for entry in archive.infolist()
            if re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", entry.filename)
        ]
        if len(plists) != 1:
            raise ValueError(f"Expected one main app Info.plist, found {len(plists)}")
        entry = plists[0]
        info = plistlib.loads(archive.read(entry))
        actual = info.get("CFBundleIdentifier")
        if actual != expected_identifier:
            raise ValueError(
                f"{entry.filename}: expected CFBundleIdentifier "
                f"{expected_identifier!r}, got {actual!r}"
            )
        return entry.filename


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ipa")
    parser.add_argument("expected_identifier")
    args = parser.parse_args()
    plist = verify_ipa(args.ipa, args.expected_identifier)
    print(f"Verified {plist}: CFBundleIdentifier={args.expected_identifier}")
