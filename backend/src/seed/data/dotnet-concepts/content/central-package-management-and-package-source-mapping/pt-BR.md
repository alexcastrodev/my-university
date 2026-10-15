---
version: 1.0
updatedAt: 2026-10-15
title: "Central Package Management e Package Source Mapping"
summary: Versões centralizadas em Directory.Packages.props (VersionOverride, pinning transitivo, GlobalPackageReference) e mapeamento de fontes no nuget.config para barrar dependency confusion, com os erros reais e os limites de cada um.
---
## Objective

Duas features do NuGet transformam o tratamento de dependências de um hábito de
cada projeto em uma política do repositório. O Central Package Management (CPM)
move todas as versões para um único `Directory.Packages.props`, então dez
projetos não conseguem divergir em dez versões da mesma biblioteca. O Package
Source Mapping (PSM) declara, no `nuget.config`, qual feed pode fornecer quais
IDs de pacote, o que fecha a porta para ataques de dependency confusion, em que
um pacote público com o mesmo nome do seu pacote interno ganha o restore. Este
concept mostra como as duas funcionam, os erros exatos que você vai encontrar e
onde cada uma deixa de proteger.

## Use Cases

- Uma solution com muitos projetos em que `Newtonsoft.Json` ou `Serilog`
  sempre acaba em versões diferentes.
- Corrigir um pacote transitivo vulnerável uma única vez para o repositório todo.
- Adicionar um analyzer ou pacote de versionamento, só de build, a todos os projetos.
- Usar um feed privado para pacotes `Contoso.*` ao lado do nuget.org sem deixar
  o nuget.org responder por eles.
- Auditar de quais feeds cada pacote da solution pode vir.

## Deep Dive

### Central Package Management

Crie o `Directory.Packages.props` na raiz do repositório, ligue a feature e
declare as versões como itens `PackageVersion`. Os projetos passam a usar
`PackageReference` sem `Version`:

```xml
<!-- Directory.Packages.props -->
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Microsoft.Extensions.Logging" Version="9.0.0" />
    <PackageVersion Include="Newtonsoft.Json" Version="13.0.3" />
  </ItemGroup>
</Project>

<!-- app.csproj -->
<PackageReference Include="Newtonsoft.Json" />
```

O MSBuild importa só o `Directory.Packages.props` mais próximo do projeto, então
um arquivo aninhado precisa importar o pai explicitamente com
`GetPathOfFileAbove`. Os dois primeiros erros que todo mundo comete são pegos no
restore. Escrever a versão no projeto:

```text
error NU1008: The following PackageReference items cannot define a value for Version:
Newtonsoft.Json. Projects using Central Package Management must define a Version
value on a PackageVersion item.
```

E referenciar um pacote que ninguém declarou:

```text
error NU1010: The following PackageReference items do not define a corresponding
PackageVersion item: Serilog.
```

Os dois vieram de um restore real num repositório descartável com o SDK 10.0.100.
A saída de emergência para uma exceção deliberada é o `VersionOverride` na
referência, que vence a versão central:

```xml
<PackageReference Include="Newtonsoft.Json" VersionOverride="12.0.3" />
```

Meu restore com esse override funcionou, e ainda imprimiu o warning `NU1903` de
audit para a 12.0.3, então overrides não escapam do NuGetAudit. Definir
`CentralPackageVersionOverrideEnabled` como `false` transforma override em erro.

Itens `GlobalPackageReference` no mesmo arquivo adicionam um pacote a todos os
projetos como dependência de desenvolvimento (assets só de build,
`PrivateAssets=All`), o que serve para ferramentas de versionamento e analyzers.

### Transitive pinning

A regra de restore do concept anterior diz que a referência mais próxima vence.
O CPM pode promover um pacote transitivo a top-level por você: ligue
`CentralPackageTransitivePinningEnabled` e declare um `PackageVersion` para o
pacote transitivo, sem que nenhum projeto o referencie. No meu teste, o
`Microsoft.Extensions.Logging` 9.0.0 normalmente traz o `Primitives` 9.0.0:

```xml
<PackageVersion Include="Microsoft.Extensions.Logging" Version="9.0.0" />
<PackageVersion Include="Microsoft.Extensions.Primitives" Version="10.0.0" />
```

```text
$ dotnet package list --project app/app.csproj --include-transitive
   > Microsoft.Extensions.Logging    9.0.0   9.0.0
   > Microsoft.Extensions.Primitives         10.0.0   <- fixado, transitivo
```

O pinning só sobe: fixar abaixo do que uma dependência pede gera `NU1109`. E se
o projeto for empacotado, os pacotes fixados viram dependências explícitas no
`.nuspec`, então o autor de uma biblioteca pode acabar publicando dependências
que ninguém esperava. Esse é o principal motivo para ter cuidado com essa chave
em bibliotecas.

### Package Source Mapping

Por padrão o NuGet procura em todas as fontes configuradas, e quando o mesmo ID
existe em dois feeds o vencedor não é algo que você escolheu. Dependency
confusion explora exatamente isso: o atacante publica o nome do seu pacote
interno com uma versão maior no feed público. Reproduzi com dois feeds de pasta
local (um fazendo o papel do feed interno, outro do público, então nada público
foi envolvido). `Contoso.Internal` 1.0.0 no primeiro, 9.9.9 no segundo, e uma
referência flutuante:

```xml
<PackageReference Include="Contoso.Internal" Version="*" />
```

```text
> Contoso.Internal      *           9.9.9      <- veio do feed "público"
```

Um mapeamento no `nuget.config` fixa a fonte por ID:

```xml
<packageSourceMapping>
  <packageSource key="internal">
    <package pattern="Contoso.*" />
  </packageSource>
  <packageSource key="public-sim">
    <package pattern="*" />
  </packageSource>
</packageSourceMapping>
```

```text
> Contoso.Internal      *           1.0.0
```

Os padrões são um ID exato ou um prefixo terminado em `*`. Quando vários casam,
o ID exato vence o prefixo, o prefixo mais longo vence o mais curto, e `*` é o
mais fraco, o que o torna uma fonte padrão conveniente. O ponto central: assim
que existe qualquer mapeamento, todo pacote, transitivos inclusive, precisa
casar com um padrão, senão o restore se recusa a procurar em qualquer lugar:

```text
error NU1100: Unable to resolve 'Newtonsoft.Json (>= 13.0.3)' for 'net10.0'.
PackageSourceMapping is enabled, the following source(s) were not considered:
internal, nuget.org.
```

### Onde a proteção acaba

O mapeamento é aplicado quando o NuGet baixa o pacote. Se o pacote já está na
global packages folder, não há consulta a fonte nenhuma e o mapeamento é
ignorado. Meu primeiro restore do projeto com `Newtonsoft.Json` sem mapeamento
funcionou porque aquela versão já estava na minha pasta de pacotes; o `NU1100`
acima só apareceu depois que apontei `NUGET_PACKAGES` para uma pasta vazia. A
documentação do NuGet recomenda uma global packages folder local ao repositório
quando você quer a garantia completa. Note também que, segundo a documentação, o
mapeamento ainda não filtra comandos de metadados como
`dotnet list package --outdated`, que continuam consultando todas as fontes
configuradas.

Na minha execução, alterar o `nuget.config` e restaurar de novo disse "up to
date" e manteve a resolução antiga até eu usar `restore --force`, então force um
restore depois de editar mapeamentos.

### CPM e mapeamento juntos

Com CPM, o NuGet emite um warning (`NU1507`) quando há mais de uma fonte de
pacotes configurada e nenhum mapeamento definido, que é o empurrão da
documentação para adotar os dois juntos. O texto do warning está documentado; eu
não consegui reproduzi-lo com uma fonte de pasta local, então trate o gatilho
exato como a documentação descreve.

## Trade-offs

- **Uma versão central significa que uma atualização move todo mundo.** Subir a
  versão para um projeto sobe para todos, e uma release ruim quebra todos os
  consumidores de uma vez.
  ```xml
  <PackageReference Include="Newtonsoft.Json" VersionOverride="12.0.3" /> <!-- a saída de emergência -->
  ```
- **`VersionOverride` reconstrói em silêncio a divergência que o CPM removeu.**
  Revise os overrides, ou desligue-os com `CentralPackageVersionOverrideEnabled=false`.
- **Transitive pinning faz bibliotecas carregarem dependências extras.** O
  pacote fixado é escrito no `.nuspec` quando você roda o pack.
- **O source mapping dá manutenção.** Todo prefixo novo de pacote, transitivos
  inclusive, precisa de um padrão, senão alguém esbarra num `NU1100` numa
  atualização de rotina. Um default `*` no feed público troca um pouco de rigor
  por menos surpresas.
- **Um cache aquecido de pacotes contorna o mapeamento.** O CI deve restaurar
  para uma pasta de pacotes limpa e local ao repositório, para realmente testar
  a configuração.
  ```text
  NUGET_PACKAGES=./.nuget/packages dotnet restore
  ```
- **Mapear não substitui reservar o seu prefixo.** Se o seu prefixo interno não
  está reservado no feed público, alguém ainda pode publicá-lo lá, e um default
  `*` apontando para esse feed confiaria nele.

## Documentation Links

- [Central Package Management, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/consume-packages/central-package-management) (doc)
- [Package Source Mapping, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/consume-packages/package-source-mapping) (doc)
- [Security best practices for NuGet feeds, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/concepts/security-best-practices) (doc)
- [nuget.config file reference, packageSourceMapping, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/reference/nuget-config-file) (doc)
- [NU1507 warning reference, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/reference/errors-and-warnings/nu1507) (doc)
