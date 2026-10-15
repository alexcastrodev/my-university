---
version: 1.0
updatedAt: 2026-10-15
title: "Assemblies, Frameworks e Como o Host os Resolve"
summary: Identidade de assembly, assembly de referência versus de implementação, deps.json e runtimeconfig.json lidos de verdade, a resolução do host (DOTNET_ROOT, roll-forward), type forwarding e AssemblyLoadContext, tudo medido no SDK 10.0.100.
---
## Objective

Um programa .NET é uma pasta de assemblies mais dois arquivos JSON pequenos, e
um runtime instalado em outro lugar da máquina. Quando ele inicia, um host
nativo lê esses arquivos, escolhe um runtime, monta uma lista de assemblies
confiáveis e só então o seu `Main` roda. A maioria dos erros "could not load
file or assembly", a maioria das surpresas de versão e todo sistema de plugins
se resumem a essa cadeia. Este conceito a percorre com arquivos e traces reais
no SDK 10.0.100: a identidade do assembly, o assembly de referência que o
compilador viu versus o de implementação que o runtime carrega, o que dizem
`*.deps.json` e `*.runtimeconfig.json`, como o host encontra o runtime, como o
type forwarding deixa um tipo mudar de assembly, e como o `AssemblyLoadContext`
isola cópias do mesmo assembly.

## Use Cases

- Diagnosticar `FileNotFoundException: Could not load file or assembly 'X'`
  quando o `X.dll` está na pasta de saída.
- Entender por que uma biblioteca pode continuar compilando contra
  `netstandard2.0` e mesmo assim rodar no .NET 10.
- Mover um tipo público para outro assembly sem quebrar consumidores que foram
  compilados contra o antigo.
- Carregar plugins com versões próprias de dependências, e descarregá-los.
- Fazer uma máquina de build ou um container encontrar um runtime que não está
  no local padrão.

## Deep Dive

### O que é um assembly e o que ele registra

Um assembly é um `.dll` (ou `.exe`) com IL mais metadados. A identidade tem
quatro partes: nome simples, versão, cultura e public key token (`App,
Version=1.0.0.0, Culture=neutral, PublicKeyToken=null`). Os metadados também
listam todo assembly de que ele precisa. Um console pequeno que usa Humanizer,
uma biblioteca `netstandard2.0` e LINQ registrou isto (lido com
`Assembly.GetReferencedAssemblies()`):

```text
-- what App.dll asks for:
   Humanizer 2.14.0.0
   Legacy 1.0.0.0
   System.Collections 10.0.0.0
   System.Console 10.0.0.0
   System.Linq 10.0.0.0
   System.Runtime 10.0.0.0
-- what Legacy.dll asks for:
   netstandard 2.0.0.0
```

Duas coisas chamam atenção. O compilador registra só os assemblies cujos tipos
o código realmente usou (um projeto referenciado e nunca tocado não aparece). E
`object` é pedido a `System.Runtime`, mas em tempo de execução
`typeof(object).Assembly.GetName().Name` imprimiu `System.Private.CoreLib`. Esses
dois nomes são a próxima seção.

### Assemblies de referência versus de implementação

O compilador não compila contra os arquivos do runtime. Ele compila contra o
reference pack, `packs/Microsoft.NETCore.App.Ref/10.0.0/ref/net10.0/`, que tem
só a superfície pública. O diretório do runtime,
`shared/Microsoft.NETCore.App/10.0.0/`, tem a implementação. Tamanhos nesta
máquina:

| Arquivo | Reference pack | Diretório do runtime |
|---|---|---|
| `System.Runtime.dll` | 862.992 bytes (todas as definições de tipos) | 45.328 bytes (forwarders) |
| `System.Collections.dll` | 55.600 bytes | 328.976 bytes |
| `System.Private.CoreLib.dll` | ausente | 17.065.232 bytes |

O `System.Runtime.dll` do diretório do runtime é quase vazio: ele encaminha seus
tipos para `System.Private.CoreLib`, onde eles realmente vivem. Essa
indireção é o que mantém o contrato público estável enquanto os assemblies de
implementação são reorganizados entre versões.

Seus projetos recebem o mesmo tratamento. Compilar um projeto produz
`obj/Debug/net10.0/ref/Contracts.dll` ao lado do real (o compilador é chamado
com `/out:` e `/refout:`), e um `ProjectReference` é compilado contra a cópia de
referência. Ela carrega `ReferenceAssemblyAttribute` e os membros privados são
removidos. Inspecionando os dois arquivos com `System.Reflection.Metadata`:

```text
net10.0/Contracts.dll   public Defaults: public Prefix; assembly Hidden; private Helper
ref/Contracts.dll       public Defaults: public Prefix
(com <InternalsVisibleTo Include="Contracts.Tests" />)
ref/Contracts.dll       public Defaults: public Prefix; assembly Hidden
```

`assembly` é o nome em metadados para `internal`. Membros internos ficam no
assembly de referência só quando existe `InternalsVisibleTo`, porque alguém
precisa conseguir compilar contra eles (a documentação de reference assemblies
do Roslyn declara a mesma regra). Esse é o mecanismo por trás do padrão
`internal` mais `InternalsVisibleTo` do conceito "Modular Monolith Module
Boundaries".

Uma consequência prática são os builds incrementais. Mudar só o corpo de um
método em `Contracts` recompilou o `Contracts.dll`, mas o assembly de
referência era idêntico, e o `obj/.../App.dll` do `App` manteve o timestamp.
Mudar uma assinatura pública recompilou o `App`. Os assemblies de referência
são o que torna essa decisão barata.

### deps.json: o manifesto da aplicação

O `App.deps.json` lista cada assembly que o app usa e de onde veio:

```json
"Humanizer.Core/2.14.1": {
  "runtime": { "lib/net6.0/Humanizer.dll": { "assemblyVersion": "2.14.0.0", "fileVersion": "2.14.1.48190" } }
},
"Legacy/1.0.0": { "runtime": { "Legacy.dll": { "assemblyVersion": "1.0.0.0" } } }
```

A seção `libraries` marca cada entrada como `project` ou `package` e traz o
hash do pacote. O build copia o `lib/net6.0/Humanizer.dll` do Humanizer para a
pasta de saída: o NuGet escolheu o melhor alvo compatível com `net10.0` (as
regras de seleção estão no conceito "NuGet Restore, Versions and Dependency
Resolution"). O host usa esse arquivo para decidir o que faz parte do app.

Isso tem uma aresta cortante. Num experimento, uma biblioteca `LibA` moveu seu
tipo para `LibB`; o novo `LibB.dll` foi copiado para a pasta do app ao lado do
`App.dll`, mas o `App.deps.json` não o listava:

```text
Unhandled exception. System.IO.FileNotFoundException: Could not load file or assembly 'LibB, Version=1.0.0.0, ...'. The system cannot find the file specified.
```

O arquivo estava ali. Apagar o `App.deps.json` fez funcionar, porque sem esse
arquivo o host assume que o diretório da aplicação contém todas as dependências
e usa o conteúdo dele (a documentação de default probing descreve os dois
casos). Uma cópia numa subpasta continuou não sendo encontrada.

### runtimeconfig.json e o resolvedor do host

O `App.runtimeconfig.json` declara o framework de que o app precisa:

```json
{ "runtimeOptions": { "tfm": "net10.0",
    "framework": { "name": "Microsoft.NETCore.App", "version": "10.0.0" } } }
```

Um projeto web, de `Microsoft.NET.Sdk.Web`, tem um array `frameworks` com
`Microsoft.NETCore.App` e `Microsoft.AspNetCore.App`: é isso que o item
`FrameworkReference` do SDK significa (`-getItem:FrameworkReference` imprimiu
uma entrada para o console, duas para o app web, e o template worker tem só a
primeira). Um framework é um conjunto nomeado de assemblies instalado uma vez e
compartilhado, com seu próprio `*.deps.json`.

O apphost (`./App`) e o `dotnet App.dll` rodam o mesmo resolvedor. Com
`DOTNET_HOST_TRACE=1` (o antigo `COREHOST_TRACE=1` também funcionou aqui) a
sequência nesta máquina foi:

```text
Looking for architecture-specific install_location file in '/etc/dotnet/install_location_arm64'.
Found registered install location '/usr/local/share/dotnet'.
Reading fx resolver directory=[/usr/local/share/dotnet/host/fxr]
Considering fxr version=[8.0.22]...  [9.0.11]...  [10.0.0]...
Detected latest fxr version=[.../host/fxr/10.0.0]
App runtimeconfig.json from [.../App.dll]
Resolving FX directory, name 'Microsoft.NETCore.App' version '10.0.0'
'Roll forward' enabled with version_compatibility_range [minor]. Looking for the lowest release greater than or equal version to [10.0.0]
Found version [10.0.0]
```

O host escolhe o `hostfxr` mais novo, que lê o runtimeconfig e aplica a
política de roll-forward sobre os runtimes instalados (as políticas estão em
"The .NET Support Lifecycle and Choosing a Target"). De onde vem a raiz do dotnet
é o que se deve lembrar quando um container ou uma imagem de CI não acha o
.NET. A mensagem `You must install .NET` lista os lugares pesquisados, e os
experimentos mostraram a ordem e os modos de falha:

- `DOTNET_ROOT` apontando para um diretório que não existe é ignorado com
  `Did not find [DOTNET_ROOT] directory [/nonexistent]`, e o local de instalação
  registrado é usado no lugar.
- `DOTNET_ROOT` apontando para um diretório que existe é usado, mesmo sem
  runtime dentro: o app falha com `You must install .NET to run this
  application`, listando o diretório da aplicação e `DOTNET_ROOT` como lugares
  pesquisados.
- Um diretório com o layout `host/` e `shared/Microsoft.NETCore.App/10.0.0/`
  (montado aqui com symlinks) foi aceito, e o trace imprimiu `Using environment
  variable DOTNET_ROOT=[...] as runtime location`.
- `DOTNET_ROOT_ARM64` (a forma com sufixo de arquitetura) foi reconhecido do
  mesmo jeito.

Depois da resolução, o host passa ao runtime uma lista
`TRUSTED_PLATFORM_ASSEMBLIES` construída a partir dos arquivos deps do app e do
framework. O app teve 177 entradas; as quatro que vieram da pasta do app foram
`App`, `Contracts`, `Legacy` e `Humanizer`, e o `netstandard.dll` resolveu para
a fachada dentro da pasta do framework compartilhado. É assim que uma biblioteca
`netstandard2.0` roda no .NET 10: a referência a `netstandard` é satisfeita por
uma fachada que encaminha para os tipos reais.

### Type forwarding

O truque da fachada está disponível para as suas bibliotecas. Um tipo que sai
de `LibA` para `LibB` pode deixar um forwarder para trás:

```csharp
// LibA v2: nenhum tipo, só isto
[assembly: System.Runtime.CompilerServices.TypeForwardedTo(typeof(Shapes.Greeter))]
```

O `App` foi compilado uma vez contra a `LibA` v1, onde `Shapes.Greeter` vivia.
Os metadados dele dizem "tipo `Greeter` no assembly `LibA`". Depois de
substituir o `LibA.dll` pela v2 e adicionar o `LibB.dll` (sem recompilar, sem
`deps.json`, veja acima), o programa imprimiu `hi from LibB` e `type lives in:
LibB`. Se o `LibB.dll` falta, a falha é a `FileNotFoundException` para `LibB`
mostrada antes, e não um tipo ausente em `LibA`, porque o forwarder aponta para
ele pelo nome. É exatamente assim que `System.Runtime` e `netstandard`
funcionam, e como bibliotecas reorganizam assemblies sem quebra de contrato.

### AssemblyLoadContext: várias cópias no mesmo processo

Por padrão todo assembly vai para `AssemblyLoadContext.Default`, que resolve
pela lista confiável acima, então um nome significa um assembly. Um
`AssemblyLoadContext` customizado é um espaço separado para assemblies
carregados. Carregando o mesmo arquivo `Plugin.dll` em dois contextos, medido:

```text
Same Assembly object? False
Same Type object?     False
Contexts: plugin-a, plugin-b
Counter.Value in A = 42, in B = 0
Default context holds a third copy? True
Context A collected after Unload: True
```

Cada contexto tem seu próprio estado estático, e o `Plugin.Counter` do contexto
A não é o mesmo `Type` do B, então um cast entre eles falha. Esse é o preço e o
objetivo: plugins podem trazer versões diferentes de uma dependência. Contextos
colecionáveis (`isCollectible: true`) podem ser descarregados, mas só quando
nada os referencia. A primeira tentativa imprimiu `collected: False` num build
Debug porque variáveis locais mantinham o contexto vivo; mover o carregamento e
o uso para um método com `[MethodImpl(MethodImplOptions.NoInlining)]` resolveu.
Por fim, o evento `Resolving` do contexto Default dispara quando um assembly não
é encontrado, e é o gancho para probing customizado. No teste ele disparou para
`Missing.Thing` antes da exceção ser lançada.

Note que no contexto Default a lista confiável vence: segundo a documentação,
chamar `LoadFromAssemblyPath` ali para um nome que já está em
`TRUSTED_PLATFORM_ASSEMBLIES` carrega o confiável, não o seu caminho.

## Trade-offs

- **Um manifesto deixa a inicialização exata e torna copiar arquivos
  inseguro.** Com `deps.json`, só os assemblies listados são visíveis; "só jogar
  a DLL ao lado do exe" falha. Sem ele, tudo na pasta é visível, inclusive um
  arquivo velho que você esqueceu.
- **Assemblies de referência aceleram builds e escondem a implementação
  real.** Você compila contra um contrato, não contra o que roda. Um membro que
  existe na implementação mas não na referência não compila, de propósito.
  Debuggers e decompiladores precisam dos arquivos de implementação.
- **O roll-forward é conveniente e significa que a máquina decide.**
  `Microsoft.NETCore.App` 10.0.0 no runtimeconfig rodou em qualquer 10.x
  instalado. Publicar self-contained remove a dúvida e também a atualização de
  segurança compartilhada.
  ```json
  "framework": { "name": "Microsoft.NETCore.App", "version": "10.0.0" }
  ```
- **`DOTNET_ROOT` é aceito como veio.** Um diretório errado mas existente falha
  pior do que um errado e inexistente, que cai em silêncio para o padrão. Em
  containers, prefira o layout da própria imagem a definir a variável.
- **Type forwarders são permanentes.** Quando consumidores dependem do nome do
  assembly antigo, o forwarder tem de ficar, e o assembly para o qual ele
  encaminha tem de ser entregue junto.
- **Contextos de carga customizados isolam e dobram memória.** Duas cópias de um
  tipo são dois tipos. Compartilhe só o que precisa cruzar a fronteira (um
  assembly de interfaces carregado no contexto default), a mesma ideia de um
  projeto de contratos.
- **Descarregar é cooperativo.** Uma única referência estática, thread ou
  handler de evento apontando para dentro do contexto o mantém vivo, e a falha é
  silenciosa.

## Documentation Links

- [Default probing, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/dependency-loading/default-probing) (doc)
- [Understanding System.Runtime.Loader.AssemblyLoadContext, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/dependency-loading/understanding-assemblyloadcontext) (doc)
- [Managed assembly loading algorithm, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/dependency-loading/loading-managed) (doc)
- [Type forwarding in the common language runtime, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/assembly/type-forwarding) (doc)
- [Reference assemblies, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/assembly/reference-assemblies) (doc)
- [Troubleshoot app launch failures, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/runtime-discovery/troubleshoot-app-launch) (doc)
- [Reference assemblies in Roslyn (refout), dotnet/roslyn](https://github.com/dotnet/roslyn/blob/main/docs/features/refout.md) (doc)
