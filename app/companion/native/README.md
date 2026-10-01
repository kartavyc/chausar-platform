# Chausar Companion native developer preview

This is a bare React Native + TypeScript iOS/Android app. It shares the portable phone protocol and companion controller with the responsive web client; it does not run the business data engine on the phone. `App.tsx` starts the local mock preview. Real pairing and requests require the coordinator's authenticated relay/server adapter and native secure storage, file picker and connectivity adapters. No live pairing, hosted service or push provider is supplied by this shell.

The package is isolated from the desktop manifest and uses the [official React Native 0.87.1 template dependency family](https://raw.githubusercontent.com/react-native-community/template/0.87.1/template/package.json). Dependencies are exact at the manifest level. A transitive lockfile must be generated and reviewed when an allowed install is available. The RN package requires Node `^22.13.0 || ^24.3.0 || >=26.0.0`; the recovery environment's Node 24.13.1 fits. The root's TypeScript 5.9 package is unchanged.

## Toolchain allocation comes first

The coordinator owns the shared `D:/Chausar/build-tools/qualification` allocation and the user's total 4 GB budget for free tools and project dependencies. This shell downloads nothing, creates no service and changes no global SDK settings. Arrange dependencies and build caches on D: with the coordinator before installing. The source checkout stays in its isolated worktree. No package archive, Gradle wrapper JAR, Android SDK/NDK, CocoaPods, compiled application or signing key is included.

Android requires JDK 17, SDK platform 37, Build Tools 37.0.0, NDK 27.1.12297006, Kotlin 2.2.0 and Gradle 9.4.1, following the [versioned build configuration](https://raw.githubusercontent.com/react-native-community/template/0.87.1/template/android/build.gradle) and [wrapper configuration](https://raw.githubusercontent.com/react-native-community/template/0.87.1/template/android/gradle/wrapper/gradle-wrapper.properties). The app supports Android API 24 and later and targets API 36. It uses the React Native Gradle plugin's Android Gradle Plugin 9.2.1. Configure `ANDROID_HOME` for the allocated SDK and a task-specific `GRADLE_USER_HOME` on D:. Use an existing physical device if a simulator exceeds the budget. Debug device builds need SDK-managed development signing provisioned during later qualification; this task has not created, copied or opened keys. Release signing is absent.

The wrapper launch scripts intentionally fail with a useful message while the wrapper JAR is absent. After the coordinator provides dependencies and Gradle, it can generate the ordinary wrapper with an installed Gradle command from this package:

```text
gradle -p android wrapper --gradle-version 9.4.1 --distribution-type bin --no-daemon
```

The SDK and Gradle will resolve additional native dependencies during a future build. That requires an allowed network path and must fit the coordinator's allocation; source validation here does not prove this toolchain fits in 4 GB.

iOS requires a Mac with Xcode 16.1 or newer, an installed iOS simulator, Ruby/Bundler and CocoaPods. The minimum target is iOS 15.1, from the [versioned RN platform helpers](https://raw.githubusercontent.com/facebook/react-native/v0.87.1/packages/react-native/scripts/cocoapods/helpers.rb). Windows cannot build this native target. On an already provisioned Mac, install the Gemfile and Pods with `bundle install`, then `bundle exec pod install` from `ios`. Pods creates `ChausarCompanion.xcworkspace`; open that workspace, not only the project. The project supports unsigned simulator development and supplies no developer team, signing identity, account or distribution credential. `com.example.chausarcompanion` is a preview identifier on both platforms; deployment identifiers and signing remain coordinator decisions.

## Start the preview

After allowed dependencies and the relevant native toolchain are present, run these from `app/companion/native` in separate terminals:

```text
npm run typecheck
npm start
npm run android
```

On a provisioned Mac use `npm run ios` in place of the Android command. Both platform scripts require a separately started Metro process and use `--no-packager`. Metro binds to loopback and is a foreground developer process; stop it with Ctrl+C. For an Android device, use the coordinator-provided SDK's `adb reverse tcp:8081 tcp:8081` so the device can reach loopback Metro. The emulator uses 10.0.2.2. Only these development hosts permit Android debug cleartext; remote relay requests require HTTPS. iOS allows local development networking while retaining App Transport Security for remote connections.

In the recovered Windows shell, the npm shim is broken. Use the existing CLI directly for the same package commands:

```powershell
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' --prefix app/companion/native run typecheck
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' --prefix app/companion/native start
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' --prefix app/companion/native run android
```

These Windows examples run from the repository root. They assume the coordinator has made the native package's dependencies available. No install is hidden in the scripts.

## Integration and qualification

The module name is `ChausarCompanion` in `app.json`, `AppRegistry`, Android's activity and the Swift factory. Metro watches `../shared` and `../../../platform` so the actual portable protocol is bundled rather than copied. Android and iOS launcher sources and an Xcode scheme are supplied; native compilation and device/simulator visual QA have not run in this environment. A foreground mock preview demonstrates screens and state transitions, not remote server authentication or persistence.

Cached brief data remains separate from current session authority. Native encrypted storage must satisfy the portable cache contract and use device-backed key storage. The production adapter must validate the current session online, obtain a fresh single-use approval challenge, verify the operation version and return explicit pending/unknown states on ambiguous delivery. It must never replay offline approvals. File picker, secure storage, connectivity, remote relay hosting and optional notification adapters remain provider-neutral boundaries. No vendor registration, WhatsApp/email message, push service, account creation, paid CI or store submission is part of this preview.

Before real deployment, qualify each platform against its actual SDK, finalize identifiers and app assets, review the privacy manifest against wired native modules and actual data use, provision the permitted secure storage and transport adapters, and test real pairing/revocation/reconnect/cancellation. See the repository's phone companion handoff for shared relay/server ownership.
