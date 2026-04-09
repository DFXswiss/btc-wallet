# Roadmap

This roadmap focuses on release provenance, auditability, and workflow hardening for Android artifacts.

## Current State

- Android release artifacts are built in CI and uploaded to GitHub Releases.
- Releases include:
  - APK
  - APK signature (`.idsig`)
  - transparent AAB
  - transparency certificate (`.pem`)
  - `SHA256SUMS`
- Releases link back to the GitHub Actions pipeline that generated the artifacts.
- GitHub artifact attestations are generated for the published Android artifacts, including `SHA256SUMS`.
- `README.md` documents bundle verification and connected-device transparency checks.

## Near Term

### 1. Add a compact verification guide

Create one short verifier-facing document that explains:

- what each release artifact is
- what GitHub attestation proves
- what Android code transparency proves
- how connected-device verification differs from bundle verification

Why:

- Reduces confusion and makes the trust story easier to follow.

### 2. Modernize the release workflow

Clean up legacy workflow usage:

- replace deprecated `::set-output`
- review older actions and move to maintained alternatives where practical
- keep the release steps easier to audit

Why:

- Lowers maintenance risk and improves long-term reliability.

## Mid Term

### 3. Improve reproducibility guidance

Document the expected build environment and reproducibility constraints for Android releases:

- toolchain versions
- signing/transparency assumptions
- what should and should not be expected to match bit-for-bit

Why:

- Makes independent auditing more realistic and honest.

### 4. Add release verification references to release notes

Standardize a small release note section that links to:

- the workflow run
- the artifact attestation docs
- the transparency verification docs

Why:

- Keeps verification material attached to every release instead of relying on repository docs alone.

## Later

### 5. Evaluate stronger release automation

Consider simplifying the release workflow further by:

- consolidating upload logic
- reducing custom scripting where possible
- making the release pipeline easier to review end-to-end

Why:

- Improves clarity for maintainers and external auditors.

### 6. Evaluate SBOM generation

Assess whether generating and attesting an SBOM for Android release artifacts is worth the maintenance cost.

Why:

- Could improve supply-chain visibility, but only if it stays accurate and maintainable.

## Principles

- Prefer simple, verifiable release steps over clever automation.
- Keep the public audit story honest about what each mechanism proves.
- Optimize first for auditor clarity, then for end-user convenience.
