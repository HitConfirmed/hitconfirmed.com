# Hit Confirmed — notes for Claude

## Shipping every change (standing instruction from the owner)

Two Render services, each deploying its own branch (see `render.yaml`):

| Site | URL | Branch |
|------|-----|--------|
| Test | https://hit-confirmed.onrender.com | `testing` |
| Prod (official) | https://hitconfirmed.com | `main` |

For **every** ask, once the work is done and its tests pass locally, ship it without asking again:

1. **Merge into `testing`** and push. Render deploys in ~2 min.
2. **Test the test site**: wait for the deploy to be live (poll an endpoint for something only the new code returns), then check what you changed on the real site: API responses, and the page in Playwright at desktop (1280px) and phone (390px) widths. Look for page errors and sideways scrolling, and look at the screenshots.
3. **Push to `main`** (prod) only if step 2 passed.
4. **Test prod** the same way on https://hitconfirmed.com.
5. Report what was checked and what couldn't be (e.g. a live-only state with nothing live).

If a step fails, stop and fix it before moving on — never push to `main` with a failing test site.

**Ship only your own change to prod.** `testing` can hold other work that is not on `main` yet. Do not push `testing` to `main`. Merge your branch onto the current `origin/main` and push that, so someone else's untested commits don't go to prod with yours.

## Tests

- Server: `node --test $(find test -name "*.test.js")` (run `npm install` first).
- Client: `cd client && CI=true npx react-app-rewired test --watchAll=false` (run `npm install --include=dev` in `client/` first).
- Client build (same as Render): `cd client && DISABLE_ESLINT_PLUGIN=true CI=false npm run build`.
