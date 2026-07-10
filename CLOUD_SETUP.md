# Akul ApplyPilot Cloud Setup

This project is prepared for Firebase Hosting + Cloud Run + Firestore.

## Cost note

This can run inside free tiers for light personal use, but it is not unlimited free hosting. Cloud Run usually requires billing to be enabled. Set a budget alert and keep usage low.

Official pages:
- Google Cloud free program: https://cloud.google.com/free
- Cloud Run pricing: https://cloud.google.com/run/pricing
- Firebase pricing: https://firebase.google.com/pricing

## Architecture

- Firebase Hosting serves `index.html`, `styles.css`, `app.js`, and `app-config.js`.
- Cloud Run serves `/api/jobs`.
- Cloud Run writes job records into Firestore under `users/{userId}/jobs/{jobId}`.
- Browser localStorage remains a backup fallback.
- Gmail and Calendar sync need production OAuth credentials before enabling.

## Files added

- `firebase.json` - Firebase Hosting and Firestore deploy config.
- `.firebaserc.example` - copy to `.firebaserc` and put your Firebase project ID.
- `firestore.rules` - blocks direct browser access; Cloud Run writes with service account permissions.
- `cloudrun/backend/server.js` - no-dependency backend for Cloud Run.
- `app-config.js` - put the deployed Cloud Run URL here.

## Deployment steps

1. Create a Firebase project from the Gmail you want to use.
2. Create a Firestore database in Native mode.
3. Copy `.firebaserc.example` to `.firebaserc` and replace `your-firebase-project-id`.
4. Deploy Firestore rules and Hosting:

```bash
firebase deploy --only firestore:rules,hosting
```

5. Deploy the Cloud Run backend:

```bash
gcloud run deploy applypilot-backend \
  --source cloudrun/backend \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars CORS_ORIGIN=https://your-firebase-project-id.web.app
```

6. Give the Cloud Run service account Firestore access if Google Cloud asks for it. Use the least broad role that works, usually Cloud Datastore User.
7. Copy the Cloud Run service URL.
8. Edit `app-config.js`:

```js
window.APPLYPILOT_CONFIG = {
  apiBaseUrl: "https://your-cloud-run-url.run.app",
  userId: "akulsinghdeo@gmail.com",
  cloudMode: "cloud"
};
```

9. Redeploy Hosting:

```bash
firebase deploy --only hosting
```

## Gmail and Calendar sync

The Codex Gmail connector currently shows `akulsinghdeo@gmail.com`. For the deployed app, Gmail and Calendar need a Google OAuth consent screen and refresh token for the Gmail account that receives job emails.

Recommended safe behavior:

- Gmail sync reads job-related emails and suggests status updates.
- Calendar reminders create follow-up and interview reminders only after you approve the reminder behavior inside the app.
- The app should not auto-send applications or emails without a final review step.