# Noco Ref Drop Readiness

Read-only preparation job for eventually dropping `*_ref` text columns.

Purpose:

- Freeze the exact ref-column candidates by table.
- Classify candidates as drop-later, keep-longer, or archive-only.
- Verify expected native Noco relation fields exist.
- Scan local Noco jobs for remaining code usage of each ref column.
- Produce a no-ref fixture guide for future refactor tests.

Commands:

```bash
npm run noco:ref-drop-readiness:dry-run
npm run noco:ref-drop-readiness:test
```

Reports:

`logs/nocodb-ref-drop-readiness/<timestamp>/`

- `summary.json`
- `ref-candidates.json`
- `native-relation-coverage.json`
- `code-usage.json`
- `no-ref-fixture-guide.json`
- `manual-review.md`
- `apply-result.json`

Safety:

- There is no apply mode.
- This job never patches records and never deletes columns.
- A ref column is not considered droppable while local code still reads or writes it.

