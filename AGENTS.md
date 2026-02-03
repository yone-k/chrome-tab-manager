# Repository Guidelines

## Project Structure & Module Organization
- Root config: `manifest.json`, `popup.html`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`.
- Source code lives in `src/popup/` (React popup UI).
  - Entry: `src/popup/main.tsx`
  - App shell: `src/popup/App.tsx`
  - Styles: `src/popup/popup.css`
  - Utilities: `src/popup/title.ts`
- Tests: `src/popup/__tests__/` (Vitest).
- Static assets: `public/icons/` (extension icons).
- Build output: `dist/`.

## Build, Test, and Development Commands
Use `pnpm` for all commands.
- `pnpm dev`: start Vite dev server for popup UI.
- `pnpm build`: typecheck then production build (`tsc && vite build`).
- `pnpm preview`: preview the production build locally.
- `pnpm test`: run unit tests with Vitest.
- `pnpm lint`: run ESLint across the repo.
- `pnpm format`: run Prettier to format files.
- `pnpm typecheck`: run TypeScript type checks only.
- `pnpm check`: lint + format + typecheck.

## Coding Style & Naming Conventions
- Prettier is the source of truth: single quotes, semicolons, trailing commas, 100-char lines.
- Indentation follows Prettier defaults (2 spaces).
- React components use PascalCase (e.g., `App.tsx`); functions/variables use camelCase.
- Keep popup UI logic in `src/popup/` and avoid cross-folder coupling.

## Development Approach (TDD)
- Follow RED → GREEN → REFACTOR strictly: write a failing test first, implement the minimum to pass, then refactor.
- Keep units small and single-responsibility; favor explicit dependencies for testability.
- Prefer co-locating new feature modules with their tests when adding new folders; existing tests live in `src/popup/__tests__/`.
- Finish with quality checks (`pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test`) before PRs.

## Testing Guidelines
- Test framework: Vitest.
- Location: `src/popup/__tests__/`.
- Naming: `*.test.ts` (e.g., `title.test.ts`).
- Run `pnpm test` before opening a PR when touching logic.

## Commit & Pull Request Guidelines
- Use Conventional Commits (e.g., `feat: add grouping UI`, `fix: handle empty title`).
- PRs must include a short summary and link related issues.
- Screenshots are recommended for UI changes but not required.
