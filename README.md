# Schema Validator Workbench

A local-first validation workbench for comparing schemas against messages/files with precise diagnostics, editor highlights, and format-specific explanations.

Paste or upload a schema and message, and the workbench revalidates as either editor changes. Late validation results are ignored when newer edits have already triggered another run. The schema editor also detects common schema formats automatically and includes a Summary tab that renders a tree-style hierarchy with ordering, required/optional fields, data types, limits, descriptions, and warnings. For XSD schemas, the Sources tab lets you add or upload related `.xsd` files used by `xs:include` and `xs:import`.

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

Because the app is static and browser-only, XSD `schemaLocation` values are not fetched automatically from local paths or remote URLs. Add each related XSD in the Sources tab, set its `schemaLocation` or namespace, and validation resolves the bundle in memory.

## GitHub Pages

Pushing to `main` runs `.github/workflows/deploy-pages.yml`, builds the static app, and deploys the `dist` folder through GitHub Pages. The expected project URL is:

`https://joelpjoji-mns.github.io/schema-validator/`

## Supported adapters

The app ships with focused support for JSON Schema, YAML through JSON Schema, XML with a recursive XSD-lite rule mapper and user-supplied XSD include/import sources, OpenAPI examples, GraphQL SDL/operations, Protobuf JSON messages, Avro records, CSV table schemas, TOML through JSON Schema, and key-value rule schemas.

Schema auto-detection currently recognizes XSD, JSON Schema, OpenAPI, GraphQL SDL, Protobuf, Avro, CSV table schemas, and key-value rule schemas. You can still select formats manually when a schema is ambiguous.

See [SUPPORT_MATRIX.md](SUPPORT_MATRIX.md) for the exact coverage level and known limits of each adapter.
