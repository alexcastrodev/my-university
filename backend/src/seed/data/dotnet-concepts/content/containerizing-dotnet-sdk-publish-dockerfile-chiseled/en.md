---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

A container image is a stack of tar layers plus a JSON config that says which user runs the process, which command starts it, which ports it listens on and which environment it sees. .NET gives you two ways to produce one. The SDK route (`dotnet publish -t:PublishContainer`) builds the image itself, with no Dockerfile and no Docker daemon, by pulling a Microsoft base image over HTTPS and adding your publish output as one layer. The Dockerfile route is a multi-stage build you write and run with Docker or another builder. The SDK route makes many decisions for you (base image, operating system, user, port, entrypoint), and some of them matter in production: which Linux you ship, whether the process runs as root, and whether the image has the ICU data your culture-sensitive code needs. This concept publishes the same ASP.NET Core app into tar archives on a machine without a Docker daemon, unpacks them and reads the manifest, the config and every layer, then compares base image families by measured size. Versions used: SDK 10.0.100 (container tooling `10.0.100-rtm.25523.111`) on an Apple Silicon Mac (`osx-arm64`), .NET runtime and ASP.NET Core 10.0.14 inside the images, base images `mcr.microsoft.com/dotnet/aspnet:10.0` (Ubuntu 24.04.5 LTS), `10.0-noble-chiseled`, `10.0-noble-chiseled-extra` and `10.0-alpine` (Alpine Linux v3.24), plus `aspnet:9.0` (Debian 12) for comparison.

## Use Cases

- Shipping an ASP.NET Core API to Kubernetes, Azure Container Apps or ECS from a CI agent that has the .NET SDK but no Docker daemon.
- Shrinking an image and its attack surface by moving from the default Ubuntu base to a chiseled (distroless) or Alpine base.
- Building one image name that runs on both x64 nodes and arm64 nodes (Graviton, Ampere, Apple Silicon dev machines).
- Deciding when the SDK route stops being enough and a hand-written Dockerfile is the better tool (OS packages, extra binaries, non-.NET build steps).

## Deep Dive

### Route 1: one command, no Dockerfile, no daemon

I created an empty app with `dotnet new web --framework net10.0` and published it as a container. Since .NET 8, `dotnet publish` uses the Release configuration by default. Pushing to the local Docker daemon is the default destination; on this machine the daemon is not reachable, and the SDK says so after building the image in memory:

```text
Building image 'hello' with tags 'latest' on top of base image 'mcr.microsoft.com/dotnet/aspnet:10.0'.
error : [Microsoft.NET.Build.Containers.DockerCli] Cannot find docker/podman executable.
error CONTAINER1012: The local registry is not available, but pushing to a local registry was requested.
```

`ContainerArchiveOutputPath` sends the image to a file instead, which needs nothing but the SDK and network access to `mcr.microsoft.com` (`-p:PublishProfile=DefaultContainer` gave the same result as `-t:PublishContainer`):

```bash
dotnet publish -t:PublishContainer -p:ContainerArchiveOutputPath=./out/default.tar.gz
```

```text
Pushed image 'hello:latest' to local archive at './out/default.tar.gz'.
```

The docs call this a tar.gz archive. With SDK 10.0.100, `file` reports the outer file as `POSIX tar archive` (not gzip), while each layer inside is gzip compressed: `tar -xf` opens it, and `gunzip -t` answers `not in gzip format`.

### Reading the image without Docker

A single-platform archive is in the `docker save` layout: a `manifest.json` (`"RepoTags":["hello:latest"]`, the config file name, 7 layer paths), one config JSON and one `layer.tar` per layer. I ran `tar -xf` on it and read the config fields that decide how the container runs:

```text
architecture: arm64 os: linux
User: "1654"
Entrypoint: ["dotnet", "/app/hello.dll"]
Cmd: null
WorkingDir: "/app/"
ExposedPorts: {"8080/tcp": {}}
Env: ["PATH=...", "APP_UID=1654", "ASPNETCORE_HTTP_PORTS=8080", "DOTNET_RUNNING_IN_CONTAINER=true", "DOTNET_VERSION=10.0.14", "ASPNET_VERSION=10.0.14"]
Labels: org.opencontainers.image.base.name=mcr.microsoft.com/dotnet/aspnet:10.0
        org.opencontainers.image.base.digest=sha256:bfdb8a0389d3...
        org.opencontainers.image.version=1.0.0, org.opencontainers.image.authors=hello
        net.dot.runtime.majorminor=10.0, net.dot.sdk.version=10.0.100
```

The defaults line up with the reference page: repository from `AssemblyName` (`hello`), tag `latest` (the default since .NET 8; earlier SDKs used the project `Version`), working directory `/app/`, port 8080 inferred from the base image's `ASPNETCORE_HTTP_PORTS`. The base digest label pins exactly which `aspnet:10.0` build was used, which matters because `10.0` is a moving tag.

### Which base image the SDK picks

The docs give the inference rule: `aspnet` for ASP.NET Core projects, `runtime` for other framework-dependent apps, `runtime-deps` for self-contained apps, tagged with the TFM version. The tag does not say which Linux it is, so I read `/etc/os-release` from the first layer of each default image:

```text
aspnet:10.0 (SDK 10.0.100, net10.0 app)  PRETTY_NAME="Ubuntu 24.04.5 LTS"  VERSION_CODENAME=noble
aspnet:9.0  (same SDK, net9.0 app)       PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"
```

The default distro changed with .NET 10: Debian 12 for `9.0`, Ubuntu 24.04 for `10.0`. Scripts that assume Debian package names or versions inside a derived image need a check when you move the TFM. I then asked MSBuild which base it infers in other configurations, using the SDK's own target:

```bash
dotnet msbuild -restore -t:ComputeContainerBaseImage -p:RuntimeIdentifier=linux-arm64 -getProperty:ContainerBaseImage
```

```text
(defaults)                                       mcr.microsoft.com/dotnet/aspnet:10.0
InvariantGlobalization=true                      mcr.microsoft.com/dotnet/aspnet:10.0
PublishAot=true                                  mcr.microsoft.com/dotnet/runtime-deps:10.0-noble-chiseled-extra
PublishAot=true, InvariantGlobalization=true     mcr.microsoft.com/dotnet/runtime-deps:10.0-noble-chiseled
PublishAot=true, ContainerFamily=noble-chiseled  mcr.microsoft.com/dotnet/runtime-deps:10.0-noble-chiseled
```

And from real publishes: `-r linux-arm64 --self-contained` gave `runtime-deps:10.0-noble-chiseled` when I asked for that family, and `-r linux-musl-arm64 --self-contained` gave `runtime-deps:10.0-alpine` automatically. Two things differ from the reference page. It still names a `nightly/runtime-deps` `jammy-chiseled-aot` image for Native AOT, while SDK 10.0.100 picked `noble-chiseled` and `noble-chiseled-extra` from the regular repository. And it reads as if `InvariantGlobalization=false` switches to an `-extra` variant in general; in my runs that only happened for `PublishAot=true`. A framework-dependent or self-contained app with `ContainerFamily=noble-chiseled` and `InvariantGlobalization=false` still got the plain `noble-chiseled` tag, without ICU.

### Layers and what each one costs

The default image has seven layers. I measured each one (compressed is what a registry stores and a node downloads):

```text
layer 0:  28.9 MB compressed, 103.3 MB uncompressed   Ubuntu 24.04 root filesystem
layer 1:  17.1 MB compressed,  43.5 MB uncompressed   apt packages (ca-certificates, ICU, tzdata...)
layer 2:   0.0 MB                                      groupadd/useradd for the app user
layer 3:  35.2 MB compressed,  89.0 MB uncompressed   .NET runtime in /usr/share/dotnet
layer 4:   0.0 MB                                      /usr/bin/dotnet symlink
layer 5:  12.5 MB compressed,  30.2 MB uncompressed   ASP.NET Core shared framework
layer 6:  48320 bytes compressed (0.2 MB)              /app: hello.dll, apphost, pdb, appsettings*.json, web.config
total:    93.8 MB compressed, 266.1 MB uncompressed
```

The SDK adds exactly one layer, with the whole publish folder. Every file in it is owned by root with mode `0755`, so the non-root user can read `/app` but cannot write to it. Anything the app writes at runtime belongs in `/tmp`, a volume, or an explicit writable directory.

### ContainerFamily: the operating system you ship

`ContainerFamily` is appended to the TFM tag, so `<ContainerFamily>noble-chiseled</ContainerFamily>` turns `10.0` into `10.0-noble-chiseled`. I published the same app with each family and measured:

```text
base image                              compressed  uncompressed  layers  libicu files  zoneinfo
aspnet:10.0 (Ubuntu 24.04)                 93.8 MB      266.1 MB       7            21      1247
aspnet:10.0-noble-chiseled                 52.6 MB      131.9 MB       6             0         0
aspnet:10.0-noble-chiseled-extra           68.5 MB      171.3 MB       6            14      1245
aspnet:10.0-alpine (Alpine v3.24)          53.0 MB      131.0 MB       7             0         0
runtime-deps:10.0-noble-chiseled, self-contained, PublishTrimmed, InvariantGlobalization
                                           16.9 MB       42.2 MB       3             0         0
```

The .NET and ASP.NET Core layers are the same size in every family (35.2 MB and 12.5 MB compressed), so the saving is all operating system: the chiseled root filesystem is 4.8 MB compressed against 46 MB for Ubuntu plus its packages. Chiseled is also shell-less: I listed every layer and found no `sh`, `bash`, `apt` or `apt-get`, while the Ubuntu image has `usr/bin/sh` and `usr/bin/apt-get`. Nobody can `docker exec -it ... sh` into it, and nobody who breaks in finds a package manager. The last line combines the adjacent lesson's trimming with a chiseled `runtime-deps` base: 16.9 MB in total.

### Rootless by default: where User 1654 comes from

`ContainerUser` was empty in the evaluated project, yet the config says `"User": "1654"`. The docs explain it: for .NET 8+ on Linux the SDK uses the rootless `app` user, referenced by its ID, which it reads from the base image's `APP_UID` variable. I checked both ends:

```text
/etc/passwd in the chiseled base: app:x:1654:1654::/home/app:/bin/false
aspnet:10.0 history:              ENV APP_UID=1654 ..., RUN groupadd --gid=$APP_UID app && useradd --uid=$APP_UID ...   (no USER line)
aspnet:10.0-noble-chiseled:       ENV APP_UID=1654 ..., USER 1654
```

This is the detail that bites people moving between routes. The Ubuntu `aspnet:10.0` image creates the `app` user but does not switch to it, so a Dockerfile `FROM mcr.microsoft.com/dotnet/aspnet:10.0` without a `USER` line runs as root. The SDK route sets `User` to 1654 anyway. Chiseled images already have `USER 1654` in the base. A numeric ID also lets Kubernetes enforce `runAsNonRoot: true`, which cannot verify a user name. Opting out is one property: `-p:ContainerUser=root` produced `"User": "root"`. The docs add that the SDK does not check that the user you name exists in the image.

### Name, tags, port, environment and labels

```xml
<PropertyGroup>
  <ContainerRepository>shop/orders-api</ContainerRepository>
  <ContainerImageTags>1.4.0;latest</ContainerImageTags>
  <ContainerFamily>noble-chiseled</ContainerFamily>
</PropertyGroup>
<ItemGroup>
  <ContainerPort Include="9090" Type="tcp" />
  <ContainerEnvironmentVariable Include="ASPNETCORE_HTTP_PORTS" Value="9090" />
  <ContainerEnvironmentVariable Include="Logging__LogLevel__Default" Value="Warning" />
  <ContainerLabel Include="org.opencontainers.image.source" Value="https://example.com/shop/orders-api" />
</ItemGroup>
```

I gave `ContainerArchiveOutputPath` a folder this time:

```text
Building image 'shop/orders-api' with tags '1.4.0,latest' on top of base image 'mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled'.
file written: out/dir/shop/orders-api.tar.gz
RepoTags: ['shop/orders-api:1.4.0', 'shop/orders-api:latest']
ExposedPorts: {"9090/tcp": {}}
Env: [..., "ASPNETCORE_HTTP_PORTS=9090", ..., "Logging__LogLevel__Default=Warning"]
```

Both tags went into one archive, named `$(ContainerRepository).tar.gz` as documented (the slash became a subfolder). Changing `ContainerPort` alone only documents a port: Kestrel listens where `ASPNETCORE_HTTP_PORTS` says, which is why I changed both. Environment variables use `__` for configuration sections, the same binding as the options pattern. Name validation is uneven: `ContainerImageTag=v1+build` failed the build with `error CONTAINER2007: Invalid ContainerImageTag provided: v1+build`, while `ContainerRepository=Orders_API` was silently lowercased to `orders_api`.

### Architecture: the default RID and multi-arch images

`ContainerRuntimeIdentifier` defaults to the publish RID. With no `-r`, MSBuild reported `ContainerRuntimeIdentifier=linux-arm64` on this `osx-arm64` machine, so every image above is `arm64`, and it would not start on an x64 node. `-r linux-x64` produced `architecture: amd64` and, being self-contained, an `Entrypoint` of `["/app/hello"]` (the native apphost) on `runtime-deps`. For one image name covering both:

```xml
<PropertyGroup>
  <RuntimeIdentifiers>linux-x64;linux-arm64</RuntimeIdentifiers>
  <ContainerRuntimeIdentifiers>linux-x64;linux-arm64</ContainerRuntimeIdentifiers>
</PropertyGroup>
```

```text
Building image 'hello' for runtime identifier 'linux-x64' on top of base image 'mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled'.
Building image 'hello' for runtime identifier 'linux-arm64' on top of base image 'mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled'.
Building image index 'hello:latest' on top of manifests sha256:fd239688f369..., sha256:53d276538aa9...
archive: 109.3 MB; index.json -> {amd64, linux}, {arm64, linux} (application/vnd.oci.image.manifest.v1+json)
```

The multi-arch archive is no longer in `docker save` layout: it is an OCI image layout with an image index, which matches the docs (multi-arch output is always OCI). The docs also require `ContainerRuntimeIdentifiers` to be a subset of `RuntimeIdentifiers`.

### Chiseled and globalization: no ICU, invariant mode forced

The chiseled and Alpine images have no `libicu` and no `/usr/share/zoneinfo`, and their config `Env` has one variable the Ubuntu image does not: `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=true`. So the template app, which never set `InvariantGlobalization`, runs in globalization-invariant mode in those images whether you planned it or not. I could not run the Linux image without a daemon, so I reproduced the same switch on the host with a console app:

```csharp
var pt = new CultureInfo("pt-BR");
Console.WriteLine($"{1234.5m.ToString("C", pt)}, {new DateTime(2026, 10, 28).ToString("D", pt)}");
Console.WriteLine(string.Compare("a", "B", StringComparison.CurrentCulture));
```

```text
--- ICU available
pt-BR created: pt-BR, R$ 1.234,50, quarta-feira, 28 de outubro de 2026
Compare("a","B")=-1
--- DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=true
CultureNotFoundException: Only the invariant culture is supported in globalization-invariant mode.
Compare("a","B")=31
--- plus DOTNET_SYSTEM_GLOBALIZATION_PREDEFINED_CULTURES_ONLY=false
pt-BR created: pt-BR, ¤1,234.50, Wednesday, 28 October 2026
```

Creating `pt-BR` throws. Turning off predefined-cultures-only makes it succeed but silently format with invariant data (`¤1,234.50`, English month names), which is worse because nothing fails. Culture-aware comparison becomes ordinal, so sort order changes (`"a"` now sorts after `"B"`). The globalization design doc covers the other direction: if you remove the invariant flag on an image without ICU, the app fails to start on Linux. Apps that need real cultures or time zones should use `noble-chiseled-extra` (16 MB more compressed in my measurement) or the Ubuntu image, and apps that do not should set `<InvariantGlobalization>true</InvariantGlobalization>` so local runs behave like the container.

### Pushing to a registry (documented, not run)

I did not push anywhere. The docs describe `ContainerRegistry` as the destination, for example `-p:ContainerRegistry=registry.mycorp.com:1234`, and list ACR, ECR, Artifact Registry, Docker Hub, GHCR, GitLab and Quay among the registries that implement the Docker Registry HTTP API V2 it needs. Credentials come from the normal Docker config (`~/.docker/config.json` or `$DOCKER_CONFIG`: `auths`, `credHelpers`, `credsStore`), so a `docker login` or a cloud credential helper is enough. For CI without that file, the SDK reads `DOTNET_CONTAINER_REGISTRY_UNAME` and `DOTNET_CONTAINER_REGISTRY_PWORD` (the names before SDK 8.0.400 were `SDK_CONTAINER_REGISTRY_UNAME`/`PWORD`). The auth doc warns that these variables are not scoped per registry: the same credentials are sent to the registry the base image comes from and to the destination. `DOTNET_CONTAINER_INSECURE_REGISTRIES` (SDK 9.0.1xx and later) takes a comma-separated list of registries to treat as insecure, for example a private registry without TLS.

### Route 2: a multi-stage Dockerfile (shown, not executed)

This is the same app as a Dockerfile. I could not build it here (no daemon), so treat it as a reference shape, not measured output:

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY hello.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish --no-restore -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled
WORKDIR /app
COPY --from=build /app .
USER $APP_UID
ENTRYPOINT ["dotnet", "hello.dll"]
```

Copying the `.csproj` and restoring before copying the sources makes the restore layer cacheable: a code change reuses it, a package change rebuilds it. `--no-restore` keeps publish from repeating that work. A `.dockerignore` with `**/bin/`, `**/obj/` and `.git/` keeps host build output (built for macOS) out of the build context. The SDK image is only the build stage: per the container images page, there are no chiseled SDK images, and the final stage carries only the runtime. `USER $APP_UID` is redundant on chiseled but required on the Ubuntu `aspnet` image to avoid running as root.

## Trade-offs

- **The SDK route needs no daemon and no Dockerfile.** CI agents with only the .NET SDK can build and push images, and the result is non-root by default and records its base image digest in a label.
- **The SDK route cannot run commands in the image.** There is no `RUN`: you cannot `apt-get install` a package, add a non-.NET binary or run a frontend build inside it. Pick another `ContainerBaseImage` that already has what you need, or write a Dockerfile.
  ```xml
  <ContainerBaseImage>myregistry.io/base/aspnet-with-libgdiplus:10.0</ContainerBaseImage>
  ```
- **Your whole app is one layer.** NuGet dependencies and your code ship together, so a one-line change re-uploads every DLL; a Dockerfile can split rarely-changing dependencies into their own layer.
- **Moving tags drift.** `aspnet:10.0` resolves to a new digest after each patch, which is good for security fixes and bad for bit-for-bit reproducibility. Pin when you need repeatable builds, and rebuild on a schedule either way.
  ```xml
  <ContainerBaseImage>mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled@sha256:4349b506d5fee3d9843196b135c17884950b5d3f3ce194e1a8c7df73096e8cbf</ContainerBaseImage>
  ```
- **Chiseled trades debuggability for size and surface.** 52.6 MB instead of 93.8 MB and no shell, but also no `sh` for `kubectl exec`; debugging moves to ephemeral debug containers, logs and dumps.
- **Chiseled and Alpine change globalization behavior.** Invariant mode is forced by the image, not by your project, so set `InvariantGlobalization` explicitly or choose the `-extra` variant.
- **The default architecture is the build machine's.** Publishing from an Apple Silicon laptop gives `arm64`; set `-r linux-x64` or `ContainerRuntimeIdentifiers` before pushing to x64 clusters.
- **A Dockerfile is portable knowledge.** Every container tool and every developer reads it, and it handles multi-project builds and extra tooling; the price is maintaining the restore layering, the user line and the base tags yourself.

## Documentation Links

- [Containerize an app with dotnet publish, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/containers/sdk-publish) (doc)
- [Containerize a .NET app reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/containers/publish-configuration) (doc)
- [.NET container images, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/docker/container-images) (doc)
- [Introduction to Docker, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/docker/introduction) (doc)
- [Globalization config settings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/globalization) (doc)
