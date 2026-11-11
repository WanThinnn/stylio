# Stylio for iOS

Stylio uses SwiftUI and system controls for the Process, History, Guide and
Settings tabs. Process opens a PhotoKit library grid, newest photos first, with
Live Photo indicators and tap-to-select. It shows every photo shared with Stylio.
The Library Options menu also supports importing originals from Files.

Settings → AI Settings contains Smart Enhance, the individual effects, GPU
acceleration and the model tier. These preferences are saved locally. Appearance
changes apply to the interface immediately.
The app targets iPhone and iPad on iOS 17 or later. Build with Xcode 26 or
newer to get the system Liquid Glass appearance on compatible devices.

The shared JavaScript pipeline lives under [`web/src/`](../web/src/). The
WebKit bridge, Live Photo MOV processing and PhotoKit export are pending, so
this build is for browsing, selection and settings. History shows its empty
state until the app produces processing results.

## Build from Windows and test on an iPhone

1. Install [GitHub CLI](https://cli.github.com/) and sign in with `gh auth login`.
   Push the app and its [build workflow](../.github/workflows/ios-build.yml).
   The workflow must be on the default branch before it can receive requests.
2. Commit and push the revision you want to build, then run this from the
   repository root in Git Bash on Windows:

   ```bash
   bash scripts/build-ios.sh
   ```

   The script requests a build for the exact local `HEAD` on `origin`.
   Ordinary pushes do not start iOS builds. Use `--wait` to follow the run, or
   `--clean` to build without restoring or saving caches. The flags can be combined.
3. Open the completed run and download **Stylio-iOS** under **Artifacts**.
   Extract `Stylio-unsigned.ipa` from the downloaded ZIP.
4. Sign and sideload the IPA onto your iPhone using the same workflow you use
   for `Palettify-unsigned.ipa`. The artifact is a device build. Xcode and the
   iOS Simulator run on macOS.
5. Open Process and grant Photos access. Check the library grid, Live Photo
   indicator, selection and limited-access behavior. Try an HEIC and MOV from
   Library Options → Import from Files. In Settings, change appearance and
   reopen the app to check that the AI preferences persist.

CI reuses the unsigned IPA when the iOS project, sources and assets are
unchanged on the same Xcode and SDK. When Swift sources change, it restores
compatible Xcode compiler and module caches and builds the requested revision.

## Build on a Mac

Open `app/Stylio.xcodeproj` in Xcode 26 or newer and select the shared **Stylio**
scheme. Choose a simulator or configure **Signing & Capabilities** with your
development team for a physical iPhone. The initial bundle identifier is
`com.wanthinnn.stylio` and can be changed in the target settings if needed.
