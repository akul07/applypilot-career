# Deployment Status

Date: 2026-07-10

## Live frontend

Firebase Hosting is live:

https://akul-applypilot-20260710.web.app

Firebase project:

- Project ID: `akul-applypilot-20260710`
- Account used: `aakulanshu2003@gmail.com`

## Backend status

Cloud Run backend is not live yet. Google blocked API activation because no billing account is attached to this project.

Error reason from Google Cloud:

`UREQ_PROJECT_BILLING_NOT_FOUND`

Required APIs blocked until billing is attached:

- `artifactregistry.googleapis.com`
- `cloudbuild.googleapis.com`
- `run.googleapis.com`
- `containerregistry.googleapis.com`

After billing/free trial is enabled, rerun:

```powershell
$env:CLOUDSDK_CONFIG='C:\Users\ANKUL\.codex\visualizations\2026\07\10\019f4a87-137d-73a0-a07b-c2344fef10de\gcloud-config'
C:\Users\ANKUL\AppData\Local\Temp\gcsdk\google-cloud-sdk\bin\gcloud.cmd run deploy applypilot-backend --source cloudrun\backend --region asia-south1 --allow-unauthenticated --set-env-vars CORS_ORIGIN=https://akul-applypilot-20260710.web.app --quiet
```

Then put the Cloud Run URL in `app-config.js` and redeploy Firebase Hosting:

```powershell
firebase deploy --only hosting
```