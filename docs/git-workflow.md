# Git workflow

`main` is protected on GitHub: no direct pushes, no force pushes, no deletion, and every change arrives through a pull request whose **verify** check (the CI workflow) is green.

## Day to day

1. Start from an up-to-date `main`:

   ```bash
   git checkout main && git pull
   ```

2. Branch with a type prefix and a short slug, for example `feat/agreement-text`, `fix/invoice-rounding`, `docs/runbook`:

   ```bash
   git checkout -b feat/<slug>
   ```

3. Commit with Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`), one feature per commit.
4. Push the branch and open a pull request:

   ```bash
   git push -u origin feat/<slug>
   ```

   The compare page is `https://github.com/christophertrasporto/Hirewise-Connect/compare/main...feat/<slug>?expand=1`.

5. Wait for the **verify** check. It runs schema validation, migration drift detection, lint, typecheck, unit and integration tests against a Postgres container, the production build, the seed, the end-to-end suite, and a dependency audit that blocks on high severity.
6. Merge on GitHub once green. Delete the branch after merging.

## Local guard rails

Two hooks refuse commits and pushes that target `main`, so the mistake is caught before GitHub has to reject it. Install them once per clone:

```bash
npm run hooks:install
```

This points `core.hooksPath` at `scripts/git-hooks/`. The hooks are plain POSIX shell and work in Git Bash on Windows.

## When CI fails on a pull request

- Read the failing step in the Actions tab. Migration drift means `prisma/schema.prisma` changed without a migration: run `npm run db:migrate` locally and commit the new folder under `prisma/migrations/`.
- Dependency audit failures at high severity block the merge. Prefer upgrading; when the finding is transitive and a patched release exists, pin it under `overrides` in `package.json` (see the existing `postcss` and `deepmerge-ts` entries) and verify the build and the Prisma CLI still work.
- The end-to-end suite relies on the seed: Acme Solar's shortlist must be empty at the start, and the display names Jose R., Carlo D., and Maria S. must stay unique.
