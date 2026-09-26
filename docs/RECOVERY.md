# Recovery and export

Selection Studio must not depend on access to one GitHub account for recovery.

## Build a self-contained source/data archive

Run:

```bash
python tools/build_recovery.py
```

The result is `dist/selection-studio-recovery.zip`. It contains:

- canonical question and exam JSONL
- runtime catalog
- taxonomy and schemas
- Selection Studio and Review Console source
- Worker source/configuration documentation
- validation/build engine
- QA configuration and tests
- project/rebuild documentation
- `RECOVERY_MANIFEST.json` with SHA-256 for every included file

Secrets are not stored in the repository and therefore are not included in the archive.

## Recovery rule

After a meaningful canonical-data milestone, download the latest recovery artifact from CI and copy it to storage outside the GitHub account (for example a phone, Drive, or Dropbox). Verify the ZIP opens and keep at least one external copy.

## Restore

1. Extract the archive into a new repository or local folder.
2. Run `python engine/validate_bank.py`.
3. Run `python engine/build_catalog.py --output /tmp/catalog.json` and compare with `runtime/catalog.json`.
4. Install Node dependencies and run `npm run qa:full`.
5. Recreate Worker secrets/bindings from `worker/README.md`; secrets are intentionally never exported.
