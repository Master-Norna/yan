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
SVG_HEAD = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 850 225\" role=\"img\" aria-label=\"Merged upstream pull requests\"><style>.card{fill:#fcfbf9;stroke:#e4ded4}.project{fill:#49433d;font:600 13px Arial,sans-serif}.num{fill:#978576;font:11px Arial,sans-serif}.prtitle{fill:#48443e;font:13px Arial,sans-serif}.fade{stop-color:#fff}.still{display:none}@media(prefers-color-scheme:dark){.card{fill:#1c2025;stroke:#383d45}.project{fill:#e5e0d9}.num{fill:#bba191}.prtitle{fill:#c7c8c9}.fade{stop-color:#0d1117}}@media(prefers-reduced-motion:reduce){.moving{display:none}.still{display:inline}}</style><defs><clipPath id=\"window\"><rect width=\"850\" height=\"225\"/></clipPath><linearGradient id=\"left\"><stop class=\"fade\" offset=\"0\" stop-opacity=\"1\"/><stop class=\"fade\" offset=\"1\" stop-opacity=\"0\"/></linearGradient><linearGradient id=\"right\"><stop class=\"fade\" offset=\"0\" stop-opacity=\"0\"/><stop class=\"fade\" offset=\"1\" stop-opacity=\"1\"/></linearGradient>"
MERGE = "<g fill=\"none\" stroke=\"#8250df\" stroke-width=\"1.55\"><circle cx=\"4\" cy=\"3\" r=\"1.75\"/><circle cx=\"4\" cy=\"13\" r=\"1.75\"/><circle cx=\"12\" cy=\"6\" r=\"1.75\"/><path d=\"M4 5v6m1-5c0 3 3 4 5 1\"/></g>"

def fetch(query, page):
    url = "https://api.github.com/search/issues?" + urllib.parse.urlencode(
        {"q": query, "per_page": 100, "page": page}
    )
    request = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + os.environ["GITHUB_TOKEN"],
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def collect():
    found = {}
    for account in ACCOUNTS:
        # Split the search if GitHub's 1,000-result cap would truncate it.
        start = datetime.date(2008, 1, 1)
        end = datetime.datetime.now(datetime.timezone.utc).date()
        intervals = [(start, end)]
        while intervals:
            lo, hi = intervals.pop()
            query = f"author:{account} is:pr is:merged created:{lo}..{hi}"
            first = fetch(query, 1)
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
                result = first if page == 1 else fetch(query, page)
                if result.get("incomplete_results"):
                    raise RuntimeError("GitHub returned incomplete search results")
                for item in result["items"]:
                    repo = item["repository_url"].split("/repos/", 1)[1]
                    if repo.split("/")[0].lower() in OWNERS:
                        continue
                    title = " ".join(item["title"].split())
                    if re.match(r"^(sign the cla|cla signature)", title, re.I):
                        continue
                    merged = item.get("pull_request", {}).get("merged_at")
                    if not merged:
                        continue
                    found[item["html_url"]] = {
                        "repo": repo, "number": item["number"], "title": title,
                        "url": item["html_url"], "merged": merged,
                    }
    return sorted(found.values(), key=lambda p: (p["merged"], p["url"]), reverse=True)


def wrap_title(title, width):
    lines = textwrap.wrap(title, width=width)
    if len(lines) > 2:
        lines = lines[:2]
        lines[1] = lines[1][:width - 1].rstrip() + "…"
    return lines


def render_svg(rows):
    parts = [SVG_HEAD]
    lengths = []
    for k in range(2):
        x = 0
        parts.append(f'<g id="strip{k}">')
        for i, p in enumerate(rows[k::2]):
            w = [265, 304, 281, 322, 290, 276][(i + 2*k) % 6]
            y = [0, 9, -4, 5, -2, 11][(i + 3*k) % 6]
            h = [80, 88, 83, 77, 86][(i + k) % 5]
            label = html.escape(f'{p["repo"]} #{p["number"]} — {p["title"]}')
            project = html.escape(p["repo"].split("/")[-1])
            parts.append(f'<g transform="translate({x} {y})"><title>{label}</title>'
                         f'<rect class="card" x=".5" y=".5" rx="6" width="{w}" height="{h}"/>'
                         f'<g transform="translate(12 11)">{MERGE}</g>'
                         f'<text class="project" x="34" y="23">{project}</text>'
                         f'<text class="num" x="{w-12}" y="23" text-anchor="end">#{p["number"]}</text>'
                         f'<path d="M13 33H{w-13}" stroke="#b6a99a" opacity=".2"/>')
            for j, line in enumerate(wrap_title(p["title"], (w-28)//7)):
                parts.append(f'<text class="prtitle" x="13" y="{50+j*16}">{html.escape(line)}</text>')
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
        parts.append(f'<g transform="translate({-112 if k else 0} {9+k*112})">'
                     f'<g class="moving"><animateTransform attributeName="transform" type="translate" '
                     f'from="{-length if k else 0} 0" to="{0 if k else -length} 0" '
                     f'dur="{length/24:.2f}s" repeatCount="indefinite"/>{copies}</g>'
                     f'<g class="still">{copies}</g></g>')
    parts.append('</g><rect width="28" height="225" fill="url(#left)"/>'
                 '<rect x="822" width="28" height="225" fill="url(#right)"/></svg>\n')
    return "".join(parts)


def render_index(rows):
    lines = ["# Upstream contributions / 上游贡献", "",
             "Public merged PRs from the maintainer and agent accounts. Account-level records are not proof of agent authorship. / 账号公开记录，不代表每条均由言完成。", ""]
    for p in rows:
        title = re.sub(r"([\\\[\]<>*_])", r"\\\1", p["title"])
        lines.append(f'- [{p["repo"]} #{p["number"]}]({p["url"]}) — {title}')
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    rows = collect()
    if not rows:
        raise RuntimeError("Empty contribution feed; preserve the previous version")
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / "contributions.svg").write_text(render_svg(rows), encoding="utf-8")
    (DEST / "contributions.md").write_text(render_index(rows), encoding="utf-8")
