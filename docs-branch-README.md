# docs 分支说明（文档专用分支）

这个分支用于**沉淀工程文档与技术文章**，与博客主线（`main`）保持同步：

## 工作方式

1. 文章仍然放在 `src/content/blog/` 下（与 `main` 一致的结构），这样合并回 `main` 即可发布；
2. 平时在 `docs` 分支写作、修改；
3. **每次开始写作前先同步主线**：

```bash
git fetch origin main
git rebase origin/main      # 或 git merge origin/main
```

4. 需要发布时，把 `docs` 合并回 `main`（或开 PR 让 CI 构建预览）。

## 为什么单独开分支

- `main` 的每次推送都会触发 GitHub Pages 部署；文档还在打磨时不必反复部署；
- 文档改动与站点改动分离，回滚更清晰。

## 注意

- 不要在这个分支上改动站点配置（`astro.config.*`、`src/config/` 等），除非确实需要；
  这类改动请直接提到 `main`，避免两边冲突。
