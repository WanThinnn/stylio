# Stylio for iOS

Stylio uses SwiftUI for Library, Albums, Guide and Settings. Library shows the
photos shared with Stylio. Albums includes personal albums and system albums
such as Favorites and Live Photos. The Library Options menu imports original
images or HEIC/MOV pairs from Files.

Settings → AI Settings contains Smart Enhance, the individual effects, GPU
acceleration and the model tier. These preferences are saved locally. Appearance
changes apply to the interface immediately.
The app targets iPhone and iPad on iOS 17 or later. Build with Xcode 26 or
newer to get the system Liquid Glass appearance on compatible devices.

Open a photo and tap **Add Styles**, or use **Select** and **Process** for a batch.
The Search tab finds photos by filename, date, album, and media type. On iOS 26
and later, the Library timeline appears inline when the system tab bar minimizes.
The Library sort menu also provides the **Year**, **Month**, and **All** views.
Stylio automatically saves processed photos as new assets in Photos and deletes
the temporary files after Photos confirms the save. The tray shows progress and
warnings. It keeps files for failed saves so you can share them or retry.
Stylio bundles the shared JavaScript pipeline from [`web/src/`](../web/src/) and
runs it in WebKit on the device. The pipeline downloads supported AI models and
codecs as needed. Settings → On this device manages these downloads and the
app's local preferences. The update check links to the latest successful iOS
build on GitHub Actions when it differs from the installed build.

Stylio validates the original HEIC/MOV pairing before saving a Live Photo.
If the MOV already has native Styles tracks, Stylio can add the required Texture
metadata while preserving the existing video and audio samples. The results
screen explains when a Live Photo can only be saved as a still.

## Run from the Photos share sheet

Set up a shortcut once on the iPhone or iPad:

1. Open Shortcuts, create a shortcut, and enable **Show in Share Sheet** in its details.
2. Let it receive **Images**. Include **Media** or **Files** if you also share
   explicit HEIC/MOV pairs from Files.
3. Add **Process Photos with Stylio** and set **Photos** to **Shortcut Input**.
   Each AI option uses the app setting when left unset.

Then open Photos, select a photo, and choose the shortcut from **Share**. The
action requests background execution, saves a new asset automatically, and
returns the processed HEIC for use in later shortcut steps. If Photos shares a
JPEG, Stylio can recover a matching original from the accessible Photos library.
It uses the Live Photo identifier when available, or verifies a unique unedited
HEIC candidate using its filename, capture time, and image content. When the
original is a Live Photo, Stylio verifies its MOV before pairing. Use **Current**
if **Automatic** shares too little information to recover the original.
Enable **Completion Notifications** in **Stylio → Settings → Processing** to
receive a system banner when a shortcut or background batch finishes. The banner
also reports saves with missing Live Photo motion or Lighting Depth.

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
5. Open Library and grant Photos access. Process an original HEIC and a Live
   Photo from the Live Photos album. Check the tray for save status, then open
   the saved Live Photo in Photos and verify motion, Styles and Texture in the editor.

CI reuses the unsigned IPA for the same source commit, Xcode and SDK. For a
different commit, it restores compatible Swift package checkouts, compiler and
module caches and builds the requested revision.

## Build with Codemagic

Commit and push `codemagic.yaml` with the app changes. In the [Stylio app on
Codemagic](https://codemagic.io/app/6af4c62554bfac27b6820e4c/settings), check for
the configuration file on the branch you pushed, then start **Stylio iOS
unsigned**. Download `Stylio-unsigned.ipa` from the completed build's artifacts.
The workflow runs on request and caches Swift packages and Xcode compilation.

To start the same build from Git Bash, load your Codemagic API token into the
current shell and run the script with the branch you pushed checked out.

```bash
read -rsp 'Codemagic API token: ' CODEMAGIC_API_TOKEN; printf '\n'
export CODEMAGIC_API_TOKEN
./scripts/build-ios.sh --codemagic --wait
```

Use `--clean` to bypass cached build data. The script defaults to the Stylio
Codemagic app above. Set `CODEMAGIC_APP_ID` to use another app.

## Build on a Mac

Open `app/Stylio.xcodeproj` in Xcode 26 or newer and select the shared **Stylio**
scheme. Choose a simulator or configure **Signing & Capabilities** with your
development team for a physical iPhone. The initial bundle identifier is
`com.wanthinnn.stylio` and can be changed in the target settings if needed.
