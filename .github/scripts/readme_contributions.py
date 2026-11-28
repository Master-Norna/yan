"""Refresh the public upstream contribution feed without touching README or main."""
import datetime
import html
import json
import os
import pathlib
import re
import textwrap
import urllib.parse
import urllib.request

ACCOUNTS = ("Master-Norna", "Agent-Yan")
OWNERS = {name.lower() for name in ACCOUNTS}
DEST = pathlib.Path("assets/readme")
SVG_HEAD = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 850 326\" role=\"img\" aria-label=\"Upstream contributions\"><style>.card{fill:#fcfbf9;stroke:#e4ded4}.project{fill:#49433d;font:600 13px Arial,sans-serif}.num{fill:#978576;font:11px Arial,sans-serif}.prtitle{fill:#48443e;font:12px Arial,sans-serif}.owner{fill:#978576;font:10px Arial,sans-serif}.fade{stop-color:#fff}.still{display:none}@media(prefers-color-scheme:dark){.card{fill:#1c2025;stroke:#383d45}.project{fill:#e5e0d9}.num,.owner{fill:#bba191}.prtitle{fill:#c7c8c9}.fade{stop-color:#0d1117}}@media(prefers-reduced-motion:reduce){.moving{display:none}.still{display:inline}}</style><defs><clipPath id=\"window\"><rect width=\"850\" height=\"326\"/></clipPath><linearGradient id=\"left\"><stop class=\"fade\" offset=\"0\" stop-opacity=\"1\"/><stop class=\"fade\" offset=\"1\" stop-opacity=\"0\"/></linearGradient><linearGradient id=\"right\"><stop class=\"fade\" offset=\"0\" stop-opacity=\"0\"/><stop class=\"fade\" offset=\"1\" stop-opacity=\"1\"/></linearGradient>"
MERGE = "<g fill=\"none\" stroke=\"#8250df\" stroke-width=\"1.55\"><circle cx=\"4\" cy=\"3\" r=\"1.75\"/><circle cx=\"4\" cy=\"13\" r=\"1.75\"/><circle cx=\"12\" cy=\"6\" r=\"1.75\"/><path d=\"M4 5v6m1-5c0 3 3 4 5 1\"/></g>"

# GitHub's public noreply addresses, not a name match. A different "Yan"
# in a commit message is not evidence of participation.
COAUTHOR_EMAILS = {
    "352840372+agent-yan@users.noreply.github.com",
    "agent-yan@users.noreply.github.com",
    "263870076+master-norna@users.noreply.github.com",
    "master-norna@users.noreply.github.com",
}
EXCLUDE_OWNERS = " -user:Master-Norna -user:Agent-Yan"
CLA = re.compile(r"^(sign the cla|cla signature)", re.I)


def api(path, **params):
    url = "https://api.github.com/" + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + os.environ["GITHUB_TOKEN"],
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def search(kind, query, date_field):
    """Exhaust indexed results, splitting dates above the API's 1,000 cap."""
    intervals = [(datetime.date(2008, 1, 1),
                  datetime.datetime.now(datetime.timezone.utc).date())]
    while intervals:
        lo, hi = intervals.pop()
        q = f"{query} {date_field}:{lo}..{hi}"
        first = api("search/" + kind, q=q, per_page=100, page=1)
        if first.get("incomplete_results"):
            raise RuntimeError("GitHub returned incomplete search results")
        total = first["total_count"]
        if total > 1000:
            if lo == hi:
                raise RuntimeError("Search result limit reached for one day")
            mid = lo + (hi - lo) // 2
            intervals.extend([(lo, mid), (mid + datetime.timedelta(days=1), hi)])
            continue
        for page in range(1, (total + 99) // 100 + 1):
            result = first if page == 1 else api(
                "search/" + kind, q=q, per_page=100, page=page)
            if result.get("incomplete_results"):
                raise RuntimeError("GitHub returned incomplete search results")
            yield from result["items"]


def external(repo):
    return repo.split("/")[0].lower() not in OWNERS


def coauthored(message):
    # Only accept exact addresses in a trailing Git trailer block, not
    # arbitrary mentions in the subject/body. GitHub compares email case
    # insensitively, and the standard trailer is case insensitive too.
    trailer = re.compile(r"^[A-Za-z][A-Za-z0-9-]*:\s*.+$")
    author = re.compile(r"^co-authored-by:\s*.+<([^<>]+)>\s*$", re.I)
    for line in reversed(message.rstrip().splitlines()):
        if not trailer.fullmatch(line):
            break
        match = author.fullmatch(line)
        if match and match.group(1).strip().lower() in COAUTHOR_EMAILS:
            return True
    return False


def credited(item):
    return ((item.get("author") or {}).get("login", "").lower() in OWNERS
            or coauthored(item["commit"]["message"]))


def pr_row(item, repo):
    merged = item.get("merged_at") or item.get("pull_request", {}).get("merged_at")
    title = " ".join(item["title"].split())
    if not merged or not external(repo) or CLA.match(title):
        return None
    if (item.get("base") or {}).get("repo", {}).get("private"):
        return None
    return {"repo": repo, "number": item["number"], "title": title,
            "url": item["html_url"], "merged": merged}


def associated_pulls(repo, sha):
    page = 1
    while True:
        result = api(f"repos/{repo}/commits/{sha}/pulls", per_page=100, page=page)
        yield from result
        if len(result) < 100:
            break
        page += 1


OVERRIDES = pathlib.Path(__file__).with_name("readme_contributions.json")
PR_LINK = re.compile(r"https://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/pull/([1-9][0-9]*)/?", re.I)
COMMIT_LINK = re.compile(r"https://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/commit/([0-9a-f]{40})/?", re.I)


def apply_overrides(found, overrides):
    # Manual inclusion is an explicit maintainer decision, not an identity match.
    # Only canonical public, merged upstream PRs are accepted for publication.
    for url in overrides["include"]:
        match = PR_LINK.fullmatch(url)
        if not match:
            raise ValueError(f"Expected a GitHub pull request URL: {url}")
        repo, number = match.groups()
        pr = api(f"repos/{repo}/pulls/{number}")
        target = (pr.get("base") or {}).get("repo") or {}
        if target.get("private") or not target.get("full_name"):
            raise ValueError(f"Expected a public upstream PR: {url}")
        row = pr_row(pr, target["full_name"])
        if not row:
            raise ValueError(f"Expected an eligible merged upstream PR: {url}")
        found[row["url"].lower()] = row
    # Exclusion wins over either source. Accept canonical PR and commit links.
    for url in overrides["exclude"]:
        if not (PR_LINK.fullmatch(url) or COMMIT_LINK.fullmatch(url)):
            raise ValueError(f"Expected a GitHub PR or commit URL: {url}")
        found.pop(url.rstrip("/").lower(), None)


def collect(overrides=None):
    found = {}
    for account in ACCOUNTS:
        for item in search("issues", f"author:{account} is:pr is:merged is:public"
                           + EXCLUDE_OWNERS, "created"):
            repo = item["repository_url"].split("/repos/", 1)[1]
            row = pr_row(item, repo)
            if row:
                found[row["url"].lower()] = row

    # GitHub commit search covers default branches. Search by primary author
    # and by trailer text independently, then verify identity and de-duplicate.
    seen = set()
    for account in ACCOUNTS:
        for query in (f"author:{account}", f'"Co-authored-by" "{account}"'):
            for item in search("commits", query + EXCLUDE_OWNERS, "committer-date"):
                repository = item["repository"]
                repo, sha = repository["full_name"], item["sha"]
                key = (repo.lower(), sha)
                if (key in seen or not external(repo) or repository.get("private")
                        or repository.get("fork") or not credited(item)):
                    continue
                seen.add(key)
                merged_pulls = []
                for pr in associated_pulls(repo, sha):
                    base = pr.get("base") or {}
                    target = (base.get("repo") or {}).get("full_name", repo)
                    if pr.get("merged_at"):
                        merged_pulls.append(pr)
                        row = pr_row(pr, target)
                        if row:
                            found[row["url"].lower()] = row
                # A default-branch commit not associated with a merged PR is
                # still a contribution; show it once, as a commit, not a PR.
                if not merged_pulls:
                    title = " ".join(item["commit"]["message"].splitlines()[0].split())
                    if not title or CLA.match(title):
                        continue
                    row = {"repo": repo, "sha": sha, "title": title,
                           "url": item["html_url"],
                           "merged": item["commit"]["committer"]["date"]}
                    found[row["url"].lower()] = row
    apply_overrides(found, overrides if overrides is not None else {"include": [], "exclude": []})
    return sorted(found.values(), key=lambda p: (p["merged"], p["url"]), reverse=True)


def reference(row):
    return f'#{row["number"]}' if "number" in row else row["sha"][:7]


COMMIT = '<g fill="none" stroke="#827969" stroke-width="1.55"><path d="M0 8h4m8 0h4"/><circle cx="8" cy="8" r="4"/></g>'


def wrap_title(title, width):
    lines = textwrap.wrap(title, width=width)
    if len(lines) > 2:
        lines = lines[:2]
        lines[1] = lines[1][:width - 1].rstrip() + "…"
    return lines


def render_svg(rows):
    parts = [SVG_HEAD]
    lengths = []
    for k in range(3):
        x = 0
        parts.append(f'<g id="strip{k}">')
        for i, p in enumerate(rows[k::3]):
            w = [265, 304, 281, 322, 290, 276][(i + 2*k) % 6]
            y = [0, 5, -3, 3, -2, 6][(i + 3*k) % 6]
            h = [86, 88, 84, 87, 89][(i + k) % 5]
            label = html.escape(f'{p["repo"]} {reference(p)} — {p["title"]}')
            mark = MERGE if "number" in p else COMMIT
            project = html.escape(p["repo"].split("/")[-1])
            parts.append(f'<g transform="translate({x} {y})"><title>{label}</title>'
                         f'<rect class="card" x=".5" y=".5" rx="6" width="{w}" height="{h}"/>'
                         f'<g transform="translate(12 11)">{mark}</g>'
                         f'<text class="project" x="34" y="23">{project}</text>'
                         f'<text class="num" x="{w-12}" y="23" text-anchor="end">{reference(p)}</text>'
                         f'<path d="M13 31H{w-13}" stroke="#b6a99a" opacity=".2"/>')
            for j, line in enumerate(wrap_title(p["title"], (w-28)//7)):
                parts.append(f'<text class="prtitle" x="13" y="{46+j*14}">{html.escape(line)}</text>')
            parts.append(f'<text class="owner" x="13" y="{h-9}">{html.escape(p["repo"].split("/")[0])}</text>')
            parts.append("</g>")
            x += w + 13
        parts.append("</g>")
        lengths.append(x)
    parts.append('</defs><g clip-path="url(#window)">')
    for k, length in enumerate(lengths):
        if not length:
            continue
        copies = "".join(f'<use xlink:href="#strip{k}" x="{i*length}"/>'
                         for i in range((962 + length - 1)//length + 2))
        parts.append(f'<g transform="translate({0} {6+k*108})">'
                     f'<g class="moving"><animateTransform attributeName="transform" type="translate" '
                     f'from="{-length if k == 1 else 0} 0" to="{0 if k == 1 else -length} 0" '
                     f'dur="{length/24:.2f}s" repeatCount="indefinite"/>{copies}</g>'
                     f'<g class="still">{copies}</g></g>')
    parts.append('</g><rect width="28" height="326" fill="url(#left)"/>'
                 '<rect x="822" width="28" height="326" fill="url(#right)"/></svg>\n')
    return "".join(parts)


def render_index(rows):
    lines = ["# Upstream contributions / 上游贡献", "",
             "Upstream contributions collected from public GitHub records and maintainer-selected PRs. / 言参与的上游贡献，自动发现与人工补录。", ""]
    for p in rows:
        title = re.sub(r"([\\\[\]<>*_])", r"\\\1", p["title"])
        lines.append(f'- [{p["repo"]} {reference(p)}]({p["url"]}) — {title}')
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    rows = collect(json.loads(OVERRIDES.read_text(encoding="utf-8")))
    if not rows:
        raise RuntimeError("Empty contribution feed; preserve the previous version")
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / "contributions.svg").write_text(render_svg(rows), encoding="utf-8")
    (DEST / "contributions.md").write_text(render_index(rows), encoding="utf-8")
