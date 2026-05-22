# Support Matrix

This app is a static, browser-only validation workbench. It is strongest for JSON-like schema validation and intentionally lighter for XSD because full W3C XSD validation requires a dedicated XSD engine, usually WASM or a backend service.

All schema formats can be inspected in the Schema Summary tab. The summary is a best-effort hierarchy view for human scanning; validation diagnostics remain the source of truth for pass/fail behavior.

## Product Workflow

- Editors start empty, with no bundled fixture selected in the product UI.
- Validation reruns automatically after schema or message edits when Auto validate is enabled.
- Schema format detection can switch the schema selector for high-confidence signatures such as XSD, GraphQL SDL, Protobuf, OpenAPI, Avro, table schemas, and key-value rules.
- Manual schema format selection is preserved until the schema text changes again.
- The Schema Summary tab can toggle ordering, required fields, optional fields, data types, limits, descriptions, and warnings.

## Format Coverage

| Schema format    | Message format     | Support level | What is covered                                                                                                                                                                                    | Known limits                                                                                                                                                                 |
| ---------------- | ------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON Schema      | JSON               | Strong        | Required fields, types, enums, const, format, pattern, numeric/string/array limits, additional properties, common composite and conditional diagnostics, schema/message ranges                     | Remote refs and custom formats are not fetched or registered                                                                                                                 |
| JSON Schema      | YAML               | Strong        | YAML parsing plus JSON Schema validation and source ranges                                                                                                                                         | YAML anchors/aliases are bounded by parser limits                                                                                                                            |
| TOML Schema      | TOML               | Strong        | TOML parsing plus JSON Schema validation                                                                                                                                                           | TOML range mapping is best-effort by key                                                                                                                                     |
| XSD              | XML                | Basic         | XML well-formedness, root matching, namespace-prefixed local names, root attributes, immediate child elements, primitive types, required/minOccurs, maxOccurs, basic root-level choice cardinality | No full XSD 1.0/1.1 compliance, recursive nested type validation, include/import loading, groups, wildcards, substitution groups, full restrictions, Schematron, or Relax NG |
| OpenAPI 3.x      | JSON/YAML example  | Moderate      | Finds a request/response/component schema, resolves local refs with circular/depth guards, normalizes nullable, delegates to JSON Schema                                                           | No UI selector for multiple operations/schemas yet; remote refs are not fetched                                                                                              |
| GraphQL SDL      | GraphQL operation  | Strong        | SDL build errors, operation parse errors, field/type validation, AST locations                                                                                                                     | Does not execute resolvers or validate runtime data                                                                                                                          |
| Protobuf         | JSON               | Moderate      | Parses `.proto`, picks the first message, validates JSON object shape, required proto2 fields, unknown fields, type mismatches                                                                     | No UI selector for message type yet; binary protobuf payloads are not decoded                                                                                                |
| Avro             | JSON               | Moderate      | Records, arrays, maps, unions, enums, nullable unions, missing/extra fields                                                                                                                        | Focused in-app validator, not a full Avro spec implementation                                                                                                                |
| CSV table schema | CSV                | Basic         | Required columns, required cells, basic string/integer/number/boolean/date checks, quote-aware cell highlighting                                                                                   | No cross-row constraints, uniqueness, joins, or advanced CSV dialect configuration                                                                                           |
| Key-value rules  | INI/ENV style text | Basic         | Required keys, duplicate warnings, empty values, types, enums, safe regex pattern validation                                                                                                       | INI sections are ignored; multiline and repeated-array values are not modeled                                                                                                |

## Summary Coverage

| Schema format    | Summary coverage                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| JSON Schema      | Properties, required flags, items, composition keywords, definitions, refs, enums, limits, formats   |
| XSD              | Top-level element, child elements, attributes, min/max occurs, primitive/custom types, simple facets |
| OpenAPI 3.x      | First discovered request/response/component schema with local ref resolution                         |
| GraphQL SDL      | Types, input types, interfaces, fields, arguments, enums, unions, non-null and list markers          |
| Protobuf         | Messages, fields, field numbers, repeated fields, maps, oneof markers, enums                         |
| Avro             | Records, fields, arrays, maps, unions, enums, defaults, logical types                                |
| CSV table schema | Columns, required flags, declared types, limits                                                      |
| Key-value rules  | Keys, required flags, declared types, enum/pattern/limit rules                                       |

## XSD Note

The XSD adapter is deliberately labeled basic. It catches common XML message problems and highlights both XML and schema locations, but it is not a replacement for a full XSD processor. Full XSD support would need a WASM XSD validator or an optional backend service while keeping this static GitHub Pages app as the UI.
