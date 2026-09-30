# Windows runtime sources and qualification prerequisites

Research checked 2026-09-30 against official upstream documentation and release metadata. Inspected desktop worktree `C:/Users/karta/Documents/Codex/2026-10-01/new-chat-2/chausar-desktop-release-20261001` at `5bd3f67668fd92ed293c964e25ca72568f27f463`; its initial Git status was clean. This report changes no repository source, package manifest or lockfile. No runtime was downloaded, installed or executed; no GUI, browser, service, signing credential or account was created. Web documentation reads did not retry the previously denied shell-network or native-GUI action.

The first useful Windows milestone can be an **unsigned synthetic Electron preview ZIP**, independently of PostgreSQL/Python vendoring. The current preview builder excludes `runtime-binaries`, forces synthetic data and refuses `--production`. A complete production package additionally needs the real runtime bundles below. Source discovery, archive verification, assembly and native execution are separate evidence requirements.

## Existing build contract

At the inspected commit, the declared pins are Node `>=24.13.1`, Electron `44.4.5`, electron-builder `26.0.12`, TypeScript `5.9.3`, `@types/node` `24.0.0`, `@types/pg` `8.15.5`, `pg` `8.23.0`, and `@duckdb/node-api` `1.5.5-r.3`. These are **repository declarations**, not a claim that registry resolution, ABI compatibility or installation has passed. Parent/integration owns dependency selection and a genuine `package-lock.json`; this research lane does not change either. Recovery verified npm `11.8.0` through `node 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js'`; the PowerShell npm shim is broken and must not be repaired globally for this task.

For production, `runtime-binaries/manifest.json` must identify one OS/architecture, exact component versions, public HTTPS provenance and license files, plus every regular bundled file's actual SHA-256 and size. Windows executable paths are `postgres/bin/postgres.exe`, `postgres/bin/initdb.exe`, `postgres/bin/pg_ctl.exe`, and `python/python.exe`. Retain PostgreSQL's full `share`/dependent-library tree, Python's standard library/extensions, vendored Python packages and all license notices. Archive hashes below do not replace the required inventory of the assembled tree.

The startup harness uses those paths, initializes only its app-owned cluster, starts PostgreSQL on loopback and calls `pg_ctl stop` on shutdown. `platform/runtime/helper.ts` invokes an explicit absolute Python path with `-I -B`, a fresh temporary working directory and a reduced environment; PATH/PYTHONPATH installations do not satisfy the packaged helper contract.

## PostgreSQL: official entry point and exact unresolved step

The [PostgreSQL Windows download page](https://www.postgresql.org/download/windows/) explicitly links EDB's binary ZIP for embedding inside another application installer. The [EDB binary archive page](https://www.enterprisedb.com/download-postgresql-binaries) currently lists **18.6** (also 17.11, 16.15, 15.19, 14.24). The [EDB platform table](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads) labels Windows x86-64; a Windows ARM64 EDB ZIP is **not established by these sources**.

**Windows x64 candidate:** EDB PostgreSQL **18.6**, exact installer-build revision and archive URL still unresolved. The read-only web extraction exposes version headings but omits the binary download controls/links. No verified archive SHA-256 or signature was exposed. Do not manufacture a `get.enterprisedb.com` URL or use a guessed `-1`/`-2` revision. The bounded acquisition step is: on a permitted download machine, select Windows x86-64 under 18.6 on that official EDB page, retain the resolved URL/build revision and upstream integrity/provenance evidence, then materialize the authentic ZIP. A locally calculated archive digest establishes byte identity after acquisition; it does not independently authenticate the vendor.

**Windows ARM64:** retain this target as outstanding. Require a genuine qualified ARM64 vendor distribution, or a reproducible build of **PostgreSQL 18.6** from the [official source directory](https://www.postgresql.org/ftp/source/v18.6/), which publishes archive SHA-256 sidecars. The source candidate is `https://ftp.postgresql.org/pub/source/v18.6/postgresql-18.6.tar.bz2`, with its same-name `.sha256`; the sidecar's contents were not retrieved here and no digest is invented. Source availability does not establish Windows ARM64 success.

[PostgreSQL 18 build requirements](https://www.postgresql.org/docs/18/install-requirements.html) include Meson **>=0.54** for Windows Visual Studio builds, a C99 compiler, Flex/Bison (Bison **>=2.3**) and Perl **>=5.14**; compile-time options add libraries. These are upstream minimums, not a complete pinned compiler toolchain. Pin the actual approved ARM64 MSVC/SDK/Meson/Ninja/dependency versions in the build receipt. The [Meson installation documentation](https://www.postgresql.org/docs/18/install-meson.html) provides prefix staging and `meson test`; it also explains relocation/library-path concerns. Stage under a build-owned prefix and qualify relocated execution without installing an OS service. Preserve the [PostgreSQL license](https://www.postgresql.org/about/licence/) and dependent-library licenses. Audit Windows DLL resolution and any MSVC redistribution obligations against [Microsoft's official redistribution guidance](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files?view=msvc-170).

## Python: genuine embeddable candidates

The [Python 3.14.8 release page](https://www.python.org/downloads/release/python-3148/) lists the following official archives, SHA-256 values and separate Sigstore/SBOM links. **3.14.8 is a proposed exact qualification pin, not a locally tested runtime.**

| Target | Official release-page archive | Published SHA-256 |
| --- | --- | --- |
| Windows x64 | [python-3.14.8-embed-amd64.zip](https://www.python.org/ftp/python/3.14.8/python-3.14.8-embed-amd64.zip) | `a93abe456ab01bd96d7a085b3cdb6566b3063f4241360d114142fbdb07f0a310` |
| Windows ARM64 | [python-3.14.8-embed-arm64.zip](https://www.python.org/ftp/python/3.14.8/python-3.14.8-embed-arm64.zip) | `155be84ccb57c6331cf0e39001c78a1dfac3be62f403f3ff5f2e29b80dda7ebe` |

The [Windows release manifest](https://www.python.org/ftp/python/3.14.8/windows-3.14.8.json) also describes `-embeddable-amd64.zip` and `-embeddable-arm64.zip` with **different hashes**. They are distinct named artifacts. Do not apply a release-page `-embed-` hash to a manifest `-embeddable-` archive or silently substitute them. Record which authentic artifact was acquired and verify its corresponding upstream metadata/Sigstore evidence. Ship Python's supplied license and third-party notices; see [Python licensing](https://docs.python.org/3.14/license.html).

The [official embeddable documentation](https://docs.python.org/3.14/using/windows.html#the-embeddable-package) supports vendoring third-party packages with an application, excludes pip and does not support managing the embedded runtime like a normal pip installation. Therefore use a separately controlled build interpreter/wheelhouse, then include the qualified packages in the application runtime. Do not bootstrap pip or auto-update packages inside the end user's embedded runtime.

The existing helper's forecasting and allocation functions need only standard-library modules. PDF text extraction imports `pdfplumber`. A proposed closed dependency set for **standard, GIL-enabled CPython 3.14** is:

| Pin | Required wheel selection/source | Windows ARM64 state |
| --- | --- | --- |
| `pdfplumber==0.11.10` | [Upstream PyPI release](https://pypi.org/project/pdfplumber/0.11.10/), `py3-none-any` | Pure Python |
| `pdfminer.six==20260107` | [Upstream PyPI release](https://pypi.org/project/pdfminer.six/20260107/), `py3-none-any` | Pure Python |
| `Pillow==12.3.0` | [Upstream PyPI release](https://pypi.org/project/pillow/12.3.0/), `cp314-cp314-win_amd64` / `win_arm64` | ARM64 wheel listed |
| `pypdfium2==5.13.0` | [Upstream PyPI release](https://pypi.org/project/pypdfium2/5.13.0/), `py3-none-win_amd64` / `win_arm64` | ARM64 wheel listed; carries native PDFium |
| `charset-normalizer==3.5.2` | [Upstream PyPI release](https://pypi.org/project/charset-normalizer/3.5.2/), choose the `py3-none-any` wheel | Pure Python candidate |
| `cryptography==50.0.2` | [Upstream PyPI release](https://pypi.org/project/cryptography/50.0.2/), `cp311-abi3-win_amd64` for standard CPython 3.14 x64 | **No Windows ARM64 wheel listed** |
| `cffi==2.1.1` | [Upstream PyPI release](https://pypi.org/project/cffi/2.1.1/), `cp314-cp314-win_amd64` / `win_arm64` | ARM64 wheel listed |
| `pycparser==3.0` | [Upstream PyPI release](https://pypi.org/project/pycparser/3.0/), `py3-none-any` | Pure Python |

The dependency edges are recorded in [pdfplumber's pinned requirements](https://raw.githubusercontent.com/jsvine/pdfplumber/v0.11.10/requirements.txt), [pdfminer.six's pinned metadata](https://raw.githubusercontent.com/pdfminer/pdfminer.six/20260107/pyproject.toml), [cryptography's pinned metadata](https://raw.githubusercontent.com/pyca/cryptography/50.0.2/pyproject.toml) and [CFFI's pinned metadata](https://raw.githubusercontent.com/python-cffi/cffi/v2.1.1/pyproject.toml). Resolve and retain actual wheel METADATA to verify this closure before freezing it; the repository currently contains no Python dependency lock.

Published x64 wheel SHA-256 values transcribed from the respective PyPI file detail pages:

| Exact wheel | Published SHA-256 |
| --- | --- |
| `pdfplumber-0.11.10-py3-none-any.whl` | `7741ea81bf165b474b153e6789d10d18e06b6ddcf3ec84289c3ef2fed6802580` |
| `pdfminer_six-20260107-py3-none-any.whl` | `366585ba97e80dffa8f00cebe303d2f381884d8637af4ce422f1df3ef38111a9` |
| `pillow-12.3.0-cp314-cp314-win_amd64.whl` | `fdafc9cce40277e0f7a0feabce0ee50dd2fa1800f3b38015e51296b5e814048d` |
| `pypdfium2-5.13.0-py3-none-win_amd64.whl` | `47dcca2a8d507b5fd24f94c3c9d48fb379430f097bc20f01beff6c963ffbcedb` |
| `charset_normalizer-3.5.2-py3-none-any.whl` | `b6b751274acb69d77b3323d6b7dbaa3c7fdfc1eb829b7eb61d262f32e1af9685` |
| `cryptography-50.0.2-cp311-abi3-win_amd64.whl` | `7afa5a6602a9f29af1f3a2965f831bae7c9d5d597b7cbb716d41ab3b7d89879c` |
| `cffi-2.1.1-cp314-cp314-win_amd64.whl` | `3222ba5d678f80a030e6afbcc33dc1ae5cb45facabb61cee2c7016b8432fde48` |
| `pycparser-3.0-py3-none-any.whl` | `b727414169a36b7d524c1c3e31839a521725078d7b2ff038656844266160a992` |

These are upstream metadata values, **not computed hashes of local downloads**. Capture each actual `files.pythonhosted.org` URL from the pinned PyPI file metadata during approved acquisition, retain wheel/license/attestation provenance, and verify the downloaded bytes. Some publishers provide Trusted Publishing attestations; pdfplumber, pdfminer.six, CFFI and pycparser file details did not assert that provenance, so do not label the entire wheelhouse attested.

For embedding, include package directories, native `.pyd`/DLLs, data files and `.dist-info` under a fixed app-owned `python/vendor` directory. Add that relative directory to the owned `python314._pth` alongside the original standard-library entries. Keep arbitrary external paths, PYTHONPATH and user-site packages out. The [Python path initialization reference](https://docs.python.org/3.14/library/sys_path_init.html#pth-files) explains `._pth` isolation and that `site` is not imported unless requested. This assembly is compatible in principle with `-I -B`; it still needs an actual import and helper smoke test from the packaged, relocated runtime.

The Windows helper returns `resourceLimits:false`, because Python's [`resource` module is Unix-only](https://docs.python.org/3.14/library/resource.html). The Node host supplies time/input/output bounds but the present implementation does not impose a Windows process memory/CPU job-object limit. Do not describe the Python subprocess as an OS-enforced Windows sandbox. Qualification must retain this gap.

Native Windows ARM64 PDF support also needs a qualified cryptography build. [Official cryptography build documentation](https://cryptography.io/en/latest/installation/) requires C/Rust/OpenSSL when no wheel covers the target; current documented minimum Rust is **1.83.0**. The latest docs are development-version docs, so record actual `50.0.2` source/Cargo metadata and tool versions at build time. No ARM64 compilation or compatibility success is asserted here.

## Parent actions and cross-platform capability

1. Integration freezes the real npm manifest/lock after official-registry resolution and performs the unsigned Windows x64 Electron compile/package checks. The current preview excludes native runtimes and must disclose unavailable Python helpers/production PostgreSQL. Keep GUI visual acceptance separately blocked by the earlier policy decision; producing a ZIP does not establish successful interactive operation or installation.
2. For a production-capable Windows x64 build, acquire the genuine EDB archive plus Python/wheels on an explicitly permitted build/download machine, retain provenance, assemble an inventory, and run relocated PostgreSQL init/start/SQL/stop and all three helper operations on synthetic disposable data. Alternatively the user can provide those authentic archives with vendor metadata for consumer-local validation. Neither action authorizes creating certificates, keys, OS services or startup persistence.
3. Use an existing approved Windows ARM64 machine/runner for PostgreSQL and cryptography build qualification. Do not satisfy ARM64 inventory with x64 binaries or call x64 emulation a native ARM64 pass. Native installer/upgrade/rollback, Windows ACL/DLL behavior and interactive accessibility/tray acceptance still need their own evidence.

For macOS, [PostgreSQL's official macOS entry point](https://www.postgresql.org/download/macosx/) documents EDB PostgreSQL 18 support on **macOS 13+ amd64 and arm64** and links embeddable archives. Python's [3.14.8 release](https://www.python.org/downloads/release/python-3148/) supplies a macOS installer, not a verified app-relative desktop interpreter bundle. Qualify a staged relocatable Python distribution/build, native wheel closure, Mach-O dependency paths and code signing of nested native files on approved Intel and Apple Silicon runners. No quarantine/security-setting bypass is part of this plan. A publisher-approved Apple signing identity and notarization access are prerequisites for final distribution.

For Linux, [PostgreSQL's official downloads](https://www.postgresql.org/download/linux/) route to platform packages/source; an installed system package is not automatically a relocatable application bundle. Establish real x64/arm64 app-relative PostgreSQL and Python builds/distributions, exact libc/distribution compatibility, dependent libraries and licenses, helper resource-limit behavior and AppImage/desktop/tray execution on approved native runners. No Linux or macOS execution was performed from this Windows environment. Existing six-target packaging commands/CI structure preserve those targets, but passing source configuration alone does not qualify them.

Final packages additionally require parent-approved publisher signing/notarization credentials and the pinned release-manifest identity already required by the desktop gate, plus native old-version upgrade/rollback and data/effect reconciliation qualification. No signing prerequisite is needed merely to research or build the separately labeled unsigned synthetic preview.
