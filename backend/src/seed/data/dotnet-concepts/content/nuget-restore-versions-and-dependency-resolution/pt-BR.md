---
version: 1.0
updatedAt: 2026-10-14
title: "NuGet: Restore, Versões e Resolução de Dependências"
summary: Notação de versões, regras de resolução do restore (menor versão aplicável, dependência direta vence), versões flutuantes, lock files, NuGetAudit e o que mudou no restore do .NET 9 e do .NET 10.
---
## Objective

O `dotnet restore` transforma as linhas `PackageReference` do seu projeto em um
grafo plano de versões exatas e grava o resultado em `obj/project.assets.json`.
A maioria dos builds que "funcionavam ontem", das atualizações surpresa e dos
avisos de segurança ignorados vem de não saber como esse grafo é decidido. Este
concept cobre a notação de versões, as regras de resolução (menor versão
aplicável, dependência direta vence, cousin dependencies), versões flutuantes e
lock files para restores repetíveis, e as ferramentas que mostram o que está
desatualizado, vulnerável ou simplesmente por que um pacote está ali.

## Use Cases

- Ler um erro `NU1605` de downgrade e saber qual referência direta resolve.
- Decidir se uma dependência deve ser fixada, ter um range ou flutuar.
- Fazer o CI restaurar exatamente os mesmos pacotes da máquina do desenvolvedor.
- Descobrir qual pacote traz uma dependência transitiva vulnerável.
- Entender o que mudou na performance do restore e nos defaults de audit no .NET 9 e no .NET 10.

## Deep Dive

### Notação de versões

Um `Version="9.0.0"` puro não é um pin exato. Significa "9.0.0 ou superior", e o
restore escolhe a menor versão que satisfaz todas as restrições do grafo.
Colchetes tornam a versão exata, e `*` faz flutuar:

```xml
<PackageReference Include="A" Version="6.1" />        <!-- >= 6.1, resolve para a menor disponível -->
<PackageReference Include="A" Version="[6.1.0]" />    <!-- exatamente 6.1.0 -->
<PackageReference Include="A" Version="[1.3.2,1.5)" /> <!-- de 1.3.2 até, sem incluir, 1.5 -->
<PackageReference Include="A" Version="6.*" />        <!-- a maior 6.x.y estável -->
```

Versões pre-release só entram na conta quando o projeto, ou algo no grafo, pede
uma. Evite limite superior em pacotes que não são seus: isso impede quem
consome de receber correções.

### As regras de resolução

O restore aplica quatro regras. A menor versão aplicável vence quando nada diz o
contrário, então um pacote que pede `>= 2.1` recebe a 2.2 se a 2.1 não existe no
feed. Uma versão flutuante resolve para a maior que casa com o padrão. Cousin
dependencies (o mesmo pacote pedido em ramos diferentes) resolvem para a menor
versão que satisfaz todos os pedidos. E a dependência direta vence: um pacote
que você referencia no próprio projeto ganha do que o grafo transitivo pediu,
mesmo que isso signifique descer de versão.

Essa última regra é a origem do `NU1605`. Referenciei
`Microsoft.Extensions.Logging` 9.0.0, que exige
`Microsoft.Extensions.DependencyInjection.Abstractions >= 9.0.0`, e também pedi
a versão 8.0.0 das abstractions diretamente:

```text
error NU1605: Warning As Error: Detected package downgrade:
  Microsoft.Extensions.DependencyInjection.Abstractions from 9.0.0 to 8.0.0.
  a -> Microsoft.Extensions.Logging 9.0.0 -> Microsoft.Extensions.DependencyInjection 9.0.0
    -> Microsoft.Extensions.DependencyInjection.Abstractions (>= 9.0.0)
  a -> Microsoft.Extensions.DependencyInjection.Abstractions (>= 8.0.0)
Failed to restore a.csproj
```

Subir a referência direta para `10.0.0` resolve, e a versão direta é a que entra
no grafo. Corrigir subindo a versão, e não suprimindo o aviso, importa: um
downgrade significa um pacote rodando contra uma dependência mais antiga do que
aquela para a qual foi compilado.

### Vendo o grafo

Três comandos respondem a maioria das perguntas:

```text
$ dotnet list package --include-transitive
   Top-level Package                                         Requested   Resolved
   > Microsoft.Extensions.DependencyInjection.Abstractions   10.0.0      10.0.0
   > Microsoft.Extensions.Logging                            9.0.0       9.0.0
   Transitive Package                                        Resolved
   > Microsoft.Extensions.Logging.Abstractions               9.0.0
   > Microsoft.Extensions.Options                            9.0.0

$ dotnet nuget why a.csproj Microsoft.Extensions.Primitives
   └─ Microsoft.Extensions.Logging (v9.0.0)
      └─ Microsoft.Extensions.Options (v9.0.0)
         └─ Microsoft.Extensions.Primitives (v9.0.0)

$ dotnet list package --outdated
   > Newtonsoft.Json   12.0.1   12.0.1   13.0.4
```

O `dotnet nuget why` mostra o caminho do seu projeto até um pacote transitivo, que
é a primeira coisa de que você precisa quando uma vulnerabilidade aparece em algo
que você nunca referenciou.

### Versões flutuantes e lock files

Uma versão flutuante como `9.0.*` anda sempre que sai um patch novo, então dois
restores em dias diferentes podem divergir. Com `RestorePackagesWithLockFile`
igual a `true`, o restore grava um `packages.lock.json` ao lado do projeto com
toda versão resolvida e um hash de conteúdo. Minha referência `9.0.*` ficou
fixada assim:

```json
"Microsoft.Extensions.Logging.Abstractions": {
  "type": "Direct",
  "requested": "[9.0.*, )",
  "resolved": "9.0.21",
  "contentHash": "y1yIJYal...",
  "dependencies": { "Microsoft.Extensions.DependencyInjection.Abstractions": "9.0.21" }
}
```

Versione o arquivo. Os restores seguintes o reutilizam, e o flutuante passa a ser
reproduzível. No CI, use `--locked-mode` (ou `RestoreLockedMode`): o restore falha
se o lock file não bate mais com o projeto, em vez de reescrevê-lo. Depois que
adicionei outra `PackageReference` sem atualizar o lock:

```text
error NU1004: The package references have changed for net10.0. ...
The packages lock file is inconsistent with the project dependencies so restore
can't be run in locked mode.
```

### Audit: vulnerabilidades na hora do restore

O `NuGetAudit` roda durante o restore e reporta advisories conhecidos como
warnings `NU1901` a `NU1904` (de severidade baixa a crítica). Restaurar o
`Newtonsoft.Json` 12.0.1 produz:

```text
warning NU1903: Package 'Newtonsoft.Json' 12.0.1 has a known high severity vulnerability,
https://github.com/advisories/GHSA-5crp-9r3c-p9vr
```

O `dotnet list package --vulnerable` mostra os mesmos achados como relatório.
Segundo a documentação de auditoria do NuGet, `NuGetAuditMode` assume `all`
(pacotes diretos e transitivos) em projetos que miram `net10.0` ou superior, e
`direct` nos demais. `NuGetAuditLevel` define a severidade mínima, e
`NuGetAuditSuppress` silencia um advisory pela URL. Tratar `NU1903;NU1904` como
erro em um pipeline dedicado é um meio-termo comum, porque um advisory novo não
deveria quebrar todos os builds numa sexta-feira.

### O que mudou no .NET 9 e no .NET 10

O NuGet 6.12, que veio no SDK do .NET 9.0.100, trocou o resolvedor de
dependências por um algoritmo novo, pensado para grafos grandes. O texto da
Microsoft relata ganhos grandes em repositórios enormes, e
`RestoreUseLegacyDependencyResolver` volta ao resolvedor antigo. A mesma versão
adicionou audit sources, então o restore pode ler dados de vulnerabilidade do
nuget.org sem que ele seja uma fonte de pacotes. O SDK do .NET 10 (NuGet 7.0)
muda o default de `NuGetAuditMode`, como descrito acima. Se algo regredir depois
de atualizar o SDK, compare com o resolvedor legado antes de culpar o seu grafo.

## Trade-offs

- **Versões flutuantes trocam repetibilidade por atualização.** Sem lock file,
  `9.0.*` pode gerar outro build amanhã.
  ```xml
  <PackageReference Include="A" Version="9.0.*" /> <!-- combine com RestorePackagesWithLockFile -->
  ```
- **Lock files trazem conflitos de merge e uma etapa de revisão.** Cada
  atualização de dependência agora toca dois arquivos, e o `--locked-mode`
  quebra o build até alguém regenerar o lock.
- **A regra "dependência direta vence" pode esconder uma incompatibilidade.**
  Forçar um transitivo para cima costuma ser seguro; forçar para baixo é o que o
  `NU1605` avisa.
- **Fixar um transitivo no seu projeto é uma dívida.** Adicionar uma referência
  direta para corrigir uma vulnerabilidade funciona hoje, e fica para trás sem
  ninguém notar quando o pacote pai lançar uma versão mais nova.
- **Audit como erro bloqueia releases por advisories que você ainda não consegue
  corrigir.** Mantenha os warnings visíveis localmente e falhe só em um job de
  audit dedicado, com `NuGetAuditSuppress` como último recurso e uma nota dizendo
  o porquê.

## Lab

Neste lab você constrói um resolvedor de dependências minúsculo sobre um feed de pacotes em memória, para ver as regras do restore do NuGet virarem código. Você recebe `Feed` e `Dep` prontos, mais `Pick` e `Run` já escritos que chamam as suas funções. O seu trabalho é implementar `VersionRules` e `Resolver`. A ideia central é sentir que `Version="1.2"` não significa "exatamente 1.2" nem "o mais novo", e sim "a menor versão disponível que satisfaz", e que a requisição mais próxima da raiz decide cada pacote. Sem rede, sem restore de verdade.

**O cenário**

O problema é decidir qual versão de cada pacote entra no grafo e explicar os avisos que você conhece como `NU1605` e `NU1107`.

- `Feed.cs`: `Feed` guarda id, versão e dependências em memória, e `Dep` é uma aresta com a faixa escrita como num projeto (`"1.0"`, `"[1.0]"`, `"1.*"`). Já está completo.
- `VersionRules.cs`: `Compare` e `Satisfies`, as regras de ordem e de notação de faixas.
- `Resolver.cs`: `PickLowest`, `PickFloating`, `PickForGroup`, `Resolve` e `Diagnose`. `Pick` e `Run` já chamam essas funções.

O lab usa o pacote `NuGet.Versioning` 6.12.1 (`NuGetVersion`, `VersionRange`, `VersionComparer`). Os testes montam feeds pequenos em código e conferem versões resolvidas e as mensagens exatas dos diagnósticos. Nada depende de tempo, rede ou disco.

**O que você vai fazer, passo a passo**

1. **Ordem e faixas (TODO-00).** Em `Compare`, compare com `VersionComparer.Default` e devolva só o sinal (`1.0.0-beta.2 < 1.0.0`, `1.0 == 1.0.0`, metadados de build ignorados). Em `Satisfies`, use `VersionRange.Parse(...).Satisfies(...)` e perceba que `1.0` significa `>= 1.0`.
2. **Menor versão aplicável (TODO-01).** Em `PickLowest`, filtre os candidatos que satisfazem a faixa e devolva o menor, ou nulo.
3. **Faixas flutuantes (TODO-02).** Em `PickFloating`, `1.*` pega a maior versão compatível e ignora pré-lançamentos. `VersionRange.FindBestMatch` já faz isso.
4. **Primos (TODO-03).** Em `PickForGroup`, vários ramos pedem o mesmo pacote na mesma profundidade: ganha a menor versão que satisfaz todas as faixas, ou nulo.
5. **O mais próximo vence (TODO-04).** Em `Resolve`, ande no grafo em largura a partir das raízes. O primeiro nível que pede um id decide, pedidos mais fundos são ignorados, e uma referência direta vence uma transitiva. Se o grupo for insatisfazível, caia para `Pick` com a primeira faixa.
6. **Diagnósticos (TODO-05).** Em `Diagnose`, confira cada aresta contra o resolvido e produza `NU1101`, `NU1102`, `NU1605` (a referência direta ganhou com versão menor) e `NU1107` (conflito), na ordem por id e com versões em `ToNormalizedString()`.

**Como saber que terminou**

`dotnet test` fica verde. Você deve conseguir explicar por que o `NU1605` some quando você sobe a referência direta, e por que um pedido mais fundo no grafo não muda a escolha.

**Desafios opcionais**

- **TODO-06:** `Why` devolve o caminho mais curto de uma raiz até um pacote transitivo, como o `dotnet nuget why`.
- **TODO-07:** `CheckLocked` compara um lock file com uma resolução nova e devolve `NU1004` se divergirem, a ideia do `--locked-mode`.

**Pré-requisitos:** C# básico e LINQ, a ideia de `PackageReference`, dependências transitivas e `obj/project.assets.json`, e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Os métodos começam lançando `NotImplementedException` e cada TODO está descrito em comentário dentro deles, então os testes vermelhos mostram o que falta.

## Documentation Links

- [NuGet package dependency resolution, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/concepts/dependency-resolution) (doc)
- [NuGet package version reference, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/concepts/package-versioning) (doc)
- [Auditing package dependencies for security vulnerabilities, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/concepts/auditing-packages) (doc)
- [Package references in project files, locking dependencies, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/consume-packages/package-references-in-project-files) (doc)
- [Rewriting NuGet Restore in .NET 9, .NET Blog](https://devblogs.microsoft.com/dotnet/rewriting-nuget-restore-in-dotnet-9/) (doc)
