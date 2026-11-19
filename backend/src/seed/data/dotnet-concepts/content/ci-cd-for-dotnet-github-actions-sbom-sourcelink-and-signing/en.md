---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

A CI pipeline for .NET is a chain of small guarantees: the same restore every time, a build that fails on style and warnings, tests with a coverage floor, a package whose binary can be traced to a commit, a bill of materials, and a push that needs no long-lived secret. Every link here was run on a toy library (`Acme.Slugs`, two TFMs, MSTest) and the commands and outputs are real. What only GitHub can run (the hosted runner, the cache action, OIDC, attestations) is marked docs only. Packaging basics, Central Package Management, audit and lock files are in [packaging-and-publishing-a-nuget-library](packaging-and-publishing-a-nuget-library), [central-package-management-and-package-source-mapping](central-package-management-and-package-source-mapping) and [nuget-supply-chain-audit-lock-files-and-publish-age](nuget-supply-chain-audit-lock-files-and-publish-age); this concept wires them into a pipeline.

Versions (checked on 2026-11-19): SDK 10.0.100, `net10.0` and `net8.0`; `MSTest` 4.5.3, `Microsoft.NET.Test.Sdk` 18.12.0, `coverlet.collector` and `coverlet.msbuild` 10.1.1, `ReportGenerator` 5.6.0, `MinVer` 8.0.0, `Microsoft.SourceLink.GitHub` 11.0.100, `Microsoft.Testing.Extensions.CodeCoverage` 18.12.0, `CycloneDX` tool 6.3.1, `Microsoft.Sbom.DotNetTool` 4.1.13, `sourcelink` tool 3.1.1; actions `checkout` v7.0.1, `setup-dotnet` v6.1.0, `upload-artifact` v7.0.2, `download-artifact` v8.0.2, `attest` v4.2.2, `NuGet/login` v1.2.0; `actionlint` 1.7.12.

## Use Cases

- A library repository that must publish a signed, traceable package from a tag with no stored API key.
- A pull request gate: locked restore, format, warnings as errors, tests on two operating systems, a coverage floor.
- Proving to a customer or auditor what went into a release (SBOM) and that it was built from a given commit.

## Deep Dive

### The minimal pipeline, and what each step costs

The toy repository has `Directory.Build.props` (nullable, `TreatWarningsAsErrors`, `NuGetAudit` mode `all`, `RestorePackagesWithLockFile`) and a `CI` condition: GitHub sets `CI=true`, so `ContinuousIntegrationBuild` and `RestoreLockedMode` switch on only there. I measured each step locally, three runs for restore:

```text
dotnet restore, empty packages folder      2.52 s, 2.37 s, 2.69 s   (24 packages, 320 MB)
dotnet restore, packages folder kept       0.48 s, 0.48 s, 0.49 s
dotnet build -c Release --no-restore       1.77 s
dotnet test -c Release --no-build          Passed 4/4 on net10.0, Passed 4/4 on net8.0
```

The cache saves the download (about 2 s here, minutes on a big graph and a slow network), not the build. `actions/setup-dotnet` with `cache: true` hashes `packages.lock.json` into the key (docs only, I could not run a hosted runner), which is why the lock file matters twice: determinism and cache key. Locked mode is the gate: raising one version in `Directory.Packages.props` without regenerating the lock gave `error NU1004 ... The package reference ... lock file`, and `CI=true dotnet restore` passed on the committed lock files. `dotnet format --verify-no-changes` exited 0 on clean code, and 2 after I added a badly formatted file (`error WHITESPACE: Fix whitespace formatting`), so it is a real gate (see [analyzers-editorconfig-and-build-quality-gates](analyzers-editorconfig-and-build-quality-gates)).

The test job of the workflow (the full file, with pack and publish jobs, passed `actionlint` 1.7.12 with exit 0; a typo in a runner label made it report `label "ubuntu-lates" is unknown`):

```yaml
name: ci
on:
  push: { branches: [main], tags: ['v*'] }
  pull_request:
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.ref_type != 'tag' }}   # never cancel a release
permissions:
  contents: read                                         # least privilege by default
jobs:
  test:
    runs-on: ${{ matrix.os }}
    timeout-minutes: 15
    strategy:
      fail-fast: false
      matrix: { os: [ubuntu-latest, windows-latest] }
    steps:
      - uses: actions/checkout@v7
        with: { fetch-depth: 0 }                         # MinVer needs tags and history
      - uses: actions/setup-dotnet@v6
        with: { global-json-file: global.json, cache: true, cache-dependency-path: '**/packages.lock.json' }
      - run: dotnet restore --locked-mode
      - run: dotnet format --verify-no-changes --no-restore
      - run: dotnet build -c Release --no-restore
      - run: dotnet test -c Release --no-build --collect:"XPlat Code Coverage" --results-directory TestResults
```

The TFM matrix is not in the YAML: the test project has `<TargetFrameworks>net10.0;net8.0</TargetFrameworks>`, so one `dotnet test` ran both (the two `Passed!` lines above). A matrix is for operating systems; a TFM matrix only pays off when you need a different runtime per job (see [multi-targeting-and-netstandard](multi-targeting-and-netstandard)). Two details people forget: `timeout-minutes` (the default job limit is far longer than you want to pay for a hung test) and `cancel-in-progress` guarded for tags, so a new push cancels the old pull request run but never a release.

### Coverage: collector, ReportGenerator and a gate that fails

`--collect:"XPlat Code Coverage"` runs the `coverlet.collector` data collector and writes one `coverage.cobertura.xml` per TFM under `TestResults/<guid>/`. Both TFMs reported `lines-covered="7" lines-valid="11"` and 10 of 14 branches, because `Truncate` has no test on purpose. ReportGenerator merged the two files (`Parser: MultiReport (2x Cobertura)`) and printed `Line coverage: 63.6%`, `Branch coverage: 71.4% (10 of 14)`; `-reporttypes:MarkdownSummaryGithub` wrote a table you can append to `$GITHUB_STEP_SUMMARY`. Its method coverage cell says "Feature is only available for sponsors", so do not build a gate on it.

The collector has no gate: the coverlet docs state the VSTest integration does not support threshold validation, and I measured the property that does, on `coverlet.msbuild`:

```text
dotnet test /p:CollectCoverage=true /p:Threshold=60 /p:ThresholdType=line /p:ThresholdStat=total   exit 0
dotnet test ... /p:Threshold=80 ...   exit 1  "The total line coverage is below the specified 80"
dotnet test ... /p:Threshold=\"90,70\" /p:ThresholdType=\"line,branch\" /p:ThresholdStat=minimum   exit 1  "The minimum line coverage is below the specified 90"
```

`ThresholdStat` is `minimum` (each module), `total` or `average`. The Debug run reported 64.7% and the Release run 63.63% for the same code: coverage depends on the configuration, so gate on the one CI builds.

With the .NET 10 `dotnet test` in Microsoft.Testing.Platform mode (MTP) the collector is replaced. A project on `MSTest.Sdk` 4.5.3 plus `"test": { "runner": "Microsoft.Testing.Platform" }` in `global.json` runs with `dotnet test --project tests/Mtp.csproj`, and the SDK pulled `Microsoft.Testing.Extensions.CodeCoverage` 18.12.0 and `Microsoft.Testing.Extensions.TrxReport` 2.5.3 by itself. Coverage is three flags: `--coverage --coverage-output-format cobertura --coverage-output cov.xml --results-directory TR`, which wrote `TR/cov.xml` with the same 7/11 lines and 10/14 branches. Its `--help` lists no threshold option (formats: `coverage`, `xml`, `cobertura`), so with MTP the gate is yours. Six lines over the merged file worked:

```python
import sys, xml.etree.ElementTree as E
r = float(E.parse('coveragereport/Cobertura.xml').getroot().get('line-rate'))
sys.exit(0 if r >= 0.8 else f'line coverage {r:.1%} is below 0.8')
# measured: 0.6 -> exit 0; 0.8 -> exit 1 with the message above
```

A coverage number is a floor against deleting tests, not a quality measure ([four-pillars-of-a-good-unit-test](/java/testing/four-pillars-of-a-good-unit-test)); integration tests go in the same job or a second one ([integration-testing-with-webapplicationfactory](/dotnet-testing-concepts/integration-testing-with-webapplicationfactory)).

### Deterministic builds: what changes the hash

The compiler is deterministic by default (`Deterministic` was `true` in my project), yet identical sources do not give identical binaries on two machines. I packed the same commit with `dotnet pack -c Release -p:Version=1.0.0` from a clean `obj` and compared SHA-256 of `lib/net10.0/Acme.Slugs.dll`:

```text
same folder, packed twice, no flag                    d6cd1b0d97dcf7f1  d6cd1b0d97dcf7f1  (equal)
two clones at different paths, no flag                d6cd1b0d97dcf7f1  58136ea992724e0a  (DIFFERENT)
two clones at different paths, ContinuousIntegrationBuild=true
                                                      30116b4d92dd65fa  30116b4d92dd65fa  (equal; PDB too: 8f24c381bc9a9dcf)
```

The difference is the path baked into the DLL: the debug directory points at the PDB, `.../det/a/src/Acme.Slugs/obj/Release/net10.0/Acme.Slugs.pdb` without the flag and `/_/src/Acme.Slugs/obj/Release/net10.0/Acme.Slugs.pdb` with it. `ContinuousIntegrationBuild=true` turns on `DeterministicSourcePaths`, which rewrites the checkout root to `/_/` (the same effect as a manual `PathMap`). `dotnet msbuild -getProperty:ContinuousIntegrationBuild` printed empty by default and `true` with the `CI=true` environment variable. Set it only in CI: locally it breaks the debugger's source mapping to your real paths, which is why the toy sets it under `Condition="'$(CI)' == 'true'"`.

The `.nupkg` itself is not byte-identical even then (`48d8d345...` against `9b0001b0...`). Entry by entry, the two DLLs and the nuspec had equal hashes, while `_rels/.rels`, the `.psmdcp` file name (a fresh GUID) and the zip timestamps differed. So compare the contents of the entries, not the package hash, when you verify a rebuild.

### SourceLink in the PDB, and what `DebugType` changes

SDK 10 includes SourceLink for GitHub, Azure Repos, GitLab and Bitbucket: with no package at all, `PublishRepositoryUrl=true`, `EnableSourceLink=true` and `EmbedUntrackedSources=true` were already the evaluated values. The snupkg PDB held, read with `dotnet sourcelink print-json`:

```json
{"documents":{"/_/*":"https://raw.githubusercontent.com/acme/slugs/0a023bb3b3388be54b571df012c84773daff1730/*"}}
```

The commit comes from the repository, the URL from the `origin` remote. `print-urls` expands each document, for example `.../0a023bb.../src/Acme.Slugs/Slugger.cs`. `dotnet sourcelink test` fetches every URL and compares checksums; on my fake `github.com/acme/slugs` it failed with `url failed NotFound`, which is the correct answer and the reason to run it against a real released package. I also read the PDB with `System.Reflection.Metadata` (the SourceLink and embedded-source custom debug information GUIDs): `Slugger.cs` was listed as a plain document, and the three generated files under `obj/` (`GlobalUsings.g.cs`, `AssemblyInfo.cs`, `AssemblyAttributes.cs`) as `EMBEDDED`, because no URL can serve them. That is `EmbedUntrackedSources`.

Adding `Microsoft.SourceLink.GitHub` 11.0.100 on top changed the DLL hash and, in my run, the generated files were no longer embedded; I did not find out why, so check the effect on your SDK before pinning the package. It also printed `System.IO.Hashing 11.0.0 doesn't support net8.0` for the `net8.0` target, silenced by `SuppressTfmSupportBuildWarnings`. On SDK 10 the package is optional.

`DebugType`: `portable` (default) plus `snupkg` keeps the DLL small and the symbols in a second file the feed must host. `embedded` put the PDB inside the DLL (5,120 bytes became 12,288 for `net10.0`), and `dotnet pack` then failed with `NU5017: Cannot create a package that has no dependencies nor content` for the empty snupkg, while the `.nupkg` was still written. Pick one: embedded (simple, bigger DLLs, nothing to host) or portable with `snupkg`.

### Versions from git tags

`MinVer` 8.0.0 derives the version from the nearest tag and the commit height; Nerdbank.GitVersioning (3.10.94 stable) reads a `version.json` committed in the repository and stamps the git height and commit id. In three lines: MinVer has no file and no setup beyond the tag prefix, so the tag is the release and a release is one `git tag`; NBGV has a file, so the base version and its prerelease label are reviewed in a pull request and a commit has a stable version without tags; both need full history (`fetch-depth: 0`). I measured MinVer (tag prefix `v`, version read with `dotnet msbuild -t:MinVer`, because MinVer sets `Version` inside a target and a plain `-getProperty:Version` returned the stale `1.0.0` from my first attempt):

```text
no tag                                  0.0.0-alpha.0.4
tag v1.0.0, three commits back          1.0.1-alpha.0.3
  + MinVerDefaultPreReleaseIdentifiers=preview.0     1.0.1-preview.0.3
  + MinVerMinimumMajorMinor=2.0                      2.0.0-alpha.0.3
  + MinVerAutoIncrement=minor                        1.1.0-alpha.0.3
HEAD tagged v1.1.0-rc.1                 1.1.0-rc.1
HEAD tagged v1.1.0 (dirty working tree) 1.1.0     (no dirty marker)
```

`dotnet pack` on the tagged commit wrote `Acme.Slugs.1.1.0.nupkg` and the `.snupkg` with no `-p:Version`. A shallow clone (`--depth 1`, what `actions/checkout` does by default) has no tags: MinVer returned `0.0.0-alpha.0` until `git fetch --tags --unshallow`, then `1.0.1-alpha.0.3`. That is the single most common CI versioning bug. The prerelease string decides stable against prerelease: a `v1.1.0-rc.1` tag gives a prerelease package, `v1.1.0` a stable one, and the publish job runs only on tags.

### Vulnerabilities in the build

`NuGetAudit` is on by default and runs during restore. I referenced `Newtonsoft.Json` 12.0.3 in a throwaway app:

```text
warning NU1903: Package 'Newtonsoft.Json' 12.0.3 has a known high severity vulnerability, https://github.com/advisories/GHSA-5crp-9r3c-p9vr
dotnet list package --vulnerable --include-transitive      -> table with "High", exit 0 (dotnet build also succeeded, warning printed)
restore with TreatWarningsAsErrors=true or WarningsAsErrors=NU1903   -> "error NU1903: Warning As Error: ...", exit 1
restore with NuGetAuditLevel=critical                      -> no warning (the advisory is high)
```

Two traps: `dotnet list package --vulnerable` reports and exits 0, so it is not a gate; and the warning alone does not fail the build. The gate is `NuGetAuditMode=all` (transitive too) plus warnings as errors for `NU1901` to `NU1904` (low, moderate, high, critical), as the toy's `Directory.Build.props` does. Detail on suppressions and `direct` mode is in the supply chain concept.

### SBOM: what it is and what two tools produced

A software bill of materials lists the components in a build, with versions, hashes and licenses, so you can answer "are we affected?" when a new advisory lands. CycloneDX (ECMA-424, JSON or XML, built for security use) and SPDX (ISO/IEC 5962:2021, strong on licensing) are the two formats; both are accepted by scanners. The `CycloneDX` tool (spec 1.7 by default, 0.5 s here):

```text
dotnet dotnet-CycloneDX tests/Acme.Slugs.Tests/Acme.Slugs.Tests.csproj -o sbom -F Json -fn tests.cdx.json
-> 22 components, e.g. MSTest 4.5.3, pkg:nuget/MSTest@4.5.3, hash SHA-512 b76b51b5fe7e2820..., license MIT
dotnet dotnet-CycloneDX src/Acme.Slugs/Acme.Slugs.csproj ...
-> 1 component: MinVer 8.0.0, scope "excluded", SHA-512 69870369..., license Apache-2.0
```

The scope was `excluded` for every dev or test dependency: they are not in what ships. The SHA-512 is the hash of the `.nupkg` file: it matched the `.nupkg.sha512` in the global packages folder (MSTest `b76b51b5fe7e2820`), not the `contentHash` in `packages.lock.json` (`aaffb1d330bb3316`), which is a different hash, so the two cannot be compared byte for byte. `Microsoft.Sbom.DotNetTool` (SPDX 2.2) works on the output folder: `dotnet sbom-tool generate -b out -bc src/Acme.Slugs -pn Acme.Slugs -pv 1.0.1-alpha.0.3 -ps Acme -nsb https://example.org/sbom` wrote `out/_manifest/spdx_2.2/manifest.spdx.json` plus its `.sha256` in 1.7 s. In a clean clone it listed 5 packages (`MinVer` 8.0.0, the `net8.0` targeting packs `Microsoft.NETCore.App.Ref` and `Microsoft.AspNetCore.App.Ref` 8.0.22, the package itself and the root) and 2 files, the `.nupkg` and `.snupkg` with SHA-256 and SHA-1. In my first run, with stale `obj` files from earlier packs under the component path, it listed three versions of `Acme.Slugs`: generate from a clean build. The two tools differ on what counts as a component (the targeting packs appear only in SPDX), so pick one and keep it.

### Signing a package, measured

`dotnet nuget sign` needs a certificate with the code signing extended key usage. I made a 30-day self-signed one with `openssl req -x509 ... extendedKeyUsage=critical,codeSigning` and exported a `.pfx`:

```text
dotnet nuget sign pkg.nupkg --certificate-path signer.pfx --certificate-password ...
  warn NU3002 (no timestamper), warn NU3042 / NU3018 UntrustedRoot     (the package IS signed)
dotnet nuget verify pkg.nupkg
  Signature type: Author, Subject Name: O=Acme, CN=Acme Test Code Signing, SHA256 hash: D0D655E0...
  error: NU3018: The author primary signature's signing certificate is not trusted by the trust provider.   exit 1
verify --certificate-fingerprint D0D655E0...   -> same NU3018, exit 1 (a fingerprint does not replace trust)
replace the DLL inside the signed package      -> error NU3008: The package integrity check failed.
a certificate with serverAuth EKU              -> error NU3018: NotValidForUsage: The key usage is incorrect.
--timestamper http://invalid.localhost         -> error: Connection refused (signing aborted)
```

So a self-signed certificate signs, and `verify` reports who signed and detects tampering, but it fails the trust check: self-signed is for tests only. A real certificate, a timestamp server (without one the signature dies with the certificate) and nuget.org registration are docs only. nuget.org requires, once you register a certificate, that every later submission is signed. Signing proves who and that nothing changed (re-signing needs `--overwrite`, otherwise `NU3001`); it does not say the code is safe.

### Publishing: duplicates, prerelease, tags

A folder source takes any push and ignores `--skip-duplicate` (`warn: The option to skip duplicates is not currently supported for this type of push`), as in the packaging concept. For a real protocol I wrote a 30-line Python server on port 6760 (service index with `PackagePublish/2.0.0`, `201` on the first PUT, `409` on the same bytes again, killed afterwards) and pushed with `--allow-insecure-connections`:

```text
first push                         Created .../api/v2/package/   "Your package was pushed."   (server saw the API key header)
same package again                 Conflict ... 409,  "To skip already published packages, use the option --skip-duplicate"   exit 1
same package, --skip-duplicate     Conflict ... 409 swallowed, exit 0
```

`--skip-duplicate` is what makes a re-run of the publish job after a partial failure safe. It is not a license to overwrite: nuget.org versions are immutable (see the packaging concept).

### Trusted publishing, attestations, Sigstore (docs only)

Nothing here ran: it needs a real GitHub repository and a nuget.org account. NuGet trusted publishing replaces the stored API key. You register a policy on nuget.org with the repository owner, the repository, the workflow file name (and optionally an environment); the workflow asks GitHub for an OIDC token, `NuGet/login@v1` exchanges it at `https://www.nuget.org/api/v2/token`, and the step output `NUGET_API_KEY` is a temporary key that nuget.org documents as valid for 1 hour. The job needs `permissions: id-token: write`. This is the same idea as workload identity: a signed claim from the platform instead of a shared secret, see [workload-identity-service-accounts-mtls-and-spiffe](/identity-concepts/workload-identity-service-accounts-mtls-and-spiffe).

```yaml
  publish:
    needs: pack
    if: github.ref_type == 'tag'
    environment: nuget
    permissions: { id-token: write }
    steps:
      - uses: NuGet/login@v1
        id: login
        with: { user: ${{ vars.NUGET_USER }} }
      - run: dotnet nuget push "out/*.nupkg" -s https://api.nuget.org/v3/index.json -k "${{ steps.login.outputs.NUGET_API_KEY }}" --skip-duplicate
```

Artifact attestations (`actions/attest@v4`, with `id-token: write`, `contents: read`, `attestations: write` and `subject-path`) record build provenance for a file: which workflow in which repository built it. GitHub's concept page ties them to SLSA build levels and says it generates them with Sigstore; I did not run it and claim nothing beyond that page. Neither replaces `dotnet nuget sign`: provenance says where it was built, a NuGet signature is what the client checks on restore.

### Application pipelines and pipeline security

For an application the artifact is an image: `dotnet publish /t:PublishContainer` is in [containerizing-dotnet-sdk-publish-dockerfile-chiseled](containerizing-dotnet-sdk-publish-dockerfile-chiseled), and a single-file or AOT binary in [self-contained-single-file-and-trimmed-publishing](self-contained-single-file-and-trimmed-publishing) and [native-aot-and-its-limits](native-aot-and-its-limits). Deploy (push the image, roll the service) is docs only here and depends on your platform.

Security of the pipeline itself (prose, docs only): `pull_request` runs the merged code with a read-only token and no secrets for forks, while `pull_request_target` runs the base branch's workflow with secrets, so never check out and run the pull request's code under it. Pin third-party actions to a full-length commit SHA, because a tag can be moved (the hardening guide gives this for repositories that cannot adopt its workflow dependency lockfiles). Give the workflow `permissions: contents: read` and raise it per job. Prefer OIDC to secrets, and keep release secrets in an environment with required reviewers. Keep the pins fresh with Dependabot, whose `nuget` ecosystem (`package-ecosystem: nuget`) and `github-actions` ecosystem go in `.github/dependabot.yml`, with `schedule: {interval: weekly}` and a `cooldown` (`default-days: 7`; the docs say the default is 3 days) so a version published an hour ago is not adopted. I validated neither file against GitHub, only the workflow with `actionlint`.

### The pipeline in one table

| Step | Tool | Guarantees | How I measured | Trap |
|---|---|---|---|---|
| Restore | `--locked-mode`, `packages.lock.json` | same graph and hashes | `NU1004` on drift | cache key depends on the lock file |
| Format | `dotnet format --verify-no-changes` | style | exit 0 then 2 | needs a restored project |
| Build | `-c Release --no-restore`, warnings as errors | no new warnings | 1.77 s | audit warnings are warnings until escalated |
| Test and coverage | MSTest, `coverlet.collector` or MTP, ReportGenerator | tests pass, floor on coverage | 63.6% against a gate of 80 | the collector has no threshold; Debug and Release differ |
| Deterministic build | `ContinuousIntegrationBuild`, `Deterministic` | same DLL from any path | hash equal in two clones | the `.nupkg` bytes still differ |
| SourceLink | SDK or `Microsoft.SourceLink.GitHub` | DLL to commit | `sourcelink print-json` | `test` fails on unpublished repos |
| Version | MinVer or NBGV | version from the tag | table above | shallow clone gives `0.0.0` |
| Vulnerabilities | NuGetAudit, `list package --vulnerable` | known advisories | `NU1903` on 12.0.3 | the list command exits 0 |
| SBOM | CycloneDX, sbom-tool | inventory with hashes | 22 components, 5 packages | stale files, tool differences |
| Signing | `dotnet nuget sign` and `verify` | author and integrity | `NU3018`, `NU3008` | self-signed never verifies; no timestamp |
| Publish | `dotnet nuget push --skip-duplicate`, trusted publishing | idempotent, no stored key | 201, 409, exit 0 | OIDC and attestations are docs only |

## Trade-offs

- **Cache everything against cache nothing.** Restore fell from about 2.5 s to 0.5 s; a stale cache can hide a package removed upstream. Key on the lock file and keep `--locked-mode`.
- **Hard gates against developer flow.** Warnings as errors and a coverage floor stop regressions, and block a hotfix on a flaky analyzer update. Pin `AnalysisLevel` and tune the floor to what the code really has.
- **`ContinuousIntegrationBuild` in CI only.** Reproducible hashes need it, local debugging needs the real paths; the `CI` condition gives both.
- **Embedded or portable PDB.** Embedded is one file and no symbol feed, at about 2.4 times the DLL size here; portable plus `snupkg` is smaller and needs hosting.
- **MinVer against Nerdbank.GitVersioning.** The tag as source of truth is simpler and breaks on shallow clones; a `version.json` is reviewable and one more file to keep.
- **CycloneDX against SPDX.** Pick what your consumers' scanners read; the two tools I ran disagree on what a component is.
- **Trusted publishing against an API key.** No secret to rotate or leak, in exchange for a registered policy tied to a repository and workflow name; renaming the workflow file breaks it.

## Documentation Links

- [Create a GitHub Actions workflow to build and test .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/devops/dotnet-test-github-action) (doc)
- [Auditing packages, NuGet, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/concepts/auditing-packages) (doc)
- [Source Link and .NET libraries, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/library-guidance/sourcelink) (doc)
- [nuget sign command, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/reference/cli-reference/cli-ref-sign) (doc)
- [Code coverage with Microsoft.Testing.Platform, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-extensions-code-coverage) (doc)
- [Trusted publishing, nuget.org, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/nuget-org/trusted-publishing) (doc)
- [GitHub Actions documentation, GitHub](https://docs.github.com/en/actions) (doc)
- [Using artifact attestations to establish provenance, GitHub Docs](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds) (doc)
- [Security hardening for GitHub Actions, GitHub Docs](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions) (doc)
- [Dependabot options reference, GitHub Docs](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference) (doc)
- [actions/setup-dotnet, GitHub](https://github.com/actions/setup-dotnet) (doc)
- [NuGet/login, GitHub](https://github.com/NuGet/login) (doc)
- [coverlet, GitHub](https://github.com/coverlet-coverage/coverlet) (doc)
- [MinVer, GitHub](https://github.com/adamralph/minver) (doc)
- [Nerdbank.GitVersioning, GitHub](https://github.com/dotnet/Nerdbank.GitVersioning) (doc)
- [CycloneDX specification, cyclonedx.org](https://cyclonedx.org/) (doc)
- [Microsoft sbom-tool, GitHub](https://github.com/microsoft/sbom-tool) (doc)
