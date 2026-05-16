# Web Spellcast

A Flask + Socket.IO word game inspired by Discord Spellcast, with single-player and in-progress multiplayer support.

## Local run

1. Install dependencies:

```powershell
pip install -r requirements.txt
```

2. Start the app:

```powershell
python app.py
```

3. Open:

```text
http://127.0.0.1:5000
```

## Deploy on Railway

This repo includes [railway.json](/C:/Users/natha/OneDrive/Documents/GitHub/Spellcast_Codex/railway.json) and a [Procfile](/C:/Users/natha/OneDrive/Documents/GitHub/Spellcast_Codex/Procfile), so Railway can deploy it directly.

1. Push this repo to GitHub.
2. In Railway, create a new project.
3. Choose `Deploy from GitHub repo`.
4. Select this repository.
5. Wait for the build to finish.
6. Open the deployed service.
7. Generate a public domain in Railway.

Your public game link will look like:

```text
https://your-service-name.up.railway.app
```

Recommended Railway notes:

- Health check path: `/health`
- Start command: `gunicorn --worker-class gthread --workers 1 --threads 4 --timeout 120 app:app`

Official docs:

- [Railway Flask guide](https://docs.railway.com/guides/flask)
- [Railway Socket.IO guide](https://docs.railway.com/guides/socketio)

## Deploy on Render

This repo includes [render.yaml](/C:/Users/natha/OneDrive/Documents/GitHub/Spellcast_Codex/render.yaml), so Render can auto-detect the service settings.

1. Push this repo to GitHub.
2. In Render, create a new `Web Service`.
3. Connect your GitHub account and choose this repository.
4. Confirm the detected settings or import from `render.yaml`.
5. Deploy the service.
6. After deploy completes, use the Render URL.

Your public game link will look like:

```text
https://your-service-name.onrender.com
```

Recommended Render settings:

- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn --worker-class gthread --workers 1 --threads 4 --timeout 120 app:app`
- Health check path: `/health`

Official docs:

- [Render Flask deployment guide](https://render.com/docs/deploy-flask/)
- [Render WebSockets guide](https://render.com/docs/websocket)

## Important multiplayer note

Multiplayer room state currently lives in Python memory inside [app.py](/C:/Users/natha/OneDrive/Documents/GitHub/Spellcast_Codex/app.py). That means:

- it works on a single running server
- active rooms are lost if the service restarts or redeploys
- scaling to multiple app instances later will require shared state such as Redis or a database

For first public testing with friends, a single instance is fine.
