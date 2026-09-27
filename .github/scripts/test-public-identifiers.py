#!/usr/bin/env python3
"""Exercise the public-identifier guard in disposable repositories."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("check-public-identifiers.sh").resolve()
# Build synthetic examples at runtime so the guard can scan its own fixtures.
ADDRESS = ".".join(("10", "23", "45", "67"))
TAILNET = ".".join(("example-host", "example-tailnet", "ts", "net"))


class PublicIdentifiersTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.env = os.environ.copy()
        for key in ("RANGE", "PR_TITLE", "PR_BODY", "GITHUB_EVENT_PATH"):
            self.env.pop(key, None)
        self.git("init", "--quiet")
        self.track("fixture.txt", "Safe initial content.\n")
        self.git("commit", "--quiet", "-m", "Initial fixture")
        self.base = self.git("rev-parse", "HEAD").strip()

    def git(self, *args):
        return subprocess.run(
            ["git", "-c", "user.name=Fixture", "-c",
             "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false",
             "-c", "core.hooksPath=/dev/null", *args],
            cwd=self.repo, env=self.env, text=True, capture_output=True, check=True,
        ).stdout

    def track(self, name, content):
        (self.repo / name).write_text(content)
        self.git("add", "--", name)

    def scan(self, **env):
        result = subprocess.run(
            ["bash", str(SCRIPT)], cwd=self.repo, env={**self.env, **env},
            text=True, capture_output=True,
        )
        output = result.stdout + result.stderr
        # A failure must identify a location without echoing the caught value.
        for value in (ADDRESS, TAILNET, TAILNET.upper()):
            self.assertTrue(value not in output, "A caught value reached the log")
        return result.returncode, output

    def test_all_allowed_ranges(self):
        self.track("fixture.txt", "\n".join((
            "0.0.0.0", "127.0.0.1", "192.0.2.10",
            "198.51.100.10", "203.0.113.10",
        )))
        code, output = self.scan()
        self.assertEqual(code, 0)
        self.assertIn("No deployment addresses found.", output)

    def test_ipv4_at_end_of_sentence(self):
        for suffix in ("", ".", ":8080", "/24"):
            with self.subTest(suffix=suffix):
                self.track("fixture.txt", f"Connect to {ADDRESS}{suffix}\n")
                code, output = self.scan()
                self.assertEqual(code, 1)
                self.assertIn("file fixture.txt:1", output)

    def test_case_insensitive_tailnet_in_file(self):
        for value in (TAILNET, TAILNET.upper()):
            self.track("fixture.txt", value + "\n")
            code, output = self.scan()
            self.assertEqual(code, 1)
            self.assertIn("file fixture.txt:1", output)

    def test_commit_message(self):
        self.git("commit", "--allow-empty", "--quiet", "-m", f"Connect to {ADDRESS}.")
        code, output = self.scan(RANGE=f"{self.base}..HEAD")
        self.assertEqual(code, 1)
        self.assertIn("message line 1", output)

    def test_invalid_commit_range_fails(self):
        code, output = self.scan(RANGE="missing-ref..HEAD")
        self.assertNotEqual(code, 0)
        self.assertNotIn("No deployment addresses found.", output)

    def test_local_pr_environment(self):
        code, output = self.scan(PR_TITLE=TAILNET.upper(), PR_BODY=f"Line one\n{ADDRESS}.")
        self.assertEqual(code, 1)
        self.assertIn("pull request title", output)
        self.assertIn("pull request body line 2", output)

    def test_pr_event_file(self):
        sentinel = self.repo / "must-not-exist"
        event = self.repo / "event.json"
        event.write_text(json.dumps({"pull_request": {
            "title": f"$(touch {sentinel}) {TAILNET.upper()}",
            "body": f"Line one\n{ADDRESS}.",
        }}))
        code, output = self.scan(GITHUB_EVENT_PATH=str(event))
        self.assertEqual(code, 1)
        self.assertIn("pull request title", output)
        self.assertIn("pull request body line 2", output)
        self.assertFalse(sentinel.exists(), "PR text was executed as shell code")

    def test_push_event_without_pr(self):
        event = self.repo / "event.json"
        event.write_text(json.dumps({"before": self.base}))
        code, _ = self.scan(GITHUB_EVENT_PATH=str(event))
        self.assertEqual(code, 0)

    def test_invalid_event_file_fails(self):
        event = self.repo / "event.json"
        event.write_text("{")
        code, output = self.scan(GITHUB_EVENT_PATH=str(event))
        self.assertNotEqual(code, 0)
        self.assertNotIn("No deployment addresses found.", output)


if __name__ == "__main__":
    unittest.main()
