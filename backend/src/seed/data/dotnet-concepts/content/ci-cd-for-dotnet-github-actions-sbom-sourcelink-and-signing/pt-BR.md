---
version: 1.0
updatedAt: 2026-11-19
title: "CI/CD para .NET: GitHub Actions, SBOM, SourceLink e assinatura"
summary: Um pipeline de build, teste e publicação medido numa biblioteca de brinquedo: restore travado e tempos com e sem cache, cobertura com coverlet, ReportGenerator e MTP com gate falhando, build determinístico (o que muda o hash), SourceLink lido no PDB, versão por tag com MinVer, NuGetAudit com pacote vulnerável real, SBOM em CycloneDX e SPDX, dotnet nuget sign com certificado de teste, push com --skip-duplicate e, só pela documentação, trusted publishing, attestations e segurança do pipeline.
---
## Objective

Um pipeline de CI para .NET é uma cadeia de pequenas garantias: o mesmo restore sempre, um build que falha por estilo e warnings, testes com piso de cobertura, um pacote cujo binário se rastreia até um commit, uma lista de materiais e um push que não precisa de segredo de longa vida. Cada elo aqui foi executado numa biblioteca de brinquedo (`Acme.Slugs`, dois TFMs, MSTest), e os comandos e as saídas são reais. O que só o GitHub executa (o runner hospedado, a action de cache, OIDC, attestations) está marcado como só documentação. O básico de empacotamento, o Central Package Management, a auditoria e os lock files estão em [packaging-and-publishing-a-nuget-library](packaging-and-publishing-a-nuget-library), [central-package-management-and-package-source-mapping](central-package-management-and-package-source-mapping) e [nuget-supply-chain-audit-lock-files-and-publish-age](nuget-supply-chain-audit-lock-files-and-publish-age); este concept liga tudo isso num pipeline.

Versões (conferidas em 2026-11-19): SDK 10.0.100, `net10.0` e `net8.0`; `MSTest` 4.5.3, `Microsoft.NET.Test.Sdk` 18.12.0, `coverlet.collector` e `coverlet.msbuild` 10.1.1, `ReportGenerator` 5.6.0, `MinVer` 8.0.0, `Microsoft.SourceLink.GitHub` 11.0.100, `Microsoft.Testing.Extensions.CodeCoverage` 18.12.0, ferramenta `CycloneDX` 6.3.1, `Microsoft.Sbom.DotNetTool` 4.1.13, ferramenta `sourcelink` 3.1.1; actions `checkout` v7.0.1, `setup-dotnet` v6.1.0, `upload-artifact` v7.0.2, `download-artifact` v8.0.2, `attest` v4.2.2, `NuGet/login` v1.2.0; `actionlint` 1.7.12.

## Use Cases

- Um repositório de biblioteca que precisa publicar um pacote assinado e rastreável a partir de uma tag, sem API key guardada.
- Um gate de pull request: restore travado, format, warnings como erros, testes em dois sistemas operacionais, piso de cobertura.

## Deep Dive

### O pipeline mínimo e quanto cada etapa custa

O repositório de brinquedo tem `Directory.Build.props` (nullable, `TreatWarningsAsErrors`, `NuGetAudit` em modo `all`, `RestorePackagesWithLockFile`) e uma condição `CI`: o GitHub define `CI=true`, então `ContinuousIntegrationBuild` e `RestoreLockedMode` só ligam lá. Medi cada etapa localmente, com três execuções do restore:

```text
dotnet restore, pasta de pacotes vazia    2.52 s, 2.37 s, 2.69 s   (24 pacotes, 320 MB)
dotnet restore, pasta de pacotes mantida  0.48 s, 0.48 s, 0.49 s
dotnet build -c Release --no-restore      1.77 s
dotnet test -c Release --no-build         Passed 4/4 no net10.0, Passed 4/4 no net8.0
```

O cache economiza o download (cerca de 2 s aqui, minutos num grafo grande com rede lenta), não o build. O `actions/setup-dotnet` com `cache: true` põe o hash do `packages.lock.json` na chave (só documentação, não pude rodar um runner hospedado), e por isso o lock file importa duas vezes: determinismo e chave de cache. O modo travado é o gate: subir uma versão em `Directory.Packages.props` sem regenerar o lock deu `error NU1004 ... The package reference ... lock file`, e `CI=true dotnet restore` passou com os lock files commitados. O `dotnet format --verify-no-changes` saiu com 0 no código limpo e com 2 depois que adicionei um arquivo mal formatado (`error WHITESPACE: Fix whitespace formatting`), então é um gate de verdade (veja [analyzers-editorconfig-and-build-quality-gates](analyzers-editorconfig-and-build-quality-gates)).

O job de teste do workflow (o arquivo completo, com os jobs de pack e publish, passou no `actionlint` 1.7.12 com saída 0; um erro de digitação num label de runner gerou `label "ubuntu-lates" is unknown`):

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

A matriz de TFM não está no YAML: o projeto de teste tem `<TargetFrameworks>net10.0;net8.0</TargetFrameworks>`, então um único `dotnet test` rodou os dois (as duas linhas `Passed!` acima). A matriz serve para sistemas operacionais; uma matriz de TFM só compensa quando cada job precisa de um runtime diferente (veja [multi-targeting-and-netstandard](multi-targeting-and-netstandard)). Dois detalhes que costumam ser esquecidos: `timeout-minutes` (o limite padrão do job é bem maior do que você quer pagar por um teste travado) e `cancel-in-progress` protegido para tags, de modo que um push novo cancela a execução antiga do pull request, mas nunca uma release.

### Cobertura: collector, ReportGenerator e um gate que falha

`--collect:"XPlat Code Coverage"` roda o coletor `coverlet.collector` e escreve um `coverage.cobertura.xml` por TFM em `TestResults/<guid>/`. Os dois TFMs reportaram `lines-covered="7" lines-valid="11"` e 10 de 14 branches, porque o `Truncate` não tem teste de propósito. O ReportGenerator uniu os dois arquivos (`Parser: MultiReport (2x Cobertura)`) e imprimiu `Line coverage: 63.6%`, `Branch coverage: 71.4% (10 of 14)`; `-reporttypes:MarkdownSummaryGithub` gerou uma tabela que dá para anexar a `$GITHUB_STEP_SUMMARY`. A célula de cobertura de métodos diz "Feature is only available for sponsors", então não monte um gate em cima dela.

O collector não tem gate: a documentação do coverlet diz que a integração com VSTest não suporta validação de threshold, e medi a propriedade que suporta, no `coverlet.msbuild`:

```text
dotnet test /p:CollectCoverage=true /p:Threshold=60 /p:ThresholdType=line /p:ThresholdStat=total   exit 0
dotnet test ... /p:Threshold=80 ...   exit 1  "The total line coverage is below the specified 80"
dotnet test ... /p:Threshold=\"90,70\" /p:ThresholdType=\"line,branch\" /p:ThresholdStat=minimum   exit 1  "The minimum line coverage is below the specified 90"
```

`ThresholdStat` é `minimum` (cada módulo), `total` ou `average`. A execução em Debug reportou 64.7% e a em Release 63.63% para o mesmo código: a cobertura depende da configuração, então aplique o gate na que o CI compila.

Com o `dotnet test` do .NET 10 em modo Microsoft.Testing.Platform (MTP), o collector sai de cena. Um projeto em `MSTest.Sdk` 4.5.3 com `"test": { "runner": "Microsoft.Testing.Platform" }` no `global.json` roda com `dotnet test --project tests/Mtp.csproj`, e o SDK trouxe sozinho o `Microsoft.Testing.Extensions.CodeCoverage` 18.12.0 e o `Microsoft.Testing.Extensions.TrxReport` 2.5.3. A cobertura são três flags: `--coverage --coverage-output-format cobertura --coverage-output cov.xml --results-directory TR`, que escreveu `TR/cov.xml` com as mesmas 7/11 linhas e 10/14 branches. O `--help` não lista opção de threshold (formatos: `coverage`, `xml`, `cobertura`), então com MTP o gate é seu. Seis linhas sobre o arquivo unido funcionaram:

```python
import sys, xml.etree.ElementTree as E
r = float(E.parse('coveragereport/Cobertura.xml').getroot().get('line-rate'))
sys.exit(0 if r >= 0.8 else f'line coverage {r:.1%} is below 0.8')
# measured: 0.6 -> exit 0; 0.8 -> exit 1 with the message above
```

Um número de cobertura é um piso contra a remoção de testes, não uma medida de qualidade ([four-pillars-of-a-good-unit-test](/java/testing/four-pillars-of-a-good-unit-test)); testes de integração entram no mesmo job ou num segundo ([integration-testing-with-webapplicationfactory](/dotnet-testing-concepts/integration-testing-with-webapplicationfactory)).

### Builds determinísticos: o que muda o hash

O compilador é determinístico por padrão (`Deterministic` estava `true` no meu projeto), e mesmo assim fontes idênticas não geram binários idênticos em duas máquinas. Empacotei o mesmo commit com `dotnet pack -c Release -p:Version=1.0.0` a partir de um `obj` limpo e comparei o SHA-256 de `lib/net10.0/Acme.Slugs.dll`:

```text
mesma pasta, empacotado duas vezes, sem flag          d6cd1b0d97dcf7f1  d6cd1b0d97dcf7f1  (igual)
dois clones em caminhos diferentes, sem flag          d6cd1b0d97dcf7f1  58136ea992724e0a  (DIFERENTE)
dois clones em caminhos diferentes, ContinuousIntegrationBuild=true
                                                      30116b4d92dd65fa  30116b4d92dd65fa  (igual; o PDB também: 8f24c381bc9a9dcf)
```

A diferença é o caminho gravado na DLL: o diretório de debug aponta para o PDB, `.../det/a/src/Acme.Slugs/obj/Release/net10.0/Acme.Slugs.pdb` sem a flag e `/_/src/Acme.Slugs/obj/Release/net10.0/Acme.Slugs.pdb` com ela. `ContinuousIntegrationBuild=true` liga `DeterministicSourcePaths`, que reescreve a raiz do checkout para `/_/` (o mesmo efeito de um `PathMap` manual). `dotnet msbuild -getProperty:ContinuousIntegrationBuild` imprimiu vazio por padrão e `true` com a variável de ambiente `CI=true`. Ligue só no CI: localmente ela quebra o mapeamento de fontes do depurador para os seus caminhos reais, e por isso o brinquedo usa `Condition="'$(CI)' == 'true'"`.

O `.nupkg` em si não é idêntico byte a byte nem assim (`48d8d345...` contra `9b0001b0...`). Entrada por entrada, as duas DLLs e o nuspec tinham o mesmo hash, enquanto `_rels/.rels`, o nome do arquivo `.psmdcp` (um GUID novo) e os timestamps do zip diferiam. Então, para verificar um rebuild, compare o conteúdo das entradas, não o hash do pacote.

### SourceLink no PDB e o que o `DebugType` muda

O SDK 10 já inclui SourceLink para GitHub, Azure Repos, GitLab e Bitbucket: sem pacote nenhum, `PublishRepositoryUrl=true`, `EnableSourceLink=true` e `EmbedUntrackedSources=true` já eram os valores avaliados. O PDB do snupkg continha, lido com `dotnet sourcelink print-json`:

```json
{"documents":{"/_/*":"https://raw.githubusercontent.com/acme/slugs/0a023bb3b3388be54b571df012c84773daff1730/*"}}
```

O commit vem do repositório e a URL vem do remote `origin`. O `print-urls` expande cada documento, por exemplo `.../0a023bb.../src/Acme.Slugs/Slugger.cs`. O `dotnet sourcelink test` busca cada URL e compara os checksums; no meu `github.com/acme/slugs` falso falhou com `url failed NotFound`, que é a resposta correta e o motivo de rodá-lo contra um pacote realmente publicado. Também li o PDB com `System.Reflection.Metadata` (os GUIDs das informações de debug personalizadas de SourceLink e de fonte embutida): `Slugger.cs` apareceu como documento comum, e os três arquivos gerados em `obj/` (`GlobalUsings.g.cs`, `AssemblyInfo.cs`, `AssemblyAttributes.cs`) como `EMBEDDED`, porque nenhuma URL consegue servi-los. Isso é o `EmbedUntrackedSources`.

Adicionar o `Microsoft.SourceLink.GitHub` 11.0.100 por cima mudou o hash da DLL e, na minha execução, os arquivos gerados deixaram de ser embutidos; não descobri o motivo, então confira o efeito no seu SDK antes de fixar o pacote. Ele também imprimiu `System.IO.Hashing 11.0.0 doesn't support net8.0` para o alvo `net8.0`, silenciado por `SuppressTfmSupportBuildWarnings`. No SDK 10 o pacote é opcional.

`DebugType`: `portable` (padrão) mais `snupkg` mantém a DLL pequena e os símbolos num segundo arquivo que o feed precisa hospedar. `embedded` colocou o PDB dentro da DLL (5.120 bytes viraram 12.288 no `net10.0`), e o `dotnet pack` então falhou com `NU5017: Cannot create a package that has no dependencies nor content` por causa do snupkg vazio, embora o `.nupkg` tenha sido escrito. Escolha um: embedded (simples, DLLs maiores, nada para hospedar) ou portable com `snupkg`.

### Versões a partir de tags do git

O `MinVer` 8.0.0 deriva a versão da tag mais próxima e da altura de commits; o Nerdbank.GitVersioning (3.10.94 estável) lê um `version.json` commitado no repositório e carimba a altura do git e o id do commit. Em três linhas: o MinVer não tem arquivo nem configuração além do prefixo da tag, então a tag é a release e uma release é um `git tag`; o NBGV tem um arquivo, então a versão base e o rótulo de prerelease passam por revisão num pull request e um commit tem versão estável sem tags; os dois precisam do histórico completo (`fetch-depth: 0`). Medi o MinVer (prefixo de tag `v`, versão lida com `dotnet msbuild -t:MinVer`, porque o MinVer define `Version` dentro de um target e um `-getProperty:Version` simples devolveu o `1.0.0` antigo na minha primeira tentativa):

```text
sem tag                                 0.0.0-alpha.0.4
tag v1.0.0, três commits atrás          1.0.1-alpha.0.3
  + MinVerDefaultPreReleaseIdentifiers=preview.0     1.0.1-preview.0.3
  + MinVerMinimumMajorMinor=2.0                      2.0.0-alpha.0.3
  + MinVerAutoIncrement=minor                        1.1.0-alpha.0.3
HEAD com a tag v1.1.0-rc.1              1.1.0-rc.1
HEAD com a tag v1.1.0 (árvore suja)     1.1.0     (sem marca de sujo)
```

O `dotnet pack` no commit com tag escreveu `Acme.Slugs.1.1.0.nupkg` e o `.snupkg` sem `-p:Version`. Um clone raso (`--depth 1`, o padrão do `actions/checkout`) não tem tags: o MinVer devolveu `0.0.0-alpha.0` até um `git fetch --tags --unshallow`, e depois `1.0.1-alpha.0.3`. Esse é o bug de versionamento em CI mais comum. A string de prerelease decide estável contra prerelease: uma tag `v1.1.0-rc.1` gera um pacote prerelease, `v1.1.0` um estável, e o job de publish roda só em tags.

### Vulnerabilidades no build

O `NuGetAudit` vem ligado por padrão e roda durante o restore. Referenciei o `Newtonsoft.Json` 12.0.3 num app descartável:

```text
warning NU1903: Package 'Newtonsoft.Json' 12.0.3 has a known high severity vulnerability, https://github.com/advisories/GHSA-5crp-9r3c-p9vr
dotnet list package --vulnerable --include-transitive      -> tabela com "High", exit 0 (o dotnet build também teve sucesso, com o warning)
restore com TreatWarningsAsErrors=true ou WarningsAsErrors=NU1903   -> "error NU1903: Warning As Error: ...", exit 1
restore com NuGetAuditLevel=critical                       -> sem warning (a advisory é high)
```

Duas armadilhas: `dotnet list package --vulnerable` apenas reporta e sai com 0, então não é um gate; e o warning sozinho não derruba o build. O gate é `NuGetAuditMode=all` (inclui transitivos) mais warnings como erros para `NU1901` a `NU1904` (baixa, moderada, alta, crítica), como faz o `Directory.Build.props` do brinquedo. O detalhe de supressões e do modo `direct` está no concept de supply chain.

### SBOM: o que é e o que duas ferramentas produziram

Uma lista de materiais de software (SBOM) enumera os componentes de um build, com versões, hashes e licenças, para que você responda "somos afetados?" quando surge uma advisory nova. CycloneDX (ECMA-424, JSON ou XML, feito para uso em segurança) e SPDX (ISO/IEC 5962:2021, forte em licenciamento) são os dois formatos; ambos são aceitos por scanners. A ferramenta `CycloneDX` (spec 1.7 por padrão, 0,5 s aqui):

```text
dotnet dotnet-CycloneDX tests/Acme.Slugs.Tests/Acme.Slugs.Tests.csproj -o sbom -F Json -fn tests.cdx.json
-> 22 componentes, ex.: MSTest 4.5.3, pkg:nuget/MSTest@4.5.3, hash SHA-512 b76b51b5fe7e2820..., licença MIT
dotnet dotnet-CycloneDX src/Acme.Slugs/Acme.Slugs.csproj ...
-> 1 componente: MinVer 8.0.0, scope "excluded", SHA-512 69870369..., licença Apache-2.0
```

O scope foi `excluded` para toda dependência de desenvolvimento ou de teste: elas não vão no que é entregue. O SHA-512 é o hash do arquivo `.nupkg`: bateu com o `.nupkg.sha512` da pasta global de pacotes (MSTest `b76b51b5fe7e2820`), e não com o `contentHash` do `packages.lock.json` (`aaffb1d330bb3316`), que é outro hash, então os dois não se comparam byte a byte. O `Microsoft.Sbom.DotNetTool` (SPDX 2.2) trabalha sobre a pasta de saída: `dotnet sbom-tool generate -b out -bc src/Acme.Slugs -pn Acme.Slugs -pv 1.0.1-alpha.0.3 -ps Acme -nsb https://example.org/sbom` escreveu `out/_manifest/spdx_2.2/manifest.spdx.json` e o `.sha256` em 1,7 s. Num clone limpo listou 5 pacotes (`MinVer` 8.0.0, os targeting packs do `net8.0` `Microsoft.NETCore.App.Ref` e `Microsoft.AspNetCore.App.Ref` 8.0.22, o próprio pacote e a raiz) e 2 arquivos, o `.nupkg` e o `.snupkg` com SHA-256 e SHA-1. Na primeira execução, com arquivos `obj` antigos de empacotamentos anteriores no caminho de componentes, listou três versões de `Acme.Slugs`: gere a partir de um build limpo. As duas ferramentas discordam sobre o que é um componente (os targeting packs só aparecem no SPDX), então escolha uma e mantenha.

### Assinando um pacote, medido

O `dotnet nuget sign` exige um certificado com o uso estendido de chave de assinatura de código. Criei um autoassinado de 30 dias com `openssl req -x509 ... extendedKeyUsage=critical,codeSigning` e exportei um `.pfx`:

```text
dotnet nuget sign pkg.nupkg --certificate-path signer.pfx --certificate-password ...
  warn NU3002 (sem timestamper), warn NU3042 / NU3018 UntrustedRoot     (o pacote FOI assinado)
dotnet nuget verify pkg.nupkg
  Signature type: Author, Subject Name: O=Acme, CN=Acme Test Code Signing, SHA256 hash: D0D655E0...
  error: NU3018: The author primary signature's signing certificate is not trusted by the trust provider.   exit 1
verify --certificate-fingerprint D0D655E0...   -> o mesmo NU3018, exit 1 (a impressão digital não substitui a confiança)
trocar a DLL dentro do pacote assinado         -> error NU3008: The package integrity check failed.
certificado com EKU serverAuth                 -> error NU3018: NotValidForUsage: The key usage is incorrect.
--timestamper http://invalid.localhost         -> error: Connection refused (a assinatura aborta)
```

Ou seja, um certificado autoassinado assina, e o `verify` mostra quem assinou e detecta adulteração, mas falha na checagem de confiança: autoassinado serve só para teste. Um certificado real, um servidor de timestamp (sem ele a assinatura morre junto com o certificado) e o registro no nuget.org são só documentação. O nuget.org exige que, depois que você registra um certificado, toda submissão seguinte seja assinada. A assinatura prova quem e que nada mudou (assinar de novo exige `--overwrite`, senão `NU3001`); não diz que o código é seguro.

### Publicando: duplicados, prerelease, tags

Uma pasta como source aceita qualquer push e ignora o `--skip-duplicate` (`warn: The option to skip duplicates is not currently supported for this type of push`), como no concept de empacotamento. Para um protocolo de verdade escrevi um servidor Python de 30 linhas na porta 6760 (índice de serviço com `PackagePublish/2.0.0`, `201` no primeiro PUT, `409` para os mesmos bytes de novo, encerrado depois) e fiz push com `--allow-insecure-connections`:

```text
primeiro push                      Created .../api/v2/package/   "Your package was pushed."   (o servidor viu o header da API key)
mesmo pacote de novo               Conflict ... 409,  "To skip already published packages, use the option --skip-duplicate"   exit 1
mesmo pacote, --skip-duplicate     Conflict ... 409 engolido, exit 0
```

O `--skip-duplicate` é o que torna seguro reexecutar o job de publish depois de uma falha parcial. Não é licença para sobrescrever: as versões do nuget.org são imutáveis (veja o concept de empacotamento).

### Trusted publishing, attestations, Sigstore (só documentação)

Nada aqui foi executado: precisa de um repositório GitHub real e de uma conta no nuget.org. O trusted publishing do NuGet substitui a API key guardada. Você registra no nuget.org uma política com o dono do repositório, o repositório, o nome do arquivo de workflow (e, opcionalmente, um environment); o workflow pede um token OIDC ao GitHub, o `NuGet/login@v1` o troca em `https://www.nuget.org/api/v2/token`, e a saída `NUGET_API_KEY` do passo é uma chave temporária que o nuget.org documenta como válida por 1 hora. O job precisa de `permissions: id-token: write`. É a mesma ideia de workload identity: uma afirmação assinada pela plataforma em vez de um segredo compartilhado, veja [workload-identity-service-accounts-mtls-and-spiffe](/identity-concepts/workload-identity-service-accounts-mtls-and-spiffe).

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

As attestations de artefato (`actions/attest@v4`, com `id-token: write`, `contents: read`, `attestations: write` e `subject-path`) registram a proveniência do build de um arquivo: qual workflow de qual repositório o construiu. A página de conceitos do GitHub as liga aos níveis de build do SLSA e diz que as gera com Sigstore; não executei e não afirmo nada além dessa página. Nenhuma substitui o `dotnet nuget sign`: a proveniência diz onde foi construído, a assinatura NuGet é o que o cliente confere no restore.

### Pipelines de aplicação e segurança do pipeline

Numa aplicação o artefato é uma imagem: o `dotnet publish /t:PublishContainer` está em [containerizing-dotnet-sdk-publish-dockerfile-chiseled](containerizing-dotnet-sdk-publish-dockerfile-chiseled), e um binário single-file ou AOT em [self-contained-single-file-and-trimmed-publishing](self-contained-single-file-and-trimmed-publishing) e [native-aot-and-its-limits](native-aot-and-its-limits). O deploy (enviar a imagem, atualizar o serviço) é só documentação aqui e depende da sua plataforma.

Segurança do pipeline em si (prosa, só documentação): `pull_request` roda o código mesclado com token somente leitura e sem segredos para forks, enquanto `pull_request_target` roda o workflow da branch base com segredos, então nunca faça checkout e execute o código do pull request sob ele. Fixe actions de terceiros num commit SHA completo, porque uma tag pode ser movida (o guia de hardening apresenta isso para repositórios que não conseguem adotar os workflow dependency lockfiles). Dê ao workflow `permissions: contents: read` e eleve por job. Prefira OIDC a segredos e guarde segredos de release num environment com revisores obrigatórios. Mantenha as fixações atualizadas com o Dependabot, cujos ecossistemas `nuget` (`package-ecosystem: nuget`) e `github-actions` vão em `.github/dependabot.yml`, com `schedule: {interval: weekly}` e um `cooldown` (`default-days: 7`; a documentação diz que o padrão é 3 dias) para que uma versão publicada há uma hora não seja adotada. Não validei nenhum dos dois arquivos contra o GitHub, só o workflow com o `actionlint`.

### O pipeline numa tabela

| Etapa | Ferramenta | O que garante | Como medi | Armadilha |
|---|---|---|---|---|
| Restore | `--locked-mode`, `packages.lock.json` | mesmo grafo e hashes | `NU1004` na divergência | a chave de cache depende do lock file |
| Format | `dotnet format --verify-no-changes` | estilo | exit 0 e depois 2 | precisa de projeto restaurado |
| Build | `-c Release --no-restore`, warnings como erros | nenhum warning novo | 1.77 s | warnings de audit são só warnings até serem escalados |
| Teste e cobertura | MSTest, `coverlet.collector` ou MTP, ReportGenerator | testes passam, piso de cobertura | 63.6% contra um gate de 80 | o collector não tem threshold; Debug e Release diferem |
| Build determinístico | `ContinuousIntegrationBuild`, `Deterministic` | mesma DLL de qualquer caminho | hash igual em dois clones | os bytes do `.nupkg` ainda diferem |
| SourceLink | SDK ou `Microsoft.SourceLink.GitHub` | DLL até o commit | `sourcelink print-json` | `test` falha em repositórios não publicados |
| Versão | MinVer ou NBGV | versão vinda da tag | tabela acima | clone raso dá `0.0.0` |
| Vulnerabilidades | NuGetAudit, `list package --vulnerable` | advisories conhecidas | `NU1903` no 12.0.3 | o comando list sai com 0 |
| SBOM | CycloneDX, sbom-tool | inventário com hashes | 22 componentes, 5 pacotes | arquivos antigos, diferença entre ferramentas |
| Assinatura | `dotnet nuget sign` e `verify` | autor e integridade | `NU3018`, `NU3008` | autoassinado nunca verifica; sem timestamp |
| Publicação | `dotnet nuget push --skip-duplicate`, trusted publishing | idempotente, sem chave guardada | 201, 409, exit 0 | OIDC e attestations são só documentação |

## Trade-offs

- **Cachear tudo contra não cachear nada.** O restore caiu de cerca de 2,5 s para 0,5 s; um cache velho pode esconder um pacote removido na origem. Use o lock file na chave e mantenha o `--locked-mode`.
- **Gates duros contra fluxo do desenvolvedor.** Warnings como erros e um piso de cobertura barram regressões, e também barram um hotfix por causa de uma atualização de analyzer instável. Fixe o `AnalysisLevel` e ajuste o piso ao que o código realmente tem.
- **`ContinuousIntegrationBuild` só no CI.** Hashes reproduzíveis precisam dele, a depuração local precisa dos caminhos reais; a condição `CI` dá os dois.
- **PDB embedded ou portable.** Embedded é um arquivo só e nenhum feed de símbolos, por cerca de 2,4 vezes o tamanho da DLL aqui; portable mais `snupkg` é menor e precisa de hospedagem.
- **MinVer contra Nerdbank.GitVersioning.** A tag como fonte da verdade é mais simples e quebra em clones rasos; um `version.json` é revisável e um arquivo a mais para manter.
- **CycloneDX contra SPDX.** Escolha o que os scanners dos seus consumidores leem; as duas ferramentas que rodei discordam sobre o que é um componente.
- **Trusted publishing contra API key.** Nenhum segredo para rotacionar ou vazar, em troca de uma política registrada, presa a um repositório e a um nome de workflow; renomear o arquivo do workflow a quebra.

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
