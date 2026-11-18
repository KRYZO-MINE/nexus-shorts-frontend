# Nexus Shorts Frontend

Static, responsive HTML/CSS/vanilla-JavaScript dashboard for the Nexus Shorts API. The frontend is a separate Vercel project and does not contain backend credentials or video-processing logic.

## Local preview

Requires Node.js and Python 3:

```powershell
npm run build
py -m http.server 8080
```

Set `API_BASE_URL` in the shell before `npm run build` if the API is not at `http://127.0.0.1:8000`. The generated `config/config.js` contains only the public API origin. Start the backend separately; see the backend repository README.

## Vercel deployment

1. Create/import the separate `nexus-shorts-frontend` repository in Vercel.
2. Set the public build environment variable `API_BASE_URL` to the deployed FastAPI API origin (for example `https://api.example.com`).
3. Use the `npm run build` build command and `dist` output directory from `vercel.json`.
4. Deploy, open the deployed page, and confirm the Server Control page reports the API/worker status.
5. Add the exact Vercel origin to the backend's `ALLOWED_ORIGINS`.

`API_BASE_URL` is public configuration, not a secret. The backend must keep APP_SECRET, database credentials, R2 keys, and any provider credentials server-side. Tailwind CSS is compiled locally by the Vercel build; the interface has no runtime CSS CDN dependency.

Frontend sources are intentionally browser-visible. Security depends on keeping credentials and sensitive processing logic in the backend, not on hiding HTML/CSS/JavaScript from Inspect Element or View Source.

## Behavior and privacy

- Dashboard counts are calculated from jobs saved in the current browser and refreshed from the API; they are not global user statistics.
- Each job access token is stored in this browser's local storage to support status polling and signed download requests. “Forget saved projects” removes local credentials only; it does not delete server jobs.
- YouTube preview uses YouTube's privacy-enhanced embed. Uploaded videos preview locally before they are sent to R2.
- Processing progress reflects actual completed clips; no estimated time is invented.
- The app describes Original Mode as timestamp-based clipping and makes no AI highlight-detection claim.
