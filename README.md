# Schema Validator Workbench

[![Deploy static site to GitHub Pages](https://github.com/joelpjoji-mns/schema-validator/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/joelpjoji-mns/schema-validator/actions/workflows/deploy-pages.yml)

A static, local-first schema validation workbench for JSON Schema, XSD/XML, OpenAPI, GraphQL, Protobuf, Avro, CSV, TOML, and key-value files.

**Live app:** [https://joelpjoji-mns.github.io/schema-validator/](https://joelpjoji-mns.github.io/schema-validator/)

Schema Validator Workbench gives you two focused editors: one for a schema and one for a message or sample file. Paste content, upload files, or restore a saved workspace, and the app validates continuously in the browser with precise diagnostics, source highlighting, schema summaries, message previews, and power-user tools for large validation jobs.

The app is built for the awkward real-world cases too: complex XSDs with `xs:include` and `xs:import`, noisy diagnostic lists, ambiguous file formats, repeated validation runs, and schemas big enough that you need search, pinning, history, presets, and coverage insights instead of a plain pass/fail box.

## What It Does

- Validates a schema against a message or example file directly in the browser.
- Detects common schema formats automatically and still lets you override the selection.
- Revalidates after edits when Auto validate is enabled, with late-result protection so older async validations cannot overwrite newer results.
- Highlights schema and message ranges for supported diagnostics.
- Shows grouped, searchable, filterable diagnostics with suggested fixes for common problems.
- Builds a Schema Summary tree for quick inspection of fields, attributes, types, required flags, limits, docs, and warnings.
- Handles multi-file XSD bundles through a Sources tab for user-supplied `xs:include` and `xs:import` dependencies.
- Adds workflow tools such as presets, local autosave, validation history, export/import, shareable URLs, dark mode, layouts, keyboard shortcuts, and a command palette.

## Feature Highlights

### Validation Experience

- **Two-pane workbench:** separate Monaco editors for schema and message content.
- **Upload or paste:** load schema/message text from files or type directly.
- **Auto-detection:** identifies high-confidence signatures for XSD, JSON Schema, OpenAPI, GraphQL SDL, Protobuf, Avro, CSV table schemas, and key-value rules.
- **Realtime validation:** debounced validation runs as editors change, with a manual Validate button available at any time.
- **Precise diagnostics:** issues include severity, title, message, code, path, source location, and editor highlighting when ranges are available.
- **Suggested fixes:** common issues show practical next steps, such as adding missing fields, correcting enum values, adding missing XSD sources, or adjusting schema rules.
- **Diagnostic tools:** search, severity filtering, grouping by issue type/source/path, and deduplication for repeated failures.

### Schema Understanding

- **Summary tree:** scan fields and structures without reading the whole schema by hand.
- **Summary toggles:** show or hide required fields, optional fields, ordering, data types, limits, descriptions, and warnings.
- **Summary search:** find fields, types, constraints, docs, and source labels in large schemas.
- **Pinned nodes:** keep important fields visible while exploring the rest of the schema.
- **Insights panel:** view schema metrics, message coverage, complexity hints, and comparison baseline results.
- **Comparison baseline:** save a schema summary baseline, edit the schema, and compare added, removed, and changed nodes.

### Message Tools

- **Preview tab:** inspect JSON, YAML, TOML, CSV, XML, and plain text payloads in a readable preview.
- **Coverage report:** compare the message against the schema summary to spot present, missing, and unused fields.
- **Format-aware parsing:** JSON-like formats, XML, CSV, and key-value text use structured parsers instead of raw string matching where practical.

### Workspace Power Tools

- **Local autosave:** restores schema text, message text, selected formats, XSD sources, active tabs, layout, theme, and validation preferences from browser storage.
- **Named presets:** save reusable workspaces and switch between them quickly.
- **Validation history:** review recent validation runs, pass/fail state, issue counts, duration, and restore older snapshots.
- **Export/import:** move a workspace bundle as JSON.
- **Share links:** create a URL fragment for reasonably sized workspaces without requiring a backend.
- **Command palette:** run common actions from the keyboard.
- **Theme and layout controls:** switch light/dark theme and adjust dense workbench layouts for focused work.

## Supported Formats

The workbench ships with focused adapters for the formats below. The short version is here; the exact coverage, support level, and known limits live in [SUPPORT_MATRIX.md](SUPPORT_MATRIX.md).

| Schema format | Message format | Summary |
| --- | --- | --- |
| JSON Schema | JSON | Strong support for required fields, types, enums, const, formats, patterns, numeric/string/array limits, additional properties, and common composite diagnostics. |
| JSON Schema | YAML | YAML parsing plus JSON Schema validation and range mapping. |
| TOML Schema | TOML | TOML parsing delegated through JSON Schema rules. |
| XSD | XML | libxml2/xmllint-backed XSD 1.0 validation in WebAssembly, plus user-supplied include/import bundles. |
| OpenAPI 3.x | JSON/YAML example | Extracts a request, response, or component schema and validates examples through JSON Schema normalization. |
| GraphQL SDL | GraphQL operation | Builds the SDL schema and validates operation syntax, fields, types, arguments, and AST locations. |
| Protobuf | JSON | Parses `.proto` files and validates JSON object shape for the first/default message model. |
| Avro | JSON | Validates records, arrays, maps, unions, enums, nullable unions, missing fields, and extra fields. |
| CSV table schema | CSV | Checks required columns, required cells, and basic string, integer, number, boolean, and date constraints. |
| Key-value rules | INI/ENV style text | Checks required keys, duplicates, empty values, types, enums, and safe regex patterns. |

## XSD And Multi-File Schemas

XSD support is a first-class workflow in this app. XML instances are validated against XSD 1.0 schemas with `xmllint-wasm`, which packages libxml2 for the browser. That gives the static app real XSD validation without a server process.

Because the app is browser-only and static, it does **not** automatically fetch files from `schemaLocation`, local disk paths, network paths, or remote URLs. Instead, related schemas are supplied by the user in the Sources tab:

1. Paste or upload the main XSD in the Schema editor.
2. Open the Sources tab when the schema has `xs:include` or `xs:import` references.
3. Use the missing-source buttons to create a prefilled related source entry.
4. Paste or upload the related XSD content.
5. Confirm the `schemaLocation` or namespace matches the reference.
6. Validation reruns with the full in-memory schema bundle.

The Sources tab tracks resolved and missing references, supports namespace imports, and keeps related XSDs tied to the current workspace, presets, exports, and validation history. The Summary tab also reads the source bundle so included/imported fields appear in the schema overview.

Current XSD limits are intentional and explicit: no automatic remote fetching, no XSD 1.1 assertions, no Schematron, and no Relax NG. See [SUPPORT_MATRIX.md](SUPPORT_MATRIX.md#xsd-note) for the full note.

## How To Use The Live App

1. Open [https://joelpjoji-mns.github.io/schema-validator/](https://joelpjoji-mns.github.io/schema-validator/).
2. Paste or upload your schema in the Schema editor.
3. Paste or upload your message, XML, CSV, GraphQL operation, or other sample payload in the Message editor.
4. Let format auto-detection choose a schema format, or select one manually.
5. Keep Auto validate enabled for live feedback, or press Validate manually.
6. Review the Diagnostics panel for errors, warnings, source paths, and suggested fixes.
7. Open Summary to inspect the schema tree, search fields, pin important nodes, and toggle details.
8. Open Insights to review metrics, message coverage, and summary comparison.
9. Open Preview to inspect parsed message content in a readable view.
10. For XSD includes/imports, open Sources and add each related `.xsd` file.
11. Save a preset, export the workspace, create a share link, or restore a previous validation history entry when needed.

## Local Development

### Prerequisites

- Node.js 24 or a compatible modern Node version.
- npm.
- Playwright browsers for E2E tests. The GitHub Actions workflow installs Chromium with `npx playwright install --with-deps chromium`.

### Install

```bash
npm install
```

### Run The App

```bash
npm run dev
```

The Vite dev server listens on `127.0.0.1`, usually at `http://127.0.0.1:5173/`.

### Build Static Output

```bash
npm run build:static
```

The generated `dist` folder can be served by any static host.

### Preview A Production Build

```bash
npm run preview
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server on `127.0.0.1`. |
| `npm run build` | Run TypeScript project checks and create a production Vite build. |
| `npm run build:static` | Alias for the production build used by static hosting and GitHub Pages. |
| `npm run lint` | Run ESLint with `--max-warnings=0`. |
| `npm run typecheck` | Run TypeScript project reference checks with plain output. |
| `npm run test` | Run the Vitest unit and component test suite. |
| `npm run test:watch` | Run Vitest in watch mode. |
| `npm run test:e2e` | Run Playwright browser tests on desktop Chromium and a mobile viewport. |
| `npm run preview` | Preview the production build locally. |
| `npm run preview:static` | Static preview alias using the same Vite preview server. |

## Architecture

The app is a static React/Vite/TypeScript application. It has no runtime backend, database, account system, or upload service.

```text
src/
  components/
    ValidatorWorkbench.tsx      Main state hub and app orchestration
    EditorPane.tsx              Monaco editor wrapper with upload and highlights
    DiagnosticsPanel.tsx        Searchable/filterable validation diagnostics
    SchemaSummaryTree.tsx       Schema tree, toggles, search, and pins
    SchemaSourcesPanel.tsx      XSD include/import source management
    SchemaInsightsPanel.tsx     Metrics, coverage, and comparison baseline
    MessagePreviewPanel.tsx     Parsed message previews
    CommandPalette.tsx          Keyboard-driven command UI
    workbenchPowerTools.ts      Persistence, presets, history, export/share helpers
  validation/
    registry.ts                 Adapter lookup and validation routing
    types.ts                    Shared validation request/result types
    schemaDetection.ts          Schema format auto-detection
    structuredParsers.ts        JSON/YAML/TOML/XML/CSV parsing helpers
    textRanges.ts               Source range mapping for diagnostics
    adapters/                   Format-specific validation engines
    introspection/              Schema Summary model builders
```

Important implementation ideas:

- **Registry-based validation:** schema/message pairs are routed through adapter objects instead of one large validator.
- **Structured parsing:** JSON-like formats, XML, CSV, TOML, and YAML use parsers so diagnostics can map back to useful source ranges.
- **XSD engine split:** `xmllint-wasm`/libxml2 is the primary XSD validation engine, while the TypeScript XSD model parser powers Summary and fallback behavior.
- **Local-first workspace state:** presets, history, snapshots, theme, layout, and source bundles live in browser storage or URL fragments under user control.
- **Static deployment:** Vite is configured with relative asset paths so the same build can run at a domain root or under `/schema-validator/` on GitHub Pages.

## Testing And Quality

The project uses multiple layers of verification:

- **TypeScript:** project reference checks with `tsc -b`.
- **ESLint:** strict linting with zero warnings allowed.
- **Vitest:** unit and React component tests in jsdom.
- **React Testing Library:** user-facing component behavior tests.
- **Playwright:** browser E2E tests for desktop Chromium and a mobile viewport.
- **npm audit:** dependency advisory checks at the moderate threshold.
- **GitHub Actions:** every push to `main` runs lint, typecheck, unit tests, Playwright tests, and static build before publishing.

Recommended pre-commit verification:

```bash
npm run typecheck
npm run lint
npm run test
npm run test:e2e
npm run build:static
npm audit --audit-level=moderate
```

## Static Hosting And Deployment

This project is designed to be hosted as plain static files. After `npm run build:static`, the `dist` folder can be deployed to GitHub Pages, Netlify, Vercel static output, S3, nginx, Apache, or an internal file server.

GitHub Pages deployment is automated by [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml):

1. Push to `main`.
2. Install dependencies with npm.
3. Run lint, typecheck, unit tests, and Playwright tests.
4. Build the static app.
5. Publish `dist` to the `gh-pages` branch.

The public deployment is available at [https://joelpjoji-mns.github.io/schema-validator/](https://joelpjoji-mns.github.io/schema-validator/).

## Privacy And Data Model

Schema Validator Workbench is local-first:

- There is no runtime API server.
- There is no account system.
- Pasted/uploaded files are processed in the browser.
- Workspace autosave uses browser localStorage.
- Exported bundles are downloaded or copied only when you choose to export.
- Share links encode workspace content in the URL fragment when the payload is small enough.

Treat share links and exported bundles as sensitive if the schema or message contains private data.

## Troubleshooting

### My XSD include or import is missing

The app does not fetch `schemaLocation` paths automatically. Open Sources, add the missing include/import source, and paste or upload the related XSD. Make sure `schemaLocation` or namespace matches the reference in the main schema.

### Auto-detection picked the wrong schema format

Use the schema format selector to choose the format manually. Auto-detection is strongest for clear signatures such as XSD, OpenAPI, GraphQL SDL, Protobuf, Avro, CSV table schemas, and key-value rules, but ambiguous text can still need a manual selection.

### Remote JSON Schema refs are not resolving

Remote refs are not fetched by the static app. Inline the referenced schema, use local definitions where supported, or adapt the schema for browser-local validation.

### GraphQL validation passed but my resolver would fail

The GraphQL adapter validates SDL and operation structure. It does not execute resolvers or validate runtime response payloads.

### Protobuf binary payloads are not accepted

The Protobuf adapter validates JSON-shaped messages against `.proto` definitions. It does not decode binary protobuf payloads.

### The production build warns about large chunks

The app includes Monaco Editor and a WebAssembly-backed XSD engine, so the production bundle can be large. The warning is expected for this workbench-style app unless code splitting is introduced later.

### Playwright says browsers are missing

Install the Chromium browser used by the E2E suite:

```bash
npx playwright install chromium
```

On Linux CI, the workflow uses:

```bash
npx playwright install --with-deps chromium
```

## Roadmap Ideas

The current app is already fully static and usable, but future upgrades could include:

- OpenAPI operation/schema selector for multiple paths, methods, responses, and content types.
- Protobuf message selector for `.proto` files with multiple messages.
- CSV strictness controls for extra columns, uniqueness, patterns, enums, and numeric ranges.
- XSD dependency graph for include/import relationships.
- JSON Schema `$ref` explorer for local refs, missing refs, circular refs, and `$defs` inventory.

Roadmap items are not required to use the current validator; they are candidates for future product depth.

## Reference

- [Support matrix](SUPPORT_MATRIX.md)
- [Deployment workflow](.github/workflows/deploy-pages.yml)
- [Live app](https://joelpjoji-mns.github.io/schema-validator/)
