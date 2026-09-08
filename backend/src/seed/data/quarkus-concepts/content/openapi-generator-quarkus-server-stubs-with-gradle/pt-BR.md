---
version: 1.0
updatedAt: 2026-08-24
title: "OpenAPI Generator: Stubs de Servidor Quarkus com o Plugin Gradle"
summary: "Como o openapi-generator-gradle-plugin gera stubs de recurso JAX-RS para um servidor Quarkus usando generatorName=jaxrs-spec e library=quarkus, incluindo namespacing Jakarta EE, anotações MicroProfile OpenAPI, e assinaturas reativas tipadas com Mutiny."
---
## Objective

O plugin Gradle do OpenAPI Generator gera stubs de recurso JAX-RS para um servidor Quarkus a partir de uma spec OpenAPI, usando o gerador `jaxrs-spec` com `library=quarkus`, de modo que a forma da camada REST (caminhos, DTOs, ligação de parâmetros) venha do contrato, em vez de ser escrita à mão e ir se distanciando da spec publicada.

## Use Cases

- Inicializar um serviço Quarkus novo a partir de uma spec OpenAPI que foi projetada primeiro (API-first), gerando as interfaces de recurso JAX-RS e os DTOs anotados com MicroProfile OpenAPI de antemão.
- Manter as formas de requisição/resposta de um serviço Quarkus provadamente sincronizadas com uma spec compartilhada com consumidores da API, regenerando a cada mudança na spec, em vez de atualizar DTOs manualmente.
- Gerar assinaturas amigáveis a reativo (SmallRye Mutiny `Uni`/`Multi`) diretamente a partir da spec, para um serviço Quarkus já construído sobre Mutiny em outras partes.
- Rodar a mesma spec OpenAPI tanto por este alvo Gradle (um servidor Quarkus) quanto por um alvo Maven separado (um cliente ou servidor Spring), para que dois serviços construídos sobre stacks diferentes permaneçam contratualmente idênticos, exatamente o pareamento que este conceito e [[openapi-generator-contract-first-code-generation-with-maven]] cobrem.

## Deep Dive

### Conectando o plugin ao build Gradle

```gradle
buildscript {
  repositories {
    mavenCentral()
  }
  dependencies {
    classpath "org.openapitools:openapi-generator-gradle-plugin:7.24.0"
  }
}
apply plugin: 'org.openapi.generator'

openApiGenerate {
  generatorName.set("jaxrs-spec")
  library.set("quarkus")
  inputSpec.set("$rootDir/specs/api.yaml")
  outputDir.set("$buildDir/generated")
  apiPackage.set("com.example.api")
  modelPackage.set("com.example.model")
  configOptions.set([
    interfaceOnly: "true",
    useJakartaEe: "true"
  ])
}

compileJava.dependsOn tasks.named("openApiGenerate")
```

`openApiGenerate` é uma das quatro tasks que o plugin registra: `openApiGenerators` lista todo gerador disponível, `openApiValidate` checa um documento de spec sem gerar nada, e `openApiMeta` monta o esqueleto de um gerador customizado totalmente novo.

### Selecionando Quarkus: `generatorName` + `library`

Quarkus não é um gerador de nível superior próprio; é uma opção `library` no gerador de propósito geral `jaxrs-spec`, ao lado de `thorntail`, `openliberty`, `helidon` e `kumuluzee`. Definir `library=quarkus` muda o `pom.xml`/metadados de build gerados e as anotações de recurso para direcionar especificamente o Quarkus, enquanto a forma do recurso JAX-RS permanece a mesma entre todos os alvos `jaxrs-spec`.

### `interfaceOnly` e Jakarta EE

Assim como no gerador Spring, `interfaceOnly=true` produz só interfaces de recurso; você as implementa em uma classe anotada com `@Path`, então regenerar a partir da spec nunca sobrescreve lógica escrita à mão:

```java
// generated: PetApi.java interface (JAX-RS annotations, no implementation)
public interface PetApi {
    @GET
    @Path("/pet/{petId}")
    Response getPetById(@PathParam("petId") Long petId);
}
```

`useJakartaEe=true` gera imports `jakarta.ws.rs.*` em vez de `javax.ws.rs.*`, obrigatório para qualquer versão atual do Quarkus, que está no namespace Jakarta EE desde o Quarkus 3.

### Ajustes de geração específicos do Quarkus

Duas `configOptions` só se aplicam quando `library=quarkus`:

- `useMicroProfileOpenAPIAnnotations`: anota os recursos gerados com MicroProfile OpenAPI (`@Operation`, `@APIResponse`), em vez do próprio conjunto de anotações do Swagger, casando com o que o suporte embutido a OpenAPI do Quarkus (SmallRye OpenAPI) já espera.
- `useMutiny`: gera os tipos de retorno de método como `Uni<T>`/`Multi<T>` do SmallRye Mutiny, em vez de `CompletionStage<T>`, de modo que as assinaturas geradas casem com uma base de código Quarkus reativa sem uma camada manual de wrapping.
- `useJakartaSecurityAnnotations`: gera anotações de segurança Jakarta nos métodos de recurso; disponível só quando `useJakartaEe=true` e `library=quarkus`.

## Trade-offs

- **`jaxrs-spec` direciona uma *família* de servidores, não o Quarkus especificamente**: a maior parte da forma gerada (anotações JAX-RS, assinaturas de método) é idêntica quer `library` seja `quarkus`, `helidon`, ou `thorntail`; só um punhado de opções (`useMicroProfileOpenAPIAnnotations`, `useMutiny`, os arquivos de build gerados) é ciente do Quarkus. Não espere que extras idiomáticos do Quarkus, como entidades Panache ou interfaces de REST Client, saiam deste gerador; ele para na camada de recurso JAX-RS.
- **`useMutiny` compromete as assinaturas geradas a um estilo reativo em todo o projeto**: ativá-lo muda o tipo de retorno de todo método gerado de `CompletionStage` para `Uni`/`Multi`; misturar isso com uma implementação bloqueante derrota o propósito e reintroduz exatamente o problema de bloquear o event loop que o Quarkus reativo foi projetado para evitar.
- **`interfaceOnly=true` é o único padrão seguro para um serviço que você de fato vai manter**: sem ele, regenerar depois de uma mudança na spec pode descartar silenciosamente lógica de recurso escrita à mão; a disciplina é idêntica à do padrão delegate do gerador Spring, só que aplicada através de interfaces JAX-RS em vez de interfaces Spring MVC.
- **O modelo baseado em tasks do Gradle é mais explícito, mas mais manual do que a ligação por fase do Maven**: `openApiGenerate` não roda automaticamente; conectar `compileJava.dependsOn` (ou um equivalente para cada source set) é um passo que a ligação `generate-sources` do Maven faz de graça, e esquecê-lo significa compilar contra fontes geradas desatualizadas.

## Documentation Links

- [OpenAPI Generator: Plugins (Maven, Gradle, Mill)](https://openapi-generator.tech/docs/plugins/) (doc)
- [OpenAPI Generator: referência do gerador jaxrs-spec](https://github.com/OpenAPITools/openapi-generator/blob/master/docs/generators/jaxrs-spec.md) (doc)
