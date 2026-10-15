---
version: 1.0
updatedAt: 2026-10-15
title: "Empacotando e publicando uma biblioteca NuGet"
summary: Do .csproj ao pacote com dotnet pack (metadados, readme, símbolos, Source Link), regras de SemVer, validação de pacote contra uma baseline, teste por feed local e o que publicar no nuget.org ou em feed privado realmente significa.
---
## Objective

Consumir pacotes é metade do NuGet; a outra metade é produzir um pacote em que
outras equipes possam confiar. Um pacote é um zip com um manifesto: o
`dotnet pack` compila o projeto e escreve o `.nuspec` a partir de propriedades
do MSBuild, então o arquivo de projeto é a única fonte da verdade. Este
conceito cobre as propriedades que importam, as regras de SemVer que definem
como os consumidores resolvem suas versões, símbolos e Source Link, como testar
o pacote em um feed local antes de publicar, como a validação de pacote pega
quebras acidentais de API e o que publicar no nuget.org ou em um feed privado
significa depois que o push deu certo.

## Use Cases

- Compartilhar uma biblioteca de domínio entre vários serviços sem copiar
  projetos.
- Publicar um SDK interno em um feed privado, com builds prerelease vindos do
  CI.
- Lançar uma biblioteca open source no nuget.org com símbolos e readme.
- Pegar a remoção de um método público antes do release, e não depois que um
  consumidor quebrou.
- Verificar que o pacote restaura e roda em um projeto consumidor limpo.

## Deep Dive

### Do arquivo de projeto ao pacote

Tudo mora no `.csproj`. Esta é a biblioteca usada em todos os exemplos, com os
metadados que um pacote público normalmente precisa:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <PackageId>Contoso.Greeter</PackageId>
    <Version>1.2.0-beta.1</Version>
    <Authors>Contoso</Authors>
    <Description>Greets people.</Description>
    <PackageLicenseExpression>MIT</PackageLicenseExpression>
    <PackageReadmeFile>README.md</PackageReadmeFile>
    <PublishRepositoryUrl>true</PublishRepositoryUrl>
    <IncludeSymbols>true</IncludeSymbols>
    <SymbolPackageFormat>snupkg</SymbolPackageFormat>
    <GenerateDocumentationFile>true</GenerateDocumentationFile>
  </PropertyGroup>
  <ItemGroup>
    <None Include="README.md" Pack="true" PackagePath="\" />
  </ItemGroup>
</Project>
```

Rodar `dotnet pack -o feed` neste projeto (SDK 10.0.100) gerou dois arquivos,
`Contoso.Greeter.1.2.0-beta.1.nupkg` e um `.snupkg`. O `.nupkg` continha
exatamente:

```text
Contoso.Greeter.nuspec
lib/net10.0/Greeter.dll
lib/net10.0/Greeter.xml     <- por causa de GenerateDocumentationFile
README.md                   <- só por causa do item Pack="true" explícito
```

Dois detalhes pegam iniciantes. O readme (e um ícone ou arquivo de licença)
precisa ser declarado duas vezes: a propriedade diz o caminho dentro do pacote,
e um item `None` com `Pack="true"` é que de fato coloca o arquivo lá. Além
disso, o `dotnet pack` usa a configuração `Release` por padrão em projetos que
miram `net8.0` ou posterior, e por isso a saída acima veio de `bin/Release`. O
`.snupkg` tinha só `lib/net10.0/Greeter.pdb`, o PDB portável, porque
`SymbolPackageFormat` era `snupkg`; o formato padrão é o `symbols.nupkg`
legado.

O pack faz build e restore implícitos. Use `--no-build` no CI quando uma etapa
anterior já compilou o código. Projetos que nunca devem gerar pacote (testes,
ferramentas, apps de demonstração) desligam com `<IsPackable>false</IsPackable>`;
na minha execução, `dotnet pack -p:IsPackable=false` não imprimiu nada e não
criou arquivo. Referências de projeto não são embutidas: se a biblioteca
referencia outro projeto, esse projeto também precisa ser empacotado, e o
`.nuspec` o lista como dependência.

### Versões e SemVer

O NuGet segue SemVer 2.0 para ordenação. Um `1.0.1` estável vem acima de
qualquer `1.0.1-*` prerelease, e partes numéricas separadas por ponto são
comparadas como números, então `1.0.1-rc.10` fica acima de `1.0.1-rc.2`,
enquanto um rótulo como `alpha10` é comparado como texto e fica abaixo de
`alpha2`. Se quiser números no rótulo sem pontos, complete com zeros
(`beta05`). Metadado de build depois do `+` é ignorado ao casar versões, e um
quarto segmento zero é descartado, então `1.0.0.0` e `1.0.0` são a mesma
versão.

Qual propriedade vence é fonte comum de confusão. `PackageVersion` assume o
valor de `Version`. No CI, prefira `VersionPrefix` mais `VersionSuffix`, porque
`dotnet pack --version-suffix ci-1234` só tem efeito quando você não definiu
`Version`; se `Version` tem valor, o sufixo é ignorado.

```text
VersionPrefix 0.1.2 + --version-suffix rc.1  ->  0.1.2-rc.1
Version 1.2.0-beta.1 + --version-suffix rc.1 ->  1.2.0-beta.1 (sufixo ignorado)
```

Uma versão é uma promessa: remover um método público é mudança de major.
Depois que uma versão chega a um feed, trate-a como imutável. A próxima seção
mostra como fazer essa promessa valer de forma mecânica.

### Validação de pacote

Ligue `EnablePackageValidation` e defina uma baseline, e o `pack` compara o
seu novo assembly com o anteriormente publicado. Subi o exemplo para `1.2.0`,
renomeei `Hello` para `Hi` e apontei a baseline para o beta em um feed local:

```xml
<EnablePackageValidation>true</EnablePackageValidation>
<PackageValidationBaselineVersion>1.2.0-beta.1</PackageValidationBaselineVersion>
```

O pack falhou com:

```text
error CP0002: Member 'string Contoso.Greeter.Hello(string)' exists on [Baseline]
lib/net10.0/Greeter.dll but not on lib/net10.0/Greeter.dll
error : API breaking changes found. If those are intentional, the APICompat
suppression file can be updated by rebuilding with '/p:ApiCompatGenerateSuppressionFile=true'
```

A mesma feature também confere se um pacote multi-target expõe APIs
consistentes em cada alvo, o que importa para o próximo conceito. Para
rastreabilidade até o código-fonte, defina `PublishRepositoryUrl`. Em uma pasta
que era um repositório git com remoto `origin`, o `.nuspec` ganhou
`<repository type="git" url="..." branch="..." commit="..." />` sem instalar
nenhum pacote extra. O commit permite a um depurador ou a uma ferramenta como o
NuGet Package Explorer ligar a DLL ao código-fonte.

### Teste o pacote antes de publicar

Uma biblioteca que compila ainda pode ser um pacote quebrado: arquivo faltando,
grupo de dependências errado, readme que não foi empacotado. Teste o artefato,
não o projeto. Empacote em uma pasta e consuma de um projeto descartável cujo
`nuget.config` limpa todas as outras fontes:

```xml
<configuration>
  <packageSources>
    <clear />
    <add key="local" value="../feed" />
  </packageSources>
</configuration>
```

Com `<PackageReference Include="Contoso.Greeter" Version="1.2.0-beta.1" />` em
um app de console, o `dotnet run` imprimiu `Hello, NuGet!`. Uma pasta é uma
fonte NuGet válida e mantém o experimento longe do nuget.org. Um efeito
colateral: o restore copia o pacote para a pasta global de pacotes, então se
você republicar a mesma versão localmente durante o teste, o restore pode
continuar usando a cópia em cache. Suba a versão ou faça o restore com
`RestorePackagesPath` apontando para uma pasta de rascunho.

### Publicando

`dotnet nuget push arquivo.nupkg --source <feed> --api-key <chave>` funciona
com qualquer feed que implemente o protocolo. Para uma pasta, ele apenas copia
o arquivo; minha execução imprimiu `Your package was pushed.`, e um segundo
push da mesma versão fez o mesmo, com `--skip-duplicate` avisando que não é
suportado para esse tipo de push. Um feed de verdade se comporta diferente,
então nunca dependa de sobrescrever.

Para o nuget.org, você precisa de uma API key. A documentação recomenda
restringir o escopo: só push, limitada a um glob de pacotes, com data de
expiração. A partir do NuGet 7.6 (SDK 10.0.300), a variável de ambiente
`NUGET_API_KEY` pode substituir o `--api-key`, o que tira o segredo da linha de
comando no CI. Depois do push o pacote é validado e indexado, normalmente em
menos de 15 minutos, e nesse intervalo aparece como não listado. A propriedade
do pacote é da conta por trás da API key, não do campo `Authors`. A assinatura
de pacote é separada e opcional até você registrar um certificado no
nuget.org; a partir daí toda submissão daquela conta precisa ser assinada, e
certificados autoemitidos são rejeitados.

## Trade-offs

- **Tudo no arquivo de projeto** mantém os metadados junto do código, mas
  metadado repetido em dez bibliotecas pertence ao `Directory.Build.props`
  (veja o conceito de projetos SDK-style), não copiado em dez projetos.
- **Rótulos prerelease em todo build de CI** deixam consumidores testar cedo,
  mas poluem o feed. Dê a eles uma política de retenção, porque consumidores
  com faixas flutuantes de prerelease vão pegá-los.
- **Validação de pacote** bloqueia quebras acidentais, mas precisa de uma
  versão baseline publicada em local acessível e quebra o build quando você
  renomeia algo de propósito; aí você suprime com um arquivo que precisa
  revisar.
- **Símbolos como `snupkg`** dão aos consumidores depuração passo a passo, mas
  o feed precisa hospedar o pacote de símbolos também, e nem todo feed privado
  hospeda. Confira antes de depender disso.
- **Versões imutáveis** protegem os consumidores, mas um release ruim só se
  corrige com uma nova versão.

## Documentation Links

- [dotnet pack command](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-pack)
- [NuGet pack and restore as MSBuild targets](https://learn.microsoft.com/en-us/nuget/reference/msbuild-targets)
- [NuGet package versioning](https://learn.microsoft.com/en-us/nuget/concepts/package-versioning)
- [Package validation overview](https://learn.microsoft.com/en-us/dotnet/fundamentals/apicompat/package-validation/overview)
- [Publish NuGet packages](https://learn.microsoft.com/en-us/nuget/nuget-org/publish-a-package)
- [Signing NuGet packages](https://learn.microsoft.com/en-us/nuget/create-packages/sign-a-package)
