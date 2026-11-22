"""Prepare a reproducible upstream merge and promote its exact checked PR head."""
import json
import os
import subprocess
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

POLICY = json.loads(Path(".fork-ci.json").read_text())
BASE = POLICY["base"]
REPO = os.environ["GITHUB_REPOSITORY"]
PREFIX = "automation/fork-sync/"
API = "https://git.monke.fail/api/v1"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("Forgejo API redirect refused")


def git(*args, data=None):
    return subprocess.check_output(["git", *args], input=data, text=True).strip()


def api(path, payload=None, method=None):
    request = Request(API + "/repos/" + REPO + path,
                      method=method, headers={"Authorization": "token " + os.environ["TOKEN"],
                               "Content-Type": "application/json"},
                      data=None if payload is None else json.dumps(payload).encode())
    try:
        with build_opener(NoRedirect()).open(request, timeout=30) as response:
            body = response.read()
    except HTTPError as error:
        error.close()
        raise SystemExit(f"Forgejo {request.get_method()} {path}: HTTP {error.code}") from None
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
        query = urlencode({"event": "pull_request", "head_sha": head, "limit": 50, "page": page})
        runs = api("/actions/runs?" + query)["workflow_runs"]
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
    ancestry = subprocess.run(["git", "merge-base", "--is-ancestor", upstream, base])
    if ancestry.returncode == 0:
        print("Current at", upstream)
        return
    if ancestry.returncode != 1:
        ancestry.check_returncode()

    if not os.environ.get("UPDATE_TOKEN"):
        raise SystemExit("UPDATE_TOKEN is required to publish a PR that triggers Forgejo checks")
    # Construct the candidate in Git's object database. The writer never
    # checks out the candidate or executes upstream scripts.
    try:
        tree = git("merge-tree", "--write-tree", base, upstream)
    except subprocess.CalledProcessError as error:
        print(error.output, end="", flush=True)
        raise SystemExit("Upstream merge failed; manual integration required") from None
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
    prs = []
    for page in range(1, 101):
        batch = api(f"/pulls?state=open&limit=50&page={page}")
        prs.extend(batch)
        if len(batch) < 50:
            break
    else:
        raise SystemExit("Open PR inventory exceeds 100 pages")
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
                print("Merged", pr["html_url"], "at", head)
            elif os.environ["AUTO"] != "true":
                print("Awaiting manual merge for", pr["html_url"])
            return
        if (pr["head"]["repo"] and pr["head"]["repo"]["full_name"] == REPO
                and pr["head"]["ref"].startswith(PREFIX) and pr["title"].startswith("Sync upstream ")):
            stale.append(pr)
        if "upstream" in pr["title"].lower() and not pr["head"]["ref"].startswith(PREFIX):
            print("Existing upstream integration PR", pr["number"])
            return
    request = Request(API + "/user", headers={"Authorization": "token " + os.environ["TOKEN"]})
    with build_opener(NoRedirect()).open(request, timeout=30) as response:
        login = json.load(response)["login"]
    if not login or login == "forgejo-actions":
        raise SystemExit("UPDATE_TOKEN must belong to an account that can trigger PR checks")
    attribution = (f"**Posted by:** `Forgejo Actions` · **Content:** `none (no model used)` · "
                   f"**Model:** `none (no model used)` · **Account:** `{login}` · "
                   "**Evidence:** `none (no model used)` · **Role:** `report`")
    git("push", "origin", head + ":refs/heads/" + branch)
    pr = api("/pulls", {"title": "Sync upstream " + upstream[:12], "head": branch, "base": BASE,
                        "body": attribution + "\n\nCandidate from " + base + " and " + upstream + "."})
    if pr["user"]["login"] != login:
        raise SystemExit("Unexpected Forgejo PR author")
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
