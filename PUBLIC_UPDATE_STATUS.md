# Public Product Update Status

Date: 2026-07-10

## What changed locally

The app has been converted from a personal Akul-only tracker into a public multi-user product named `ApplyPilot`.

Added:

- Generic `ApplyPilot` branding
- Candidate profile editor
- Generic job scoring based on each user's own skills/domains/highlights
- Firebase Web app config
- Firestore database created in Firebase project `akul-applypilot-20260710`
- Per-user Firestore security rules in `firestore.rules`
- Anonymous Auth + Firestore client sync code
- Local browser fallback if Firebase Auth is not enabled yet
- Low-cost AI mode: no always-on AI backend; local scoring by default

## Already completed in Firebase

- Firebase Hosting project is live: https://akul-applypilot-20260710.web.app
- Firebase Web App created: `ApplyPilot`
- Firestore database created: `(default)` in `asia-south1`

## Not deployed yet

The updated public UI and Firestore rules are not live yet because the Codex deploy command was blocked by the current session usage/approval limit.

Run this from the project folder when ready:

```powershell
cd C:\Users\ANKUL\.codex\visualizations\2026\07\10\019f4a87-137d-73a0-a07b-c2344fef10de\job-application-autopilot
firebase deploy --only firestore:rules,hosting --project akul-applypilot-20260710
```

## Manual Firebase Console step still needed

Enable Anonymous Authentication:

1. Open Firebase Console.
2. Project: `akul-applypilot-20260710`.
3. Go to Build > Authentication > Sign-in method.
4. Enable `Anonymous` provider.
5. Save.

Without this, the app will show `Local backup` and use browser storage only.

## Lowest-cost AI plan

Do not run an AI worker 24/7. Keep the current design:

- Local keyword matching is free and instant.
- Run paid AI only when the user clicks a button like `Generate tailored message`.
- Cache generated AI output in Firestore so repeat views cost nothing.
- Add per-user daily limits before exposing AI publicly.
- Avoid Cloud Run until Gmail sync or scheduled reminders are truly needed.