# Idobata for iOS

This Expo app is the native iOS client for the existing Idobata account and backend. It shares task contracts and the authenticated API client with the web app, while keeping the React Native interface and Supabase session storage platform-specific.

## Local setup

From the repository root:

```bash
npm install
cp apps/mobile/.env.example apps/mobile/.env.local
npm run mobile:start
```

Set these public values in `apps/mobile/.env.local`:

- `EXPO_PUBLIC_API_BASE_URL`: the deployed web origin, or the local Next.js server.
- `EXPO_PUBLIC_SUPABASE_URL`: the same Supabase project used by the web app.
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the project's publishable key (the legacy anon key also works). Never put the service-role key in this app.

`http://localhost:3000` works in the iOS Simulator. A physical iPhone must use a reachable HTTPS deployment or your Mac's LAN address instead of `localhost`.

Run the native project with:

```bash
npm run mobile:ios
```

The first native run generates the ignored `apps/mobile/ios` directory. Commit configuration and JavaScript/TypeScript source, not generated native or build output.

## Included vertical slice

- Restore an encrypted Supabase session from the iOS Keychain.
- Sign in, create an account, and sign out.
- List and refresh the same tasks used by the web app.
- Create a private task.
- Complete, reopen, and undo completion optimistically with rollback on failure.
- Explicitly share a completed task privately or with the community.

Completing a task never publishes it. Sharing is a separate authenticated API request.

## Checks

```bash
npm run typecheck:mobile
npm run lint:mobile
npm run mobile:doctor
npm run mobile:export:ios
npx vitest run tests/mobile-shared
```

Before an App Store build, confirm the bundle identifier in `app.json`, replace the provisional icon with a final opaque 1024×1024 asset, configure an EAS project and signing credentials, and test authentication plus privacy flows against a staging backend on a physical device.
