# Vendored copy of the DFX Design Pod

These files are **copies**, not originals. The source of truth is the DFX Design Pod
(`~/DFXswiss/DFX-design-pod`, `joshuakrueger-dfx/design-pod`), taken at commit `82a9516`.

| File | Source in the pod | Purpose |
|---|---|---|
| `tokens.css` | `dist/tokens.css` | compiled CSS custom properties, `.theme-light` / `.theme-dark` |
| `logo-dark.svg` | `brand/logo-dark.svg` | logo of record, for light surfaces |
| `logo-white.svg` | `brand/logo-white.svg` | logo of record, for dark surfaces |
| `fonts/Inter-*.woff2` | `brand/Inter-*.woff2` | brand sans, self-hosted |
| `fonts/SourceCodePro-Regular.woff2` | `brand/SourceCodePro-Regular.woff2` | brand mono, self-hosted |
| `fonts/Inter-LICENSE.txt` | Inter project (SIL OFL 1.1) | license text shipped with the font |
| `fonts/SourceCodePro-LICENSE.md` | Source Code Pro project (SIL OFL 1.1) | license text shipped with the font |

Inter and Source Code Pro are licensed under the **SIL Open Font License 1.1**.
Their license files must travel with every copy of the fonts; do not redistribute
the `.woff2` files without the matching license documents.

## Why a copy exists at all

The handbook image is built from this repository alone — the Docker build context is
`DFXswiss/btc-wallet` and cannot reach another checkout. Self-hosting is also what the served CSP
requires: `default-src 'self'` leaves no room for a font CDN.

## Rules

- **Never edit these files here.** The pod states it plainly: *"Never hand-edit a colour inside a
  consumer repo — it will drift and the Pod is no longer the truth."* A change goes into
  `tokens/primitives.json` or `tokens/themes.json` in the pod, is recompiled there, and is copied
  back over these files afterwards.
- **Never retype the wordmark.** The logo is embedded from the SVG; writing "DFX" as text is
  explicitly against the pod.
- When refreshing, update the commit hash in the table above so the copy stays traceable.
