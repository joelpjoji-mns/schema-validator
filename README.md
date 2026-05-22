# Schema Validator Workbench

A local-first validation workbench for comparing schemas against messages/files with precise diagnostics, editor highlights, and format-specific explanations.

## Scripts

- `npm run dev` starts the Vite app.
- `npm run build:static` creates a static `dist` folder.
- `npm run lint` runs ESLint.
- `npm run typecheck` runs TypeScript project checks.
- `npm run test` runs Vitest unit/component tests.
- `npm run test:e2e` runs Playwright E2E tests.
- `npm run build` creates a production build.

## Static hosting

The validator is a client-only app. It does not require a Node API, database, account system, or upload server at runtime. Run `npm run build:static`, then host the generated `dist` folder with any static host such as GitHub Pages, Netlify, Vercel static output, S3, nginx, Apache, or an internal file server.

Vite is configured with relative asset paths, so the same `dist` output can be served from a domain root or a subfolder.

## GitHub Pages

Pushing to `main` runs `.github/workflows/deploy-pages.yml`, builds the static app, and deploys the `dist` folder through GitHub Pages. The expected project URL is:

`https://joelpjoji-mns.github.io/schema-validator/`

## Supported adapters

The app ships with focused support for JSON Schema, YAML through JSON Schema, XML with an XSD-lite rule mapper, OpenAPI examples, GraphQL SDL/operations, Protobuf JSON messages, Avro records, CSV table schemas, TOML through JSON Schema, and key-value rule schemas.
