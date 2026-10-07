"""The service account step 9 builds and runs the app as: found or made, then
given its roles.

Cloud Run uses the project's default compute service account unless told
otherwise. That account is created when the Compute Engine API is first
enabled, so a project that never enabled it has no such account; and in a
project managed by an organisation the account is created with no roles,
since the org policy iam.automaticIamGrantsForDefaultServiceAccounts withholds
the Editor role it used to get. Either way step 9 ends in PERMISSION_DENIED.

resolve(project) returns the account to use, creating one when it must:
  1. the default compute account, if it exists;
  2. else enable compute.googleapis.com, which creates it, and wait for it;
  3. else the lab's own vibestudio-runner@<project>, created here.
ensure_roles(project, sa) grants what is missing, idempotently.

Run: python scripts/runtime_account.py <project> [--check] [--dedicated]
  --check      report, grant nothing
  --dedicated  skip the default account and use vibestudio-runner (testing)
"""
from __future__ import annotations

import subprocess
import sys
import time

ROLES = ("roles/aiplatform.user", "roles/cloudbuild.builds.builder", "roles/logging.logWriter", "roles/cloudtrace.agent")
DEDICATED = "vibestudio-runner"


def _g(*args: str, timeout: int = 60) -> tuple[int, str]:
    try:
        r = subprocess.run(["gcloud", *args], capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return 1, str(e)
    return r.returncode, (r.stdout if r.returncode == 0 else r.stderr).strip()


def exists(project: str, sa: str) -> bool:
    return _g("iam", "service-accounts", "describe", sa, "--project", project, "--format=value(email)")[0] == 0


def resolve(project: str, create: bool = True, dedicated: bool = False, say=print) -> str | None:
    """The account to build and run as, or None when nothing can be found or made."""
    code, number = _g("projects", "describe", project, "--format=value(projectNumber)")
    if code != 0 or not number:
        say(f"  runtime account: cannot read project {project} ({number[:80]})"); return None
    default = f"{number}-compute@developer.gserviceaccount.com"
    if not dedicated:
        if exists(project, default):
            say(f"  runtime account: {default}"); return default
        if not create:
            say(f"  runtime account: {default} does not exist (the Compute Engine API was never enabled, or it was deleted)"); return None
        say(f"  runtime account: {default} does not exist; enabling the Compute Engine API, which creates it")
        code, out = _g("services", "enable", "compute.googleapis.com", "--project", project, "-q", timeout=240)
        if code == 0:
            for _ in range(12):
                if exists(project, default):
                    say(f"  runtime account: {default} (created with the Compute Engine API)"); return default
                time.sleep(5)
        say(f"  runtime account: still no {default}; using the lab's own account instead")
    sa = f"{DEDICATED}@{project}.iam.gserviceaccount.com"
    if exists(project, sa):
        say(f"  runtime account: {sa}"); return sa
    if not create:
        say(f"  runtime account: {sa} does not exist"); return None
    code, out = _g("iam", "service-accounts", "create", DEDICATED, "--project", project,
                   "--display-name", "Vibe Studio runtime (step 9)",
                   "--description", "builds and runs the Vibe Studio app on Cloud Run")
    if code != 0:
        say(f"  runtime account: could not create {sa}: {out[:160]}"); return None
    for _ in range(12):                              # a new account takes a moment to be bindable
        if exists(project, sa):
            break
        time.sleep(5)
    say(f"  runtime account: {sa} (created)"); return sa


def held_roles(project: str, sa: str) -> list[str]:
    code, out = _g("projects", "get-iam-policy", project, "--flatten=bindings[].members", f"--filter=bindings.members:{sa}", "--format=value(bindings.role)")
    return out.split() if code == 0 else []


def ensure_roles(project: str, sa: str, grant: bool = True, say=print) -> list[str]:
    """Grant what is missing; return the roles still missing afterwards."""
    held = held_roles(project, sa)
    if "roles/editor" in held or "roles/owner" in held:
        say(f"  roles: {sa} holds {'editor' if 'roles/editor' in held else 'owner'}, which covers step 9"); return []
    missing = [r for r in ROLES if r not in held]
    if not missing:
        say(f"  roles: {sa} has every role step 9 needs"); return []
    if not grant:
        say(f"  roles: {sa} lacks {' '.join(missing)}"); return missing
    failed = []
    for role in missing:
        for attempt in range(3):                     # a just-created account can be refused for a few seconds
            code, out = _g("projects", "add-iam-policy-binding", project, f"--member=serviceAccount:{sa}", f"--role={role}", "--condition=None", "-q")
            if code == 0:
                break
            time.sleep(4)
        else:
            failed.append(role)
    if failed:
        say(f"  roles: could not grant {' '.join(failed)} to {sa}; a project Owner runs:")
        for role in failed:
            say(f"    gcloud projects add-iam-policy-binding {project} --member=serviceAccount:{sa} --role={role}")
    granted = [r for r in missing if r not in failed]
    if granted:
        say(f"  roles: granted {' '.join(granted)} to {sa}")
    return failed


def main(argv: list[str]) -> int:
    if not argv or argv[0].startswith("-"):
        print(__doc__); return 2
    project = argv[0]; check = "--check" in argv; dedicated = "--dedicated" in argv
    sa = resolve(project, create=not check, dedicated=dedicated)
    if not sa:
        return 1
    print(f"RUNTIME_SA={sa}")
    return 1 if ensure_roles(project, sa, grant=not check) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
