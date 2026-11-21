"""Prepare a reproducible upstream merge and promote its exact checked PR head."""
import json
import os
import subprocess
from pathlib import Path
from urllib.request import Request, urlopen

POLICY = json.loads(Path(".fork-ci.json").read_text())
BASE = POLICY["base"]
REPO = os.environ["GITHUB_REPOSITORY"]
PREFIX = "automation/fork-sync/"


def git(*args, data=None):
    return subprocess.check_output(["git", *args], input=data, text=True).strip()


def api(path, payload=None, method=None):
    request = Request(os.environ["API_URL"] + "/repos/" + REPO + path,
                      method=method, headers={"Authorization": "token " + os.environ["TOKEN"],
                               "Content-Type": "application/json"},
                      data=None if payload is None else json.dumps(payload).encode())
    with urlopen(request, timeout=30) as response:
        body = response.read()
    return json.loads(body) if body else None


def save_json(path, value):
    blob = git("hash-object", "-w", "--stdin", data=json.dumps(value, indent=2) + "\n")
    git("update-index", "--add", "--cacheinfo", "100644", blob, path)


def checks_pass(pr, head):
    # Bind each required workflow to this PR and its current immutable commit.
    required = set(POLICY["required_workflows"])
    seen = {}
    page = 1
    while required - seen.keys():
        runs = api(f"/actions/runs?event=pull_request&limit=50&page={page}")["workflow_runs"]
        for run in runs or []:
            workflow = run["workflow_id"]
            if (workflow in required and run["event"] == "pull_request"
                    and run["commit_sha"] == head
                    and run["prettyref"] == f"#{pr['number']}"):
                seen.setdefault(workflow, run["status"])
        if len(runs or []) < 50 or runs[-1]["created"] < pr["created_at"]:
            break
        page += 1
    if required != seen.keys() or any(value != "success" for value in seen.values()):
        print("Awaiting successful PR workflows", sorted(required), seen)
        return False
    statuses = api("/commits/" + head + "/status")
    return statuses["sha"] == head and statuses["state"] == "success"


def resolve_upstream():
    git("fetch", "--no-tags", POLICY["upstream"], POLICY["branch"])
    return git("rev-parse", "FETCH_HEAD^{commit}")


def sync():
    base = git("rev-parse", "HEAD")
    upstream = resolve_upstream()
    if subprocess.run(["git", "merge-base", "--is-ancestor", upstream, base]).returncode == 0:
        print("Current at", upstream)
        return
    # Construct the candidate in Git's object database. The writer never
    # checks out the candidate or executes upstream scripts.
    tree = git("merge-tree", "--write-tree", base, upstream)
    protected = [".forgejo", ".github", ".gitea", ".gitmodules", ".gitattributes",
                 "ci", ".fork-ci", ".fork-ci.json"]
    if git("diff", "--name-only", base, tree, "--", *protected):
        raise SystemExit("Automation or control paths changed; manual integration required")
    git("read-tree", tree)
    save_json(".fork-ci/upstream-state.json", {"last_merged_upstream": upstream})
    tree = git("write-tree")
    # Stable identity makes publication retryable after a push or API failure.
    date = git("show", "-s", "--format=%cI", upstream)
    for role in ("AUTHOR", "COMMITTER"):
        os.environ.update({f"GIT_{role}_DATE": date, f"GIT_{role}_NAME": "Forgejo upstream sync",
                           f"GIT_{role}_EMAIL": "fork-sync@monke.fail"})
    head = git("commit-tree", tree, "-p", base, "-p", upstream, "-m", "Merge upstream " + upstream)
    branch = PREFIX + base[:12] + "-" + upstream[:12]
    prs = api("/pulls?state=open&limit=50")
    if len(prs) >= 50:
        raise SystemExit("Open PR inventory exceeds one page")
    stale = []
    for pr in prs:
        if pr["base"]["ref"] != BASE:
            continue
        if pr["head"]["repo"] and pr["head"]["repo"]["full_name"] == REPO and pr["head"]["ref"] == branch:
            if pr["head"]["sha"] != head:
                raise SystemExit("Candidate branch differs from computed merge")
            if os.environ["AUTO"] == "true" and checks_pass(pr, head):
                # Forgejo checks head_commit_id and fast-forward ancestry under its merge lock.
                api(f"/pulls/{pr['number']}/merge", {"Do": "fast-forward-only", "head_commit_id": head})
            return
        if (pr["head"]["repo"] and pr["head"]["repo"]["full_name"] == REPO
                and pr["head"]["ref"].startswith(PREFIX) and pr["title"].startswith("Sync upstream ")):
            stale.append(pr)
        if "upstream" in pr["title"].lower() and not pr["head"]["ref"].startswith(PREFIX):
            print("Existing upstream integration PR", pr["number"])
            return
    git("push", "origin", head + ":refs/heads/" + branch)
    pr = api("/pulls", {"title": "Sync upstream " + upstream[:12], "head": branch, "base": BASE,
                        "body": "Candidate from " + base + " and " + upstream + "."})
    print("Opened", pr["html_url"])
    for previous in stale:
        git("fetch", "--no-tags", "origin", previous["head"]["ref"])
        old = git("rev-parse", "FETCH_HEAD")
        if old != previous["head"]["sha"]:
            continue
        parents = git("show", "-s", "--format=%P", old).split()
        if len(parents) == 2 and all(subprocess.run(
                ["git", "merge-base", "--is-ancestor", parent, head]).returncode == 0
                for parent in parents):
            # Only retire our own deterministic merge, never a manually edited branch.
            subject = git("show", "-s", "--format=%s", old)
            if subject == "Merge upstream " + parents[1]:
                api(f"/pulls/{previous['number']}", {"state": "closed"}, method="PATCH")


if __name__ == "__main__":
    sync()
