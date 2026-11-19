<!-- 中文、英文都可以 · Chinese or English are both fine -->

## 改了什么、为什么 · What & why

<!-- 关联的 issue 写 Closes #123 · Link the issue with Closes #123 -->

## 怎么验证的 · How it was tested

## 自查 · Checklist

- [ ] `npm run unit` 与 `npm run check` 通过 · pass
- [ ] `npx --yes prettier@3.3.3 --check .` 通过（与 CI 一致）· formatting check passes (same as CI)
- [ ] 新加的界面文字已补 `i18n/en.js`（没有可勾）· new UI strings added to `i18n/en.js` (or none)
- [ ] 文档中英两份同步改了（没涉及可勾）· docs updated in both languages (or not needed)
- [ ] 改了界面的附了截图（没改可勾）· screenshots attached for UI changes (or none)
