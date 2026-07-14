# Manual Bot Workflow Test

This checklist is for a manual end-to-end run of the resume workflow using the
existing Test client.

## Actors And Runtime

- Test client: `102` / `Тест`
- Common student chat: `-5216637594`
- Student: unchanged, resolved from the linked Test client/chat setup
- Kira: Telegram user ID `343610488`
- Provider: Telegram user ID `8222949251`, username `@veu_support`
- Provider assignment: `RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS=102:473`
- Test mode: `RESUME_WORKFLOW_TEST_MODE=true`
- Fake data mode: `RESUME_WORKFLOW_FAKE_DATA_MODE=false`

The Kira private account must open `@veu_support_bot` and send `/start` once
before private Kira notifications can be delivered. Kira still advances the
workflow by sending `/resume` in the common Test group, because the workflow is
looked up by the common chat ID.

## Preflight

0. Add `@veu_support_bot` to the common Test group.

   Expected automatic greeting:
   It must also include `Send /commands to see what I can do.`

   ```text
   Hello Тест, I'm a unicorn support bot!
   ```

1. Confirm backend status in any chat with the bot:

   ```text
   /backend_status
   ```

   Expected reply:

   ```text
   Backend: ok
   ```

2. In the common Test group, send:

   ```text
   /whoami
   ```

   Expected: chat ID is `-5216637594`.

3. In the common Test group, send:

   ```text
   /student
   ```

   Expected: bot finds `Тест`.

4. From provider `@veu_support` in a private chat with the bot, send:

   ```text
   /whoami
   ```

   Expected: user ID is `8222949251`.

5. From Kira private account in any chat where the bot can read the command,
   send:

   ```text
   /whoami
   ```

   Expected: user ID is `343610488`.

## Reset State

The workflow should start from:

```text
collection student's data
```

Reset clears only workflow-produced fields on the Test `CV processing` row:

- `status`
- `student_data_folder_url`
- `cv_draft_url`
- `en_version_url`
- `ru_version_url`
- `additional_versions`
- `kiras_comments`
- `last_responsible`
- `last_workflow_error`
- `workflow_trace`

It must not change student/client linking data.

## Student Source Data

In the common Test group, from the student account, send a fresh folder URL:

```text
/change_google_folder https://drive.google.com/drive/folders/manual-bot-test
```

Expected reply:

```text
Google folder updated for Тест.
New value: https://drive.google.com/drive/folders/manual-bot-test
```

## Full Workflow

1. Student in common group:

   ```text
   /resume
   ```

   Expected status: `collection Kira's comments`.
   Expected notification: private Kira notification to `343610488`.

2. Student immediately tries again in common group:

   ```text
   /resume
   ```

   Expected: forbidden message saying this step must be advanced by Kira.
   Status must remain `collection Kira's comments`.

3. Kira in common group:

   Before advancing, fill `kiras_comments` on the Test `CV processing` row in
   Noco/Admin Console. If Kira opens `/open_my_tasks` before that field exists,
   the task card should show `Required before processing: kiras_comments` and no
   `Process next step` button.

   ```text
   /resume
   ```

   Expected status: `Draft in process`.
   Expected notification: private provider notification to `8222949251`.

4. Student tries a provider-owned step in common group:

   ```text
   /resume
   ```

   Expected: forbidden message saying this step must be advanced by provider.
   Status must remain `Draft in process`.

5. Student tries provider queue from a private chat with the bot, if available:

   ```text
   /open_my_tasks
   ```

   Expected: forbidden message saying only configured Kira or provider accounts
   can open resume tasks.

6. Provider in private chat:

   ```text
   /open_my_tasks
   ```

   Expected: task list contains only `Тест` / client `102`.
   Open the Test task before filling `cv_draft_url`.
   Expected: task card shows `Required before processing: cv_draft_url` and no
   `Process next step` button.

   Fill `cv_draft_url` on the Test `CV processing` row in Noco/Admin Console.
   Reopen the task and press `Process next step`.
   Expected status: `Draft in approve by Kira`.

7. Kira in common group:

   ```text
   /resume
   ```

   Expected status: `Draft in approve by student`.
   Expected notification: common chat message mentioning the student.

8. Student in common group:

   ```text
   /resume
   ```

   Expected status: `English version in progress`.

9. Provider in private chat:

   ```text
   /open_my_tasks
   ```

   Open the Test task before filling `en_version_url`.
   Expected: task card shows `Required before processing: en_version_url` and no
   `Process next step` button.

   Fill `en_version_url` on the Test `CV processing` row in Noco/Admin Console.
   Reopen the task and press `Process next step`.
   Expected status: `English version in approve by Kira`.

10. Kira in common group:

    ```text
    /resume
    ```

    Expected status: `English version in approve by student`.

11. Student in common group:

    ```text
    /resume
    ```

    Expected status: `Russian version in process`.

12. Provider in private chat:

    ```text
    /open_my_tasks
    ```

    Open the Test task before filling `ru_version_url`.
    Expected: task card shows `Required before processing: ru_version_url` and
    no `Process next step` button.

    Fill `ru_version_url` on the Test `CV processing` row in Noco/Admin Console.
    Reopen the task and press `Process next step`.
    Expected status: `Russian version in approve by Kira`.

13. Kira in common group:

    ```text
    /resume
    ```

    Expected status: `Russian version in approve by student`.

14. Student in common group:

    ```text
    /resume
    ```

    Expected status: `moved to filling`.
    Expected summary message:

    ```text
    Test mode, do nothing. Account of Тест EN is ready to filling, links to RU: [ru], EN: [en]. @kirasamsonova fyi
    ```

15. Provider in private chat:

    ```text
    /open_my_tasks
    ```

    Open the Test task and press `Process next step`.
    Expected final status: `filled`.

## Final Checks

In the common Test group, send:

```text
/resume_status
```

Expected:

- status is `filled`;
- draft, EN, and RU links exist;
- source folder equals the manual folder URL;
- provider queue no longer shows Test as an active task.

## Known Blocking Conditions

- If `/backend_status` says there is no backend, restart `web:backend`.
- If the bot does not answer at all, restart `tg:support-bot` and confirm no
  other Bot API poller is using the token.
- If Kira private notification fails, open `@veu_support_bot` from Kira account
  `343610488` and send `/start`.
- If `/resume` asks for Education or English level, fill those fields in the
  Console for client `102`; the bot intentionally does not edit them in
  Telegram.
- If provider sees no Test task at a provider-owned status, verify runtime env
  includes `RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS=102:473`.
