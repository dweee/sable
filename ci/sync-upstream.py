"""Maintain one checked upstream merge on the protected owner branch."""
import json
import os
from pathlib import Path
import subprocess
from urllib.request import Request, urlopen

REPO = "sable"
PREFIX = "automation/fork-sync/"
policy = json.loads(Path(".fork-ci.json").read_text())


def api(path, payload=None):
    request = Request("https://git.monke.fail/api/v1/repos/d/" + REPO + path,
                      headers={"Authorization": "token " + os.environ["TOKEN"],
                               "Content-Type": "application/json"},
                      data=None if payload is None else json.dumps(payload).encode())
    with urlopen(request, timeout=30) as response:
        body = response.read()
        return json.loads(body) if body else None


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


base = git("rev-parse", "HEAD")
pulls = api("/pulls?state=open&limit=50")
if len(pulls) >= 50:
    raise SystemExit("Review additional open PRs before syncing")
for pr in pulls:
    if pr["base"]["ref"] != "main":
        continue
    if pr["head"]["ref"].startswith(PREFIX) and pr["head"]["repo"]["full_name"] == "d/" + REPO:
        head = pr["head"]["sha"]
        git("fetch", "--no-tags", "origin", pr["head"]["ref"])
        if git("rev-parse", "FETCH_HEAD") != head or git("rev-parse", head + "^1^1") != base:
            raise SystemExit("Candidate changed or base moved; refresh required")
        status = api("/commits/" + head + "/status")
        passed = {item["context"] for item in status["statuses"] if item["status"] == "success"}
        if os.environ.get("AUTO") == "true" and status["state"] == "success" and policy["required_status"] in passed:
            api("/pulls/" + str(pr["number"]) + "/merge", {"Do": "merge", "head_commit_id": head})
        raise SystemExit(0)
    if "upstream" in pr["title"].lower():
        raise SystemExit("Waiting for existing upstream integration PR")
git("fetch", "--no-tags", policy["upstream"], policy["branch"])
upstream = git("rev-parse", "FETCH_HEAD")
if subprocess.run(["git", "merge-base", "--is-ancestor", upstream, base]).returncode == 0:
    raise SystemExit(0)
git("config", "user.name", "Forgejo upstream sync")
git("config", "user.email", "fork-sync@monke.fail")
git("merge", "--no-ff", "--no-edit", upstream)
if git("diff", "--name-only", base, "HEAD", "--", ".forgejo", ".github", "ci", ".fork-ci*", ".gitmodules"):
    raise SystemExit("Upstream changed automation paths; review required")
Path(".fork-ci/upstream-state.json").write_text(json.dumps({"last_merged_upstream": upstream}) + "\n")
git("add", ".fork-ci/upstream-state.json")
git("commit", "-m", "Record synced upstream revision")
branch = PREFIX + upstream[:12] + "-" + base[:12]
git("push", "origin", "HEAD:refs/heads/" + branch)
api("/pulls", {"title": "Sync upstream " + upstream[:12], "head": branch, "base": "main"})
