---
version: 1.0
updatedAt: 2026-11-12
title: "Modelos compilados do EF Core e tempo de startup"
summary: dotnet ef dbcontext optimize, o que o modelo compilado gera e como o EF Core o encontra, o que muda no EF Core 11 (EFOptimizeContext removido), o tempo de startup medido com e sem modelo compilado em 60 e 300 entidades, o modelo defasado que ninguém percebe e as precompiled queries, ainda experimentais.
---
## Objective

Todo tipo de `DbContext` tem um modelo: as entidades, propriedades, chaves e relacionamentos que o
EF Core monta rodando `OnModelCreating`, as convenções e as data annotations. O EF Core monta esse
modelo uma vez por tipo de contexto e por processo, na primeira operação com o contexto, e guarda em
cache. Em um modelo com centenas de entidades essa primeira montagem aparece como tempo de startup.
Um modelo compilado move esse trabalho para o build: `dotnet ef dbcontext optimize` escreve código C#
que cria o modelo diretamente, e em runtime o EF Core carrega esse código em vez de montar o modelo.

Esta lição mostra o comando, o que ele gera e como o EF Core o encontra, o que mudou no EF Core 11 e
uma medição que fiz com e sem modelo compilado em modelos de 60 e de 300 entidades. A medição é o
ponto principal: o ganho é real, mas limitado a uma fase do startup, então meça a sua aplicação antes
de adotar. Tudo rodou no SDK 11.0.100 com `Microsoft.EntityFrameworkCore.Sqlite` 11.0.0 e a
ferramenta `dotnet-ef` 11.0.0. Precompiled queries são outro recurso, ainda experimental, e a lição
termina com o que vi ao tentá-las.

## Use Cases

- Reduzir o custo de primeiro uso de um modelo grande em um serviço que reinicia com frequência:
  funções serverless, containers que escalam a zero, ferramentas de linha de comando de vida curta.
- Verificar se um startup lento da aplicação é causado pela montagem do modelo, antes de mudar qualquer coisa.
- Manter o modelo gerado em sincronia com o código: um teste ou etapa de build que falha quando o
  modelo mudou e o código gerado não.
- Preparar um contexto para Native AOT, que não permite montar o modelo em runtime.

## Deep Dive

### Gerando o modelo

A ferramenta precisa criar o seu contexto em design time. Usei um `IDesignTimeDbContextFactory<T>`.
O comando exige o projeto restaurado, e a versão da ferramenta precisa ser a mesma do EF Core:

```bash
dotnet ef dbcontext optimize --output-dir CompiledModels --namespace CompiledModelLab.CompiledModels
```

Para um contexto com 60 entidades pequenas (cada uma com `Id`, três propriedades escalares e uma
referência opcional para a entidade anterior) ele escreveu 62 arquivos: um `...EntityType.cs` por
entidade, mais `LabContextModel.cs`, `LabContextModelBuilder.cs` e `LabContextAssemblyAttributes.cs`.
Com 300 entidades foram 302. O comando também aceita `--no-scaffold` (não gera o modelo),
`--precompile-queries` e `--nativeaot`, os dois últimos marcados como experimentais na saída da ferramenta.

O `LabContextModel` gerado é um `RuntimeModel` com uma propriedade estática `Instance`. Você pode
entregá-lo ao EF Core de forma explícita:

```csharp
var options = new DbContextOptionsBuilder<LabContext>()
    .UseSqlite("Data Source=app.db")
    .UseModel(LabContextModel.Instance)
    .Options;
```

Mas existe um segundo caminho que me surpreendeu. `LabContextAssemblyAttributes.cs` contém
`[assembly: DbContextModel(typeof(LabContext), typeof(LabContextModel), ProviderName = "Microsoft.EntityFrameworkCore.Sqlite")]`.
Com esse arquivo no projeto, o EF Core usou o modelo compilado mesmo sem eu chamar `UseModel`: no meu
teste o contexto "sem modelo compilado" carregou o modelo em cerca de 1 ms e o `OnModelCreating` nunca
rodou. A mensagem da ferramenta diz o mesmo: "it will be discovered automatically, but you can also
call `options.UseModel(...)`". Quando apaguei esse único arquivo, o `OnModelCreating` voltou a rodar.
Isso importa de duas formas. Se você gera um modelo e esquece, você o está usando. E se quer um caso
"sem modelo compilado" para comparar, precisa remover o arquivo do atributo ou medir um build sem ele.

### O que se mede: duas fases, não uma

A documentação define o startup aqui como o tempo da primeira operação com um tipo de `DbContext`,
porque criar a instância não monta o modelo. Dividi essa primeira operação em duas e cronometrei cada
fase com um `Stopwatch`: `db.Model` (monta ou carrega o modelo) e depois a primeira query
(`db.Set<Entity01>().Count()`). Cada execução foi um processo novo, build Release, SQLite em arquivo,
Apple M4 Max, sete execuções por modo, ordenadas. O primeiro número de cada par é o modelo normal, o
segundo o compilado (milissegundos):

```text
 60 entidades  modelo 192-204  vs  23-26      primeira query 104-115  vs 118-129   soma 299-312  vs 141-153
300 entidades  modelo 400-449  vs  25-38      primeira query 128-190  vs 149-169   soma 528-591  vs 175-200
```

Lendo:

- A fase do modelo encolhe muito e quase deixa de depender do tamanho: 23 a 26 ms para 60 entidades
  e 25 a 38 ms para 300, contra 192 a 204 ms e 400 a 449 ms montando em runtime. O custo de montar
  cresceu com o número de entidades, o de carregar quase não.
- A fase da primeira query não melhorou. Ficou igual ou um pouco pior com o modelo compilado
  (118 a 129 ms contra 104 a 115 ms com 60 entidades). Essa fase é compilação da query, abertura da
  conexão e JIT, e o modelo não remove nenhum deles.
- A soma ainda favorece o modelo compilado aqui: cerca de 150 ms contra cerca de 305 ms com 60
  entidades, e cerca de 190 ms contra cerca de 560 ms com 300.

Uma medição anterior, no release candidate, em build Debug com o modelo de 60 entidades, mostrou a
fase do modelo melhorando (107 a 123 ms contra 269 a 289 ms) mas o tempo até a primeira query não
melhorando (498 a 511 ms contra 446 a 461 ms; não repeti isso na versão final). Então o resultado
depende da configuração do build e do que você conta. É por isso que se mede aquilo que o usuário
espera, na configuração que você publica, em vez de confiar em um número de blog ou desta página. São
uma máquina e sete execuções, o bastante para mostrar a direção, não um benchmark.

### O que mudou no EF Core 11

O código gerado e os comandos são os mesmos do EF Core 10. A mudança visível está na integração com o
MSBuild e vem da página de breaking changes do EF Core 11: a propriedade `EFOptimizeContext`, que
ligava a geração de modelo compilado e de precompiled queries durante build ou publish, foi removida.
A geração agora é controlada por `EFScaffoldModelStage` e `EFPrecompileQueriesStage`, cada uma com
`build` ou `publish`, e com `PublishAot` igual a `true` a geração é ligada no publish sem nenhuma
propriedade extra. Não rodei um build integrado ao MSBuild, então essa parte vem da documentação.
Uma correção relacionada na mesma versão: o discriminador padrão do provider Cosmos voltou a se
chamar `Discriminator` no modelo (continua `$type` no documento JSON), porque `$type` não é um
identificador C# válido e gerava código que não compilava em modelos compilados.

### O modelo fica defasado em silêncio

Um modelo compilado não tem `OnModelCreating` para rodar, então nada percebe quando o código mudou.
Acrescentei uma propriedade `Notes` a uma entidade e rodei com o modelo gerado antigo. Nenhum erro de
build, nenhum erro de startup: o `db.Model` simplesmente não continha `Notes`, e a query
`Where(e => e.Notes == "x")` falhou só ao executar, com
`InvalidOperationException: The LINQ expression 'DbSet<Entity01>() ...` could not be translated.
Uma escrita que preenche `Notes` não a gravaria, porque a propriedade não está mapeada. A
documentação diz o mesmo: o modelo "must be manually synchronized by regenerating it any time the
model definition or configuration change".

A defesa prática é um teste que compara o modelo compilado com o modelo que o EF Core montaria agora.
No lab desta lição, `IsStale` monta uma lista ordenada de `NomeDoTipoClr(propriedade,...)` de cada
modelo e compara; um contexto que acrescenta mais uma entidade é apontado como defasado. Ele lê o
segundo modelo por `GetService<IDesignTimeModel>().Model`, então precisa de um contexto que não use o
modelo compilado. A outra defesa é gerar durante o build, com as etapas do MSBuild acima, para que o
arquivo não possa ser mais antigo que o código.

### Limitações segundo a documentação

A documentação lista o que um modelo compilado não suporta: global query filters, lazy loading e
proxies de change tracking, value converters que referenciam métodos privados, implementações
customizadas de `IModelCacheKeyFactory` e a sincronização manual acima. Por causa desses limites ela
recomenda modelos compilados só quando o startup está lento, e diz que compilar um modelo pequeno
normalmente não vale a pena. Se o seu modelo usa query filters (soft delete, multi-tenancy), confira
isso primeiro; não testei a limitação dos filtros.

### Precompiled queries são outro recurso, e ainda experimental

`--precompile-queries` (com `--nativeaot`) analisa as queries LINQ do seu código e gera interceptors
C# que as substituem por SQL e materializadores prontos. A ferramenta imprime "Query precompilation is
an experimental feature and should be used with caution", e a documentação de Native AOT ainda a
chama de experimental no EF Core 11. O que vi confirma o cuidado:

- Uma query `Where(e => e.Amount > 5)` sobre uma propriedade `decimal` fez a precompilação falhar com
  `ArgumentException: Argument types do not match`, porque o literal inteiro não combina com a
  propriedade decimal. Escrever `5m` resolveu.
- Com as classes de entidade declaradas `sealed`, o arquivo de interceptors gerado não compilou:
  `CS0030: Cannot convert type 'Entity01' to 'IInjectableService'`. Remover `sealed` fez compilar.
- O código gerado precisa de `<InterceptorsNamespaces>$(InterceptorsNamespaces);Microsoft.EntityFrameworkCore.GeneratedInterceptors</InterceptorsNamespaces>`
  no projeto, senão o compilador rejeita os interceptors com `CS9137`.

Compilei e rodei o projeto não AOT com isso configurado (devolveu `0` linhas de uma tabela vazia); não
rodei um publish Native AOT. Precompiled queries e modelos compilados juntos são o que o Native AOT
exige, assunto da lição de Native AOT; fora do AOT, não adote precompiled queries por ganho de startup
sem testá-las contra as suas próprias queries.

### Medindo no lab

O lab desta lição tem um contexto de 60 entidades com o modelo gerado já no projeto. Você escreve a
factory que abre o contexto com ou sem o modelo, a sonda de duas fases e a checagem de defasagem, e os
testes contam quantas vezes o `OnModelCreating` roda. Um detalhe que os testes exigiram: o EF Core
guarda o modelo montado no service provider interno, então um segundo contexto com as mesmas options
nunca o monta de novo. O lab desliga esse cache com `EnableServiceProviderCaching(false)` para que
cada contexto monte ou carregue o seu modelo. Não faça isso em produção, porque também reconstrói o
service provider inteiro a cada vez.

## Trade-offs

- **O ganho é uma fase, não o startup inteiro.** Remove a montagem do modelo, que cresce com o número
  de entidades. Não remove a compilação de queries, a abertura da conexão nem o JIT. Um modelo de
  algumas dezenas de entidades pode não justificar.
- **Defasagem silenciosa.** Esquecer de regenerar depois de mudar o modelo não dá erro até que uma
  query ou uma escrita toque a diferença. Acrescente um teste ou gere durante o build.
- **Descoberta automática.** O atributo de assembly `[DbContextModel]` faz o EF Core usar o modelo
  compilado sem `UseModel`. Um arquivo antigo de que ninguém lembra continua sendo usado.
- **Limites de recursos.** Global query filters, lazy loading e proxies, e chaves de cache de modelo
  customizadas não funcionam com ele, segundo a documentação.
- **Diff gerado grande.** Um arquivo por entidade. Faça commit e revise, ou gere no build e deixe fora
  do controle de versão, mas então o debug local e o build precisam os dois gerar.
- **Precompiled queries são experimentais.** Existem casos que falham ao gerar ou ao compilar no GA
  11.0.0, então trate como ferramenta de Native AOT, não como chave geral de performance.

## Documentation Links

- [Compiled models, advanced performance topics, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/advanced-performance-topics#compiled-models) (doc)
- [Breaking changes in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/breaking-changes) (doc)
- [NativeAOT support and precompiled queries (experimental), EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/nativeaot-and-precompiled-queries) (doc)
- [dotnet ef dbcontext optimize, EF Core tools reference, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/cli/dotnet#dotnet-ef-dbcontext-optimize) (doc)
- [What's new in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/whatsnew) (doc)
