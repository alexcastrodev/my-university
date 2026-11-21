---
version: 1.0
updatedAt: 2026-11-21
---
## Objective

"Which UI framework do I write a .NET client app in?" has more answers than any other question in .NET, and the answers moved a lot in ten years: Xamarin ended, UWP stopped being the future, WinUI 3 became Microsoft's recommendation for new Windows desktop apps, .NET MAUI took over the cross-platform role, and WPF and WinForms stayed alive on modern .NET. This lesson is a decision guide, not a tutorial on any of them. Everything about support and dates was read from the primary pages on 2026-11-21 (not from memory, and in two places it contradicts the backlog that sent me here). What a Mac with the .NET SDK can show was measured: which client templates exist, what the MAUI workload pulls in, WPF and WinForms projects that compile here but cannot run here, a WPF app hosting Blazor, and a Blazor WebAssembly publish. What needs Windows or a device (WinUI 3, running anything, installing the MAUI workload, which is several GB and which I did not install) is labelled docs only. It does not teach MAUI, WPF or WinForms in depth: the aim is to pick one on evidence and know what you give up.
Versions: SDK 10.0.100 (runtime 10.0.0) and SDK 11.0.100 GA (runtime 11.0.0), macOS 27.2 arm64 (Apple M4 Max, timings are from it); WPF and WinForms templates at `net10.0-windows` and `net11.0-windows`; `Microsoft.AspNetCore.Components.WebView.Wpf` 10.0.130 and 11.0.10 (NuGet, 2026-11-21); NuGet latest stable read the same day: `Microsoft.Maui.Controls` 11.0.10, `Microsoft.WindowsAppSDK` 2.7.0, `Avalonia` 12.1.6, `Uno.WinUI` 7.0.65.

## Use Cases

- Starting a new internal Windows tool and deciding between WinUI 3, WPF and WinForms.
- Deciding whether to keep, port or rewrite a WPF or WinForms application.
- Choosing a stack for an app that must run on phones and desktops from one C# codebase.
- Reusing a web team's Razor or JavaScript skills in a native shell (Blazor Hybrid, `HybridWebView`).
- Finding a .NET option for a Linux desktop app, and judging third-party frameworks honestly.
- Checking support dates before promising a client "five years on this framework".

## Deep Dive

### What Microsoft says today (the Windows developer FAQ)

The primary source is the Windows App Development FAQ on Microsoft Learn. The page footer said "Last updated 2026-11-18" when I read it (the backlog quoted 2026-10-02, so it changed since). What it says, in the order of the decision:

- "If you're building a new general-purpose Windows desktop app, we recommend using WinUI 3." WinUI 3 ships with the Windows App SDK, runs on Windows 10 version 1809 and later, and cannot be used without the Windows App SDK.
- WPF: "Is WPF deprecated? No." It keeps receiving feature, performance, accessibility and Fluent-style work on modern .NET, but "for new general-purpose Windows desktop apps, Microsoft's primary recommendation is WinUI 3". A WPF app on .NET 9 or later can use the Fluent theme (Windows 11 look, light and dark, accent color).
- WinForms: not deprecated, "continues to receive feature updates" (async forms and dialogs, dark mode, accessibility, high DPI, clipboard, designer). Both have public roadmaps on GitHub.
- Cross-platform: "teams expecting to target multiple platforms should start with .NET MAUI or React Native for Desktop". It answers "can I start with WinUI 3 and add MAUI later?" with "Not at this time". On Windows, a MAUI app's output uses WinUI 3.
- UWP and WinUI 2 are "not formally deprecated" (UWP on modern .NET with Native AOT is generally available and the default C# UWP project in Visual Studio 2026), but new desktop apps should use WinUI 3. UWP stays the answer for Xbox, HoloLens 2D apps and the standard Surface Hub environment.
- Blazor Hybrid can be hosted by MAUI, WPF and WinForms (`BlazorWebView`), but not by .NET Framework WPF or WinForms. MAUI has had `HybridWebView` since .NET 9 to host any JavaScript UI (Angular, React, Vue).
- The page's own examples: Microsoft Photos is a WinUI 3 app (migrated from UWP), and "most of the Visual Studio UI is built with WPF".
- WinUI 3 limits it states: no UI designer in Visual Studio ("Not currently", use XAML Hot Reload and the live tree); XAML builds need MSBuild (`dotnet build` works, Visual Studio is not required); packaged versus unpackaged is a real decision (some features need package identity); framework-dependent apps need the Windows App SDK runtime installed.

The Windows App SDK support page (dated 2026-09-24) lists Windows App SDK 2 released 2026-04-29, 1.8 on 2025-09-09, 1.7 on 2025-03-18 and 1.6 on 2024-09-04; NuGet shows `Microsoft.WindowsAppSDK` 2.7.0 published 2026-11-17. WinUI 3 is docs only here: it needs Windows to build, and I did not read or run a WinUI 3 project.

### Support dates, from the sources

```text
.NET MAUI 11   released 2026-11-10  latest patch 11.0.10 (2026-11-11)  end of support 2028-05-09
.NET MAUI 10   released 2025-11-11  latest patch 10.0.130 (2026-11-09) end of support 2027-05-11
.NET MAUI 9    end of support 2026-05-12      Xamarin (all SDKs, Xamarin.Forms)  ended 2024-05-01
.NET 10 (LTS) and .NET 11 (STS)  both end 2028-11-14   (.NET support policy page, last updated 2026-11-10)
```

The MAUI policy page (last updated 2026-11-11) confirms the backlog: MAUI 10 is supported until 2027-05-11, and MAUI 11 until 2028-05-09. Two consequences that are easy to miss. First, MAUI has no LTS: a release is supported 18 months here, and the policy promises "a minimum of 6 months after a successor ships", so MAUI 10 ends 18 months before the .NET 10 runtime it runs on. A MAUI app on .NET 10 LTS therefore does not get three years of MAUI servicing; plan one major MAUI upgrade a year. Second, the support is for the latest servicing update only ("To receive technical support from Microsoft, you need to be on the latest servicing level"), patched monthly with the rest of .NET. For WPF and WinForms, they are the `Microsoft.WindowsDesktop.App` framework inside the .NET runtime (the apphost error below names it), so they follow the .NET release's dates (the [lifecycle concept](/dotnet-concepts/dotnet-support-lifecycle-and-choosing-a-target) covers them), and I found no separate framework-level end date for them. For Windows App SDK, support requires a supported release and a supported Windows servicing channel, per the page above.

What .NET 11 brought to MAUI (the what's new page, dated 2026-09-10): CoreCLR is the default runtime on all platforms (Mono stays available, NativeAOT is opt-in), Android minimum API raised from 21 to 24, Material 3 handlers on Android, test project templates (`androidtest`, `iostest`, ...) and the `HybridWebView` source-generated JSON option for trimming. The page's headline is "improve product quality", not new surface. For WPF, the .NET 11 page (still titled "RC 1", dated 2026-09-17 when I read it, even though .NET 11 is GA) lists three bug fixes (ijwhost.dll for self-contained apps, DWM crash prevention, a `WeakEventTable` fix). For WinForms it lists more: `Application.SetDefaultVisualStylesMode` and `VisualStylesMode.Net11`, `KioskModeManager`, `Application.SystemVisualSettings`, `FormRevealMode`, `SuspendPainting`, a toggle-switch `CheckBox`, and warns that the new rendering "isn't final yet" until GA. On .NET 10, WinForms made `Form.ShowAsync` and dark mode (`Application.SetColorMode`) non-experimental and shared the clipboard code with WPF; WPF 10 added Fluent styles to more controls ("still in progress") and performance work. Read that as "maintained, slowly evolving", which is what the FAQ claims, and the opposite of a framework being rewritten.

### What the SDK shows on macOS arm64 (measured)

`dotnet new list` filtered to client templates, same output on both SDKs unless noted:

```text
SDK 10.0.100:  blazor, blazorwasm, winforms, winformslib, winformscontrollib, wpf, wpflib, wpfcustomcontrollib, wpfusercontrollib
SDK 11.0.100:  the same, plus blazorwebworker and blazorwasm-servicedefaults
dotnet new list maui | blazorhybrid | winui   ->  "No templates found" (both SDKs)
```

There is no MAUI, Blazor Hybrid or WinUI template without the MAUI workload (WinUI 3 templates come from Visual Studio or the Windows App SDK tooling, docs only). A trap: `dotnet new search blazorhybrid` finds a package whose short name is `blazorhybrid` on NuGet.org: "Experimental Mobile Blazor Bindings Hybrid App" (`Microsoft.MobileBlazorBindings.Templates`), which is not the MAUI Blazor template. The workload listing (not installed, docs only for the install itself):

```text
dotnet workload search  ->  maui, maui-android, maui-desktop, maui-ios, maui-maccatalyst, maui-mobile, maui-tizen, maui-windows (plus android, ios, maccatalyst, macos, tvos, wasm-tools ...)
manifest read from disk, SDK 11.0.100:  maui extends maui-mobile + maui-desktop; maui-windows extends maui-blazor; 14 packs
    (Microsoft.Maui.Controls, Core, Essentials, Graphics, Resizetizer, WebView.Maui, Sdk.net11 and net10, Templates.net11 and net10 ...)
manifest read from disk, SDK 10.0.100:  maui packs 10.0.110 (Sdk.net10 and net9)
```

Two findings. The MAUI manifest bundled in my SDK 11.0.100 GA lists pack versions `11.0.0-preview.6.26360.8`, while NuGet has `Microsoft.Maui.Controls` 11.0.0 GA (2026-11-10) and 11.0.10: a fresh MAUI install needs the manifest update (`dotnet workload update`, docs only here) to reach the GA packs. And the `maui` workload is the only way to get the templates, the iOS and Android packs and the Windows target, so "MAUI works on a CI agent" is a workload-install question, not a package-restore one (measured size: not measured, the brief calls it several GB). The SDK 10.0.100 on this machine already had `android` and `ios` workloads installed by someone else; I did not touch them.

WPF and WinForms compile on macOS if you ask. Without the property the build stops in 0.15 s:

```text
error NETSDK1100: To build a project targeting Windows on this operating system, set the EnableWindowsTargeting property to true.
```

With `-p:EnableWindowsTargeting=true` (the `dotnet new wpf` and `winforms` projects, untouched, three fresh folders per cell, restore included, packs already in the NuGet cache):

```text
                 SDK 10.0.100 (net10.0-windows)     SDK 11.0.100 (net11.0-windows)
WinForms build   1.38 to 1.40 s                     1.06 to 1.08 s
WPF build        2.27 to 2.30 s                     1.61 to 1.65 s
first ever build 3.4 s (WPF, empty NuGet home)      2.6 s WPF, 0.9 s WinForms (own empty home, downloads microsoft.windowsdesktop.app.ref)
Demo.dll         WPF 7,168 B, WinForms 5,632 B (identical on both SDKs); template source 2.4 KB in 6 files (WPF), 1.8 KB in 4 files (WinForms)
```

The output has an `osx-arm64` apphost (`Mach-O 64-bit executable arm64`), and running it shows why Windows-only means Windows-only:

```text
You must install or update .NET to run this application.
Architecture: arm64
Framework: 'Microsoft.WindowsDesktop.App', version '10.0.0' (arm64)
No frameworks were found.
```

So a Mac or a Linux CI agent can compile, run analyzers and build libraries for WPF and WinForms, and cannot run or test the UI (the `NETSDK1100` page documents the property). The timing gap between 10 and 11 is a build-tool difference measured on one machine, three runs each; it says nothing about run-time performance.

### Blazor Hybrid, and Blazor in the browser

Blazor Hybrid runs Razor components in the app process (no WebAssembly) and renders into an embedded web view through a local interop channel. The Blazor Hybrid page lists the hosts: MAUI (`BlazorWebView` is built in), WPF and WinForms (`BlazorWebView` controls from `Microsoft.AspNetCore.Components.WebView.Wpf` and `.WindowsForms`). Measured here: I followed the WPF tutorial (SDK `Microsoft.NET.Sdk.Razor`, a `Counter.razor`, `wwwroot/index.html`, `AddWpfBlazorWebView()`) and it compiled on macOS, 0 warnings:

```text
SDK 11.0.100  net11.0-windows10.0.17763.0  WebView.Wpf 11.0.10   built in 4.4 s (first restore of the packages)
SDK 10.0.100  net10.0-windows10.0.17763.0  WebView.Wpf 10.0.130  built in 5.2 s
bin folder (Debug) 27.6 MB, with Microsoft.Web.WebView2.Wpf.dll, Microsoft.AspNetCore.Components.WebView.dll ...
```

The tutorial requires a Windows-versioned TFM (`-windows10.0.17763.0`) since .NET 10 because of the switch to `WebView2CompositionControl`. Running it needs Windows (docs only). What this buys you: a WPF or WinForms app can add new screens in Razor and later share them with MAUI or the web, without a rewrite. See [Blazor render modes and hosting models](/dotnet-concepts/blazor-render-modes-and-hosting-models) for how the same components behave in the server, WebAssembly and static modes.

The no-install alternative is Blazor in the browser. `dotnet new blazorwasm` and `dotnet publish -c Release` on SDK 11.0.100 worked without any workload, in 15.0 s: 19,648,824 bytes of files in `wwwroot` and 4,368,332 bytes of brotli copies. A browser app has no installer, no store and no OS targets, and no native device APIs beyond what the browser exposes; the [WebAssembly client concept](/dotnet-concepts/blazor-webassembly-client-and-api-integration) covers its API side and [choosing an ASP.NET Core application model](/dotnet-concepts/choosing-an-aspnet-core-application-model) when a web app is the right shape.

### Third-party options (short, with state read from the sources)

| | Avalonia | Uno Platform |
|---|---|---|
| Model | Own XAML and rendering (Skia), WPF-like | WinUI 3 API compatible, renders with Skia on every target |
| Targets | Windows, macOS, Linux, iOS, Android, WebAssembly | mobile, web, desktop, embedded |
| Latest read | 12.1.6 (2026-11-09); 12.0.0 on 2026-04-07 | 7.0.65 on NuGet (2026-11-13) |
| Licence, repo | MIT, about 31.9k GitHub stars | Apache-2.0, about 10.1k stars |
| Linux | Tier 1: Ubuntu 25.xx, Fedora 43, Debian 13; Wayland opt-in since 12.1.0 | not checked (the docs intro names desktop and Skia rendering) |
| Source | Avalonia "Supported platforms" docs | Uno docs intro, NuGet, GitHub API |

For comparison, `dotnet/maui` has about 23.3k stars, `microsoft-ui-xaml` about 8.6k, `dotnet/wpf` about 7.8k and `dotnet/winforms` about 4.9k (GitHub API, 2026-11-21): stars are popularity, not usage, and are here only so a reader sees the scale. Avalonia's own docs tier its platforms (Tier 1 is tested every release; Tier 2 best effort; Tier 3 commercial support only), which is a candid way to read "supported". I did not build with either (docs only, plus NuGet and GitHub metadata). The .NET 11 first-app page describes `dotnet new maui-multiproject --avalonia`, which adds an Avalonia desktop project for Windows, macOS and Linux next to the MAUI project: docs only, not run (it needs the workload).

### The decision table

| Situation | Recommendation | Source |
|---|---|---|
| New Windows-only desktop app | WinUI 3 + Windows App SDK; WPF if the team knows it and the requirements fit | Windows FAQ (2026-11-18) |
| Existing WPF or WinForms | Keep; move from .NET Framework to modern .NET; add Razor screens with `BlazorWebView` if needed | Windows FAQ; WPF and WinForms .NET 10 and 11 pages; [porting concept](/dotnet-concepts/porting-from-net-framework-to-modern-net) |
| Phones and desktops, one C# codebase | .NET MAUI (start with MAUI, not WinUI 3, per the FAQ), upgrade yearly | MAUI support policy (11 until 2028-05-09) |
| Web skills (Razor or JavaScript) | Blazor Hybrid in MAUI, WPF or WinForms; `HybridWebView` for JS UIs; Blazor in the browser; React Native for Desktop for JS teams | Blazor Hybrid page; Windows FAQ |
| Linux desktop | Avalonia (or Uno); MAUI documents no Linux target | Avalonia platforms page; "What is MAUI" |
| Xbox, HoloLens 2D, standard Surface Hub | UWP | Windows FAQ |
| Zero-install, broadest reach | Blazor or another web app (PWA) | Windows FAQ |

The XAML frameworks in this table (WinUI 3, WPF, MAUI, Avalonia, Uno) share the same UI pattern, so what you learn about data binding and commands carries between them: see [MVVM and CommunityToolkit.Mvvm](/dotnet-client-apps-concepts/mvvm-and-communitytoolkit-mvvm).

### Market: what I could and could not verify

The backlog says the job market for new WPF, WinForms and MAUI roles is medium-low, and I also expected "WPF and WinForms still dominate legacy" to be easy to source. I did not find data for either. The Stack Overflow Developer Survey 2026 (and 2025) lists web frameworks, and Blazor appears at 6.7% of 10,281 respondents (ASP.NET Core 19.9%) in 2026; WPF, WinForms, MAUI, Avalonia and Uno are not among the surveyed technologies, so the survey cannot rank them. I did not query job boards. The only usage evidence in the sources is the FAQ's own examples (Visual Studio's UI in WPF, Photos in WinUI 3), which show these frameworks are used for large products, not how many jobs exist. Treat "dominates legacy" as plausible and unmeasured.

### Book vs today

- **Xamarin.Forms and "UWP is the future".** Older books teach Xamarin.Forms for cross-platform and UWP plus WinUI 2 for Windows. Xamarin support ended on 2024-05-01 for every SDK including Xamarin.Forms, and MAUI is its evolution; UWP is "not formally deprecated" but new desktop apps are told to use WinUI 3, and WinUI 2 is a UWP-only library that is not compatible with WinUI 3.
- **WPF and WinForms are dead.** The FAQ answers "not deprecated" in both cases and the .NET 10 and 11 pages show ongoing changes (small for WPF, larger for WinForms). What changed is the recommendation for greenfield work, not the support.
- **.NET Framework 4.x WPF.** Still the shape of most older books. Blazor Hybrid in WPF or WinForms is not supported there, only on modern .NET.
- **Windows App SDK 1.x.** Tutorials from 2022 to 2025 show 1.x; the support page lists 2 (2026-04-29) and NuGet shows 2.7.0 on 2026-11-17, so check the version before copying a project file.

## Trade-offs

- **WinUI 3 is the recommended path and the narrowest.** Windows only, Windows 10 1809 or later, no Visual Studio designer, packaging and Windows App SDK runtime decisions up front. If the same app may ever need a phone, the FAQ says start with MAUI, because WinUI 3 cannot later "integrate MAUI". Example: an internal tool for 200 managed Windows 11 laptops fits WinUI 3 or WPF; a field-service app for tablets and phones does not.
- **WPF and WinForms are the safest for existing code and the least fashionable for new code.** Supported and evolving, but the WPF .NET 11 page lists only bug fixes and the headline modern-look work is WinForms' new visual styles, which the page itself marks as not final. Choose them when the team's skills and the existing code outweigh the recommendation.
- **MAUI buys reach and sells an 18-month clock.** One codebase for Android, iOS, macOS and Windows, but each major release is supported until 18 months after its own release, so the app is on a yearly upgrade treadmill, while .NET 10 LTS lasts until 2028-11-14. The Windows target is WinUI 3 underneath, and there is no Linux target in the docs.
  ```text
  MAUI 10 ends 2027-05-11, .NET 10 ends 2028-11-14: 18 months of runtime without MAUI servicing.
  ```
- **Blazor Hybrid shares UI, not native feel.** Razor components render in a web view, so styles can differ per platform, and the page itself warns about platform differences. It is a way to reuse web skills inside a native shell, not a replacement for platform controls.
- **Browser apps need no install and cannot reach the device.** Blazor WebAssembly published 19.6 MB uncompressed (4.4 MB brotli) for the template app here; fine for a line-of-business tool on a good network, a cost on mobile networks.
- **Third-party frameworks trade vendor backing for reach.** Avalonia and Uno cover Linux and WebAssembly, which MAUI does not, but they are separate projects with their own release cadence and support terms (Avalonia's tiers say so in writing). Evaluate their maintainers like any dependency before betting a product on them.
- **A Mac can compile Windows UI and cannot test it.** `EnableWindowsTargeting` makes CI on Linux or macOS useful for builds and library tests; UI tests need Windows runners.

## Documentation Links

- [Windows App Development Frequently Asked Questions, Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/get-started/windows-developer-faq) (doc)
- [.NET MAUI support policy, .NET](https://dotnet.microsoft.com/en-us/platform/support/policy/maui) (doc)
- [Xamarin support policy, .NET](https://dotnet.microsoft.com/en-us/platform/support/policy/xamarin) (doc)
- [.NET and .NET Core support policy, .NET](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core) (doc)
- [Windows App SDK and supported Windows releases, Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/support) (doc)
- [What's new in .NET MAUI for .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/maui/whats-new/dotnet-11) (doc)
- [What is .NET MAUI?, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/maui/what-is-maui) (doc)
- [Build your first .NET MAUI app, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/maui/get-started/first-app?view=net-maui-10.0) (doc)
- [What's new in Windows Forms for .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/desktop/winforms/whats-new/net110) (doc)
- [What's new in Windows Forms for .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/desktop/winforms/whats-new/net100) (doc)
- [What's new in WPF for .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/whats-new/net110) (doc)
- [ASP.NET Core Blazor Hybrid, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/hybrid/?view=aspnetcore-10.0) (doc)
- [Build a WPF Blazor app, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/hybrid/tutorials/wpf?view=aspnetcore-10.0) (doc)
- [NETSDK1100: building Windows-targeted projects on other operating systems, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/sdk-errors/netsdk1100) (doc)
- [Upgrade from Xamarin to .NET MAUI, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/maui/migration/) (doc)
- [Supported platforms, Avalonia documentation](https://docs.avaloniaui.net/docs/overview/supported-platforms) (doc)
- [Uno Platform documentation](https://platform.uno/docs/articles/intro.html) (doc)
- [WPF roadmap, GitHub](https://github.com/dotnet/wpf/blob/main/roadmap.md) (doc)
- [Windows Forms roadmap, GitHub](https://github.com/dotnet/winforms/blob/main/docs/roadmap.md) (doc)
- [Technology, Stack Overflow Developer Survey 2026](https://survey.stackoverflow.co/2026/technology) (doc)
