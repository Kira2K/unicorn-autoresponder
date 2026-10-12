# Candidate intake

`intakeCandidate(input,{store,storageRoot,extractor})` preserves original PDF bytes under their SHA-256 hash and saves a `Candidate`. Input accepts a `CvSource`, confirmed facts, criteria, history, optional local stack labels and `databaseClientId`. `fileCvSource(path)` is the current source adapter; Google Drive retrieval remains TODO.

Confirmed answers override extraction. Re-intake retains earlier confirmed facts/history and database binding unless explicitly replaced. Missing facts remain missing. PDF bytes are never tailored or overwritten here. Side effects: local CV/state files, candidate lock and diagnostic events; an injected extractor may call AI. Invalid PDFs/identities or storage errors reject the stage.

For DB campaigns, `databaseClientId` links this local CV to an existing student; current DB membership is checked later. Legacy `criteria` remain available for individual search/history, but campaign eligibility uses the selected stack plus explicit restrictions.

CLI: `intake --candidate LOCAL_ID --input intake.json [--no-ai]`. Tests: intake cases in `contracts.test.ts` and `pipeline.test.ts`. Do not log PDF text, contact details or credentials by default.
