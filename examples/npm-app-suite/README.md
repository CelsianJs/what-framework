# What Framework npm App Suite (8 Apps)

This suite validates `what-framework@0.5.0` and `what-compiler@0.5.0` directly from npm (not workspace linking).

## Apps and Ports

- `app-01-signals` -> [http://localhost:5411](http://localhost:5411)
- `app-02-computed` -> [http://localhost:5412](http://localhost:5412)
- `app-03-store` -> [http://localhost:5413](http://localhost:5413)
- `app-04-forms` -> [http://localhost:5414](http://localhost:5414)
- `app-05-focus` -> [http://localhost:5415](http://localhost:5415)
- `app-06-html` -> [http://localhost:5416](http://localhost:5416)
- `app-07-events-style` -> [http://localhost:5417](http://localhost:5417)
- `app-08-data` -> [http://localhost:5418](http://localhost:5418)

## What Each App Covers

- `app-01-signals`: signal read/write, callable setter compatibility, `batch()` updates
- `app-02-computed`: `useComputed` totals and dynamic list updates
- `app-03-store`: `createStore`, `derived`, action updates, filtered selectors
- `app-04-forms`: `useForm`, resolver/rules, `formState.errors` getter + `ErrorMessage`
- `app-05-focus`: `FocusTrap` and `useFocusRestore` modal flow
- `app-06-html`: `innerHTML`, `dangerouslySetInnerHTML`, SVG innerHTML path
- `app-07-events-style`: `onClick` + `onclick` parity, CSS-first states with optional inline style object
- `app-08-data`: `useSWR` cache/revalidate/mutate flow

## Run

Run once per app:

```bash
cd examples/npm-app-suite/app-01-signals && npm install && npm run dev
```

Repeat for each app directory (`app-02-computed` ... `app-08-data`).

Build check for all apps:

```bash
for app in app-01-signals app-02-computed app-03-store app-04-forms app-05-focus app-06-html app-07-events-style app-08-data; do
  (cd "examples/npm-app-suite/$app" && npm run build)
done
```

## Notes

- Each app uses fixed `vite --port <port> --strictPort` to avoid accidental port drift.
- The suite is intended for npm-consumer DX checks after framework releases.
