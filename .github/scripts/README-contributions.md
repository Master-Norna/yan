# 贡献展示 / Contribution feed

自动收录已合并的上游 PR、公开默认分支提交以及共同署名。维护者可在 `readme_contributions.json` 的 `include` 添加言参与的已合并上游 PR URL（包括早期没有共同署名的贡献），在 `exclude` 填入不展示的 PR 或完整提交 URL。排除优先；标题和归属由 GitHub 获取，自动去重。

The feed discovers public upstream contributions automatically. Add eligible merged PR URLs to `include` for work that involved Yan but has no discoverable attribution; use `exclude` to omit PRs or commits. Exclusion wins. The job refreshes the generated assets on the separate `readme-contributions` branch.
