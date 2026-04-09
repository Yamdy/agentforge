---
name: git-release
description: Create consistent releases and changelogs
license: MIT
compatibility: primo-agent
metadata:
  audience: maintainers
  workflow: github
---

## What I do

- Draft release notes from merged PRs
- Propose a version bump
- Provide a copy-pasteable `gh release create` command

## How to use

1. List all merged PRs since last release
2. Categorize them by type (feat, fix, chore, docs)
3. Generate a changelog
4. Suggest a new version number
5. Create the GitHub release

## Example output

```markdown
## v1.1.0

### Features

- Add new feature X (#123)
- Improve performance of Y (#124)

### Fixes

- Fix bug in Z (#125)

### Chores

- Update dependencies (#126)
```
