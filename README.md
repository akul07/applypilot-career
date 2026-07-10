# ApplyPilot Career

ApplyPilot is a Firebase-hosted job application tracker. Users sign in with Google or an existing email account, answer job-goal questions, save resume/profile details, track applications, score job descriptions, and prepare outreach messages.

## Live app

- Vanity URL: https://applypilot-career.web.app
- Canonical auth URL: https://akul-applypilot-20260710.web.app

The vanity URL redirects to the canonical Firebase Auth domain before Google login to avoid Firebase OAuth authorized-domain errors on the secondary free Hosting domain.

## Stack

- Firebase Hosting
- Firebase Authentication
- Cloud Firestore
- Static HTML, CSS, and JavaScript
- Optional Cloud Run backend scaffold in `cloudrun/backend`

## Deploy

```bash
firebase deploy --only hosting --project akul-applypilot-20260710
firebase deploy --only hosting --project akul-applypilot-20260710 --config firebase.default.json
firebase deploy --only firestore:rules --project akul-applypilot-20260710
```