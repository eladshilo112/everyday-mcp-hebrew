from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from daily_patch import validate_patch_text  # noqa: E402
from daily_preflight import discover  # noqa: E402
from timezone_guard import jerusalem_time  # noqa: E402
from validate_catalog import validate_catalog  # noqa: E402


class TimezoneTests(unittest.TestCase):
    def test_winter_utc_converts_to_0900_jerusalem(self) -> None:
        local = jerusalem_time(datetime(2026, 1, 15, 7, 0, tzinfo=timezone.utc))
        self.assertEqual((local.hour, local.minute, local.utcoffset().total_seconds()), (9, 0, 7200))

    def test_summer_utc_converts_to_0900_jerusalem(self) -> None:
        local = jerusalem_time(datetime(2026, 8, 17, 6, 0, tzinfo=timezone.utc))
        self.assertEqual((local.hour, local.minute, local.utcoffset().total_seconds()), (9, 0, 10800))


class CatalogTests(unittest.TestCase):
    def test_current_catalog_is_valid(self) -> None:
        self.assertEqual(validate_catalog(ROOT), [])


class PreflightTests(unittest.TestCase):
    def test_existing_date_is_a_noop_and_next_id_is_contiguous(self) -> None:
        result = discover(ROOT, datetime(2026, 8, 17, 6, 0, tzinfo=timezone.utc))
        self.assertEqual(result, {"date": "2026-08-17", "solution_id": "002", "should_run": "false"})

    def test_new_date_runs(self) -> None:
        result = discover(ROOT, datetime(2026, 8, 18, 6, 0, tzinfo=timezone.utc))
        self.assertEqual(result, {"date": "2026-08-18", "solution_id": "002", "should_run": "true"})


class PatchBoundaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def valid_patch(self) -> str:
        return """diff --git a/CATALOG.md b/CATALOG.md
index 1111111..2222222 100644
--- a/CATALOG.md
+++ b/CATALOG.md
@@ -1 +1,2 @@
 old
+new
diff --git a/solutions/002-water-reminder/README.md b/solutions/002-water-reminder/README.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/solutions/002-water-reminder/README.md
@@ -0,0 +1 @@
+hello
"""

    def test_accepts_only_new_solution_and_catalog(self) -> None:
        self.assertEqual(validate_patch_text(self.valid_patch(), "002", "water-reminder", self.root), [])

    def test_export_can_validate_a_solution_already_materialized_in_worktree(self) -> None:
        solution = self.root / "solutions" / "002-water-reminder"
        solution.mkdir(parents=True)
        self.assertEqual(
            validate_patch_text(
                self.valid_patch(),
                "002",
                "water-reminder",
                self.root,
                require_absent_solution=False,
            ),
            [],
        )

    def test_apply_rejects_a_solution_that_already_exists(self) -> None:
        solution = self.root / "solutions" / "002-water-reminder"
        solution.mkdir(parents=True)
        errors = validate_patch_text(self.valid_patch(), "002", "water-reminder", self.root)
        self.assertTrue(any("already exists" in error for error in errors))

    def test_rejects_workflow_change(self) -> None:
        patch = self.valid_patch() + """diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 1111111..2222222 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -1 +1 @@
-safe
+unsafe
"""
        errors = validate_patch_text(patch, "002", "water-reminder", self.root)
        self.assertTrue(any("may not change" in error for error in errors))

    def test_rejects_delete_and_symlink(self) -> None:
        delete_errors = validate_patch_text(
            self.valid_patch() + "deleted file mode 100644\n", "002", "water-reminder", self.root
        )
        self.assertTrue(any("deleted file mode" in error for error in delete_errors))
        symlink_errors = validate_patch_text(
            self.valid_patch().replace("new file mode 100644", "new file mode 120000"),
            "002",
            "water-reminder",
            self.root,
        )
        self.assertTrue(any("120000" in error for error in symlink_errors))


if __name__ == "__main__":
    unittest.main()
