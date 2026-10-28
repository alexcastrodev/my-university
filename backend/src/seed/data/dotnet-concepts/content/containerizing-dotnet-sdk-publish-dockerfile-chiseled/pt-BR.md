---
version: 1.0
updatedAt: 2026-10-28
title: "Containerizando .NET: dotnet publish, Dockerfile e imagens chiseled"
summary: Duas rotas para gerar uma imagem de container .NET 10 (o suporte embutido do SDK sem Dockerfile nem daemon, e um Dockerfile multi-stage), com a imagem base escolhida, o usuário não root, as famílias chiseled e Alpine medidas em tamanho, imagens multi-arquitetura e o efeito da falta de ICU na globalização.
---
## Objective

Uma imagem de container é uma pilha de camadas tar mais um config JSON que diz qual usuário executa o processo, qual comando o inicia, em quais portas ele escuta e qual ambiente ele enxerga. O .NET oferece dois caminhos para produzir uma. A rota do SDK (`dotnet publish -t:PublishContainer`) monta a imagem sozinha, sem Dockerfile e sem daemon do Docker, baixando uma imagem base da Microsoft por HTTPS e adicionando a saída do publish como uma camada. A rota do Dockerfile é um build multi-stage que você escreve e executa com o Docker ou outro builder. A rota do SDK toma várias decisões por você (imagem base, sistema operacional, usuário, porta, entrypoint), e algumas importam em produção: qual Linux você entrega, se o processo roda como root e se a imagem tem os dados de ICU de que o seu código sensível a cultura precisa. Este conceito publica o mesmo app ASP.NET Core em arquivos tar numa máquina sem daemon do Docker, descompacta esses arquivos, lê o manifest, o config e cada camada, e compara as famílias de imagem base pelo tamanho medido. Versões usadas: SDK 10.0.100 (container tooling `10.0.100-rtm.25523.111`) num Mac Apple Silicon (`osx-arm64`), runtime .NET e ASP.NET Core 10.0.14 dentro das imagens, imagens base `mcr.microsoft.com/dotnet/aspnet:10.0` (Ubuntu 24.04.5 LTS), `10.0-noble-chiseled`, `10.0-noble-chiseled-extra` e `10.0-alpine` (Alpine Linux v3.24), além de `aspnet:9.0` (Debian 12) para comparação.

## Use Cases

- Publicar uma API ASP.NET Core no Kubernetes, no Azure Container Apps ou no ECS a partir de um agente de CI que tem o SDK do .NET mas não tem daemon do Docker.
- Reduzir o tamanho da imagem e a superfície de ataque trocando a base Ubuntu padrão por uma base chiseled (distroless) ou Alpine.
- Gerar um único nome de imagem que roda tanto em nós x64 quanto em nós arm64 (Graviton, Ampere, máquinas de desenvolvimento Apple Silicon).
- Decidir quando a rota do SDK deixa de bastar e um Dockerfile escrito à mão é a ferramenta melhor (pacotes do sistema, binários extras, etapas de build que não são .NET).

## Deep Dive

### Rota 1: um comando, sem Dockerfile, sem daemon

Criei um app vazio com `dotnet new web --framework net10.0` e o publiquei como container. Desde o .NET 8, o `dotnet publish` usa a configuração Release por padrão. O destino padrão é o daemon local do Docker; nesta máquina o daemon não está acessível, e o SDK avisa isso depois de montar a imagem em memória:

```text
Building image 'hello' with tags 'latest' on top of base image 'mcr.microsoft.com/dotnet/aspnet:10.0'.
error : [Microsoft.NET.Build.Containers.DockerCli] Cannot find docker/podman executable.
error CONTAINER1012: The local registry is not available, but pushing to a local registry was requested.
```

O `ContainerArchiveOutputPath` manda a imagem para um arquivo, o que só exige o SDK e acesso de rede ao `mcr.microsoft.com` (`-p:PublishProfile=DefaultContainer` deu o mesmo resultado que `-t:PublishContainer`):

```bash
dotnet publish -t:PublishContainer -p:ContainerArchiveOutputPath=./out/default.tar.gz
```

```text
Pushed image 'hello:latest' to local archive at './out/default.tar.gz'.
```

A documentação chama isso de arquivo tar.gz. Com o SDK 10.0.100, o `file` reporta o arquivo externo como `POSIX tar archive` (não gzip), enquanto cada camada lá dentro é comprimida com gzip: o `tar -xf` abre o arquivo, e o `gunzip -t` responde `not in gzip format`.

### Lendo a imagem sem Docker

Um arquivo de plataforma única está no layout do `docker save`: um `manifest.json` (`"RepoTags":["hello:latest"]`, o nome do arquivo de config, 7 caminhos de camada), um config JSON e um `layer.tar` por camada. Rodei `tar -xf` nele e li os campos do config que decidem como o container executa:

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

Os padrões batem com a página de referência: repositório a partir do `AssemblyName` (`hello`), tag `latest` (o padrão desde o .NET 8; SDKs anteriores usavam a `Version` do projeto), diretório de trabalho `/app/`, porta 8080 inferida do `ASPNETCORE_HTTP_PORTS` da imagem base. O label com o digest da base registra exatamente qual build de `aspnet:10.0` foi usado, o que importa porque `10.0` é uma tag móvel.

### Qual imagem base o SDK escolhe

A documentação dá a regra de inferência: `aspnet` para projetos ASP.NET Core, `runtime` para os demais apps framework-dependent, `runtime-deps` para apps self-contained, com a tag igual à versão do TFM. A tag não diz qual Linux é, então li o `/etc/os-release` da primeira camada de cada imagem padrão:

```text
aspnet:10.0 (SDK 10.0.100, net10.0 app)  PRETTY_NAME="Ubuntu 24.04.5 LTS"  VERSION_CODENAME=noble
aspnet:9.0  (same SDK, net9.0 app)       PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"
```

A distro padrão mudou com o .NET 10: Debian 12 no `9.0`, Ubuntu 24.04 no `10.0`. Scripts que assumem nomes ou versões de pacotes do Debian dentro de uma imagem derivada precisam de revisão quando você troca o TFM. Depois perguntei ao MSBuild qual base ele infere em outras configurações, usando o próprio target do SDK:

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

E em publishes reais: `-r linux-arm64 --self-contained` gerou `runtime-deps:10.0-noble-chiseled` quando pedi essa família, e `-r linux-musl-arm64 --self-contained` gerou `runtime-deps:10.0-alpine` automaticamente. Duas coisas diferem da página de referência. Ela ainda cita uma imagem `nightly/runtime-deps` `jammy-chiseled-aot` para Native AOT, enquanto o SDK 10.0.100 escolheu `noble-chiseled` e `noble-chiseled-extra` do repositório normal. E ela dá a entender que `InvariantGlobalization=false` troca para uma variante `-extra` em geral; nos meus testes isso só aconteceu com `PublishAot=true`. Um app framework-dependent ou self-contained com `ContainerFamily=noble-chiseled` e `InvariantGlobalization=false` continuou recebendo a tag `noble-chiseled` simples, sem ICU.

### As camadas e quanto cada uma custa

A imagem padrão tem sete camadas. Medi cada uma (comprimido é o que o registry guarda e o que um nó baixa):

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

O SDK adiciona exatamente uma camada, com a pasta de publish inteira. Todos os arquivos dela pertencem ao root com modo `0755`, então o usuário não root consegue ler `/app`, mas não consegue escrever nele. Tudo o que o app grava em tempo de execução deve ir para `/tmp`, um volume ou um diretório gravável explícito.

### ContainerFamily: o sistema operacional que você entrega

O `ContainerFamily` é anexado à tag do TFM, então `<ContainerFamily>noble-chiseled</ContainerFamily>` transforma `10.0` em `10.0-noble-chiseled`. Publiquei o mesmo app com cada família e medi:

```text
base image                              compressed  uncompressed  layers  libicu files  zoneinfo
aspnet:10.0 (Ubuntu 24.04)                 93.8 MB      266.1 MB       7            21      1247
aspnet:10.0-noble-chiseled                 52.6 MB      131.9 MB       6             0         0
aspnet:10.0-noble-chiseled-extra           68.5 MB      171.3 MB       6            14      1245
aspnet:10.0-alpine (Alpine v3.24)          53.0 MB      131.0 MB       7             0         0
runtime-deps:10.0-noble-chiseled, self-contained, PublishTrimmed, InvariantGlobalization
                                           16.9 MB       42.2 MB       3             0         0
```

As camadas do .NET e do ASP.NET Core têm o mesmo tamanho em todas as famílias (35.2 MB e 12.5 MB comprimidos), então toda a economia vem do sistema operacional: o root filesystem chiseled tem 4.8 MB comprimidos contra 46 MB do Ubuntu com seus pacotes. A imagem chiseled também não tem shell: listei todas as camadas e não encontrei `sh`, `bash`, `apt` nem `apt-get`, enquanto a imagem Ubuntu tem `usr/bin/sh` e `usr/bin/apt-get`. Ninguém consegue fazer `docker exec -it ... sh` nela, e quem invadir não encontra gerenciador de pacotes. A última linha combina o trimming da lição anterior com uma base `runtime-deps` chiseled: 16.9 MB no total.

### Sem root por padrão: de onde vem o User 1654

O `ContainerUser` estava vazio no projeto avaliado, e mesmo assim o config diz `"User": "1654"`. A documentação explica: no .NET 8+ em Linux, o SDK usa o usuário sem privilégios `app`, referenciado pelo ID, que ele lê da variável `APP_UID` da imagem base. Conferi as duas pontas:

```text
/etc/passwd in the chiseled base: app:x:1654:1654::/home/app:/bin/false
aspnet:10.0 history:              ENV APP_UID=1654 ..., RUN groupadd --gid=$APP_UID app && useradd --uid=$APP_UID ...   (no USER line)
aspnet:10.0-noble-chiseled:       ENV APP_UID=1654 ..., USER 1654
```

Esse é o detalhe que pega quem troca de rota. A imagem Ubuntu `aspnet:10.0` cria o usuário `app` mas não muda para ele, então um Dockerfile `FROM mcr.microsoft.com/dotnet/aspnet:10.0` sem a linha `USER` roda como root. A rota do SDK define `User` como 1654 mesmo assim. As imagens chiseled já trazem `USER 1654` na base. Um ID numérico também permite que o Kubernetes aplique `runAsNonRoot: true`, que não consegue verificar um nome de usuário. Desligar isso é uma propriedade: `-p:ContainerUser=root` produziu `"User": "root"`. A documentação acrescenta que o SDK não verifica se o usuário informado existe na imagem.

### Nome, tags, porta, ambiente e labels

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

Desta vez passei uma pasta para o `ContainerArchiveOutputPath`:

```text
Building image 'shop/orders-api' with tags '1.4.0,latest' on top of base image 'mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled'.
file written: out/dir/shop/orders-api.tar.gz
RepoTags: ['shop/orders-api:1.4.0', 'shop/orders-api:latest']
ExposedPorts: {"9090/tcp": {}}
Env: [..., "ASPNETCORE_HTTP_PORTS=9090", ..., "Logging__LogLevel__Default=Warning"]
```

As duas tags foram para um único arquivo, chamado `$(ContainerRepository).tar.gz` como documentado (a barra virou uma subpasta). Mudar só o `ContainerPort` apenas documenta uma porta: o Kestrel escuta onde o `ASPNETCORE_HTTP_PORTS` mandar, por isso mudei os dois. Variáveis de ambiente usam `__` para seções de configuração, o mesmo binding do options pattern. A validação de nomes é desigual: `ContainerImageTag=v1+build` quebrou o build com `error CONTAINER2007: Invalid ContainerImageTag provided: v1+build`, enquanto `ContainerRepository=Orders_API` foi convertido em silêncio para `orders_api`.

### Arquitetura: o RID padrão e imagens multi-arquitetura

O `ContainerRuntimeIdentifier` assume o RID do publish por padrão. Sem `-r`, o MSBuild reportou `ContainerRuntimeIdentifier=linux-arm64` nesta máquina `osx-arm64`, então todas as imagens acima são `arm64` e não iniciariam num nó x64. `-r linux-x64` produziu `architecture: amd64` e, por ser self-contained, um `Entrypoint` `["/app/hello"]` (o apphost nativo) sobre `runtime-deps`. Para um único nome de imagem que cubra as duas:

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

O arquivo multi-arquitetura deixa de estar no layout do `docker save`: é um OCI image layout com um image index, o que bate com a documentação (a saída multi-arquitetura é sempre OCI). A documentação também exige que `ContainerRuntimeIdentifiers` seja um subconjunto de `RuntimeIdentifiers`.

### Chiseled e globalização: sem ICU, modo invariante forçado

As imagens chiseled e Alpine não têm `libicu` nem `/usr/share/zoneinfo`, e o `Env` do config delas tem uma variável que a imagem Ubuntu não tem: `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=true`. Ou seja, o app do template, que nunca definiu `InvariantGlobalization`, roda em modo de globalização invariante nessas imagens, quer você tenha planejado ou não. Não consegui executar a imagem Linux sem daemon, então reproduzi a mesma chave no host com um app de console:

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

Criar `pt-BR` lança exceção. Desligar o predefined-cultures-only faz a criação funcionar, mas formata em silêncio com dados invariantes (`¤1,234.50`, nomes de mês em inglês), o que é pior porque nada falha. A comparação sensível a cultura vira ordinal, então a ordenação muda (`"a"` passa a vir depois de `"B"`). O documento de design de globalização cobre o caminho inverso: se você remover a flag invariante numa imagem sem ICU, o app não inicia no Linux. Apps que precisam de culturas reais ou fusos horários devem usar `noble-chiseled-extra` (16 MB a mais comprimidos na minha medição) ou a imagem Ubuntu, e apps que não precisam devem definir `<InvariantGlobalization>true</InvariantGlobalization>` para que a execução local se comporte como o container.

### Enviando para um registry (documentado, não executado)

Não enviei nada para lugar nenhum. A documentação descreve o `ContainerRegistry` como destino, por exemplo `-p:ContainerRegistry=registry.mycorp.com:1234`, e lista ACR, ECR, Artifact Registry, Docker Hub, GHCR, GitLab e Quay entre os registries que implementam a Docker Registry HTTP API V2 de que ele precisa. As credenciais vêm do config normal do Docker (`~/.docker/config.json` ou `$DOCKER_CONFIG`: `auths`, `credHelpers`, `credsStore`), então um `docker login` ou um credential helper da nuvem basta. Para CI sem esse arquivo, o SDK lê `DOTNET_CONTAINER_REGISTRY_UNAME` e `DOTNET_CONTAINER_REGISTRY_PWORD` (antes do SDK 8.0.400 os nomes eram `SDK_CONTAINER_REGISTRY_UNAME`/`PWORD`). A documentação de autenticação avisa que essas variáveis não têm escopo por registry: as mesmas credenciais são enviadas ao registry de onde vem a imagem base e ao destino. `DOTNET_CONTAINER_INSECURE_REGISTRIES` (SDK 9.0.1xx em diante) recebe uma lista separada por vírgulas de registries a tratar como inseguros, por exemplo um registry privado sem TLS.

### Rota 2: um Dockerfile multi-stage (mostrado, não executado)

Este é o mesmo app como Dockerfile. Não consegui fazer o build aqui (sem daemon), então trate como formato de referência, não como saída medida:

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

Copiar o `.csproj` e fazer o restore antes de copiar o código-fonte torna a camada do restore cacheável: uma mudança de código a reaproveita, uma mudança de pacote a reconstrói. O `--no-restore` evita que o publish repita esse trabalho. Um `.dockerignore` com `**/bin/`, `**/obj/` e `.git/` mantém a saída de build do host (compilada para macOS) fora do contexto de build. A imagem do SDK é só o estágio de build: segundo a página de imagens de container, não existem imagens SDK chiseled, e o estágio final leva apenas o runtime. O `USER $APP_UID` é redundante na chiseled, mas necessário na imagem Ubuntu `aspnet` para não rodar como root.

## Trade-offs

- **A rota do SDK dispensa daemon e Dockerfile.** Agentes de CI só com o SDK do .NET conseguem gerar e enviar imagens, e o resultado é não root por padrão e registra o digest da imagem base num label.
- **A rota do SDK não executa comandos na imagem.** Não existe `RUN`: você não consegue fazer `apt-get install` de um pacote, adicionar um binário que não é .NET nem rodar um build de frontend dentro dela. Escolha outro `ContainerBaseImage` que já tenha o que você precisa, ou escreva um Dockerfile.
  ```xml
  <ContainerBaseImage>myregistry.io/base/aspnet-with-libgdiplus:10.0</ContainerBaseImage>
  ```
- **O app inteiro vira uma camada.** Dependências NuGet e o seu código vão juntos, então uma mudança de uma linha reenvia todas as DLLs; um Dockerfile consegue separar as dependências que mudam pouco numa camada própria.
- **Tags móveis mudam.** `aspnet:10.0` passa a apontar para um novo digest a cada patch, o que é bom para correções de segurança e ruim para reprodutibilidade bit a bit. Fixe o digest quando precisar de builds repetíveis, e reconstrua periodicamente de qualquer jeito.
  ```xml
  <ContainerBaseImage>mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled@sha256:4349b506d5fee3d9843196b135c17884950b5d3f3ce194e1a8c7df73096e8cbf</ContainerBaseImage>
  ```
- **Chiseled troca facilidade de depuração por tamanho e superfície.** 52.6 MB em vez de 93.8 MB e nenhum shell, o que também significa nenhum `sh` para `kubectl exec`; a depuração passa para containers efêmeros de debug, logs e dumps.
- **Chiseled e Alpine mudam o comportamento de globalização.** O modo invariante é forçado pela imagem, não pelo seu projeto, então defina `InvariantGlobalization` explicitamente ou escolha a variante `-extra`.
- **A arquitetura padrão é a da máquina de build.** Publicar de um notebook Apple Silicon gera `arm64`; defina `-r linux-x64` ou `ContainerRuntimeIdentifiers` antes de enviar para clusters x64.
- **Um Dockerfile é conhecimento portável.** Toda ferramenta de container e todo desenvolvedor sabe lê-lo, e ele lida com builds de vários projetos e ferramentas extras; o preço é manter você mesmo a separação do restore, a linha de usuário e as tags da base.

## Documentation Links

- [Containerize an app with dotnet publish, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/containers/sdk-publish) (doc)
- [Containerize a .NET app reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/containers/publish-configuration) (doc)
- [.NET container images, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/docker/container-images) (doc)
- [Introduction to Docker, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/docker/introduction) (doc)
- [Globalization config settings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/globalization) (doc)
