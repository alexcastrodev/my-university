---
version: 1.0
updatedAt: 2026-08-24
---
## Objective

The OpenAPI Generator Gradle plugin generates JAX-RS resource stubs for a Quarkus server from an OpenAPI spec — using the `jaxrs-spec` generator with `library=quarkus` — so the REST layer's shape (paths, DTOs, parameter binding) comes from the contract instead of being written by hand and drifting from the published spec.

## Use Cases

- Bootstrapping a new Quarkus service from an OpenAPI spec that was designed first (API-first), generating the JAX-RS resource interfaces and MicroProfile OpenAPI-annotated DTOs up front.
- Keeping a Quarkus service's request/response shapes provably in sync with a spec shared with API consumers, regenerating on every spec change instead of manually updating DTOs.
- Generating reactive-friendly signatures (SmallRye Mutiny `Uni`/`Multi`) directly from the spec for a Quarkus service already built on Mutiny elsewhere.
- Running the same OpenAPI spec through both this Gradle target (a Quarkus server) and a separate Maven target (a Spring client or server) so two services built on different stacks stay contractually identical — the exact pairing this concept and [[openapi-generator-contract-first-code-generation-with-maven]] cover.

## Deep Dive

### Wiring the plugin into the Gradle build

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

`openApiGenerate` is one of four tasks the plugin registers — `openApiGenerators` lists every generator available, `openApiValidate` checks a spec document without generating anything, and `openApiMeta` scaffolds a brand-new custom generator.

### Selecting Quarkus: `generatorName` + `library`

Quarkus isn't its own top-level generator — it's a `library` option on the general-purpose `jaxrs-spec` generator, alongside `thorntail`, `openliberty`, `helidon`, and `kumuluzee`. Setting `library=quarkus` changes the generated `pom.xml`/build metadata and resource annotations to target Quarkus specifically, while the JAX-RS resource shape stays the same across all `jaxrs-spec` targets.

### `interfaceOnly` and Jakarta EE

Just like the Spring generator, `interfaceOnly=true` produces resource interfaces only — you implement them yourself in a `@Path`-annotated class, so regenerating the spec never overwrites hand-written logic:

```java
// generated: PetApi.java interface (JAX-RS annotations, no implementation)
public interface PetApi {
    @GET
    @Path("/pet/{petId}")
    Response getPetById(@PathParam("petId") Long petId);
}
```

`useJakartaEe=true` generates `jakarta.ws.rs.*` imports instead of `javax.ws.rs.*` — required for any current Quarkus version, which has been on the Jakarta EE namespace since Quarkus 3.

### Quarkus-specific generation knobs

Two `configOptions` only apply when `library=quarkus`:

- `useMicroProfileOpenAPIAnnotations` — annotates generated resources with MicroProfile OpenAPI (`@Operation`, `@APIResponse`) instead of Swagger's own annotation set, matching what Quarkus's built-in OpenAPI support (SmallRye OpenAPI) already expects.
- `useMutiny` — generates method return types as SmallRye Mutiny's `Uni<T>`/`Multi<T>` instead of `CompletionStage<T>`, so generated signatures match a reactive Quarkus codebase without a manual wrapping layer.
- `useJakartaSecurityAnnotations` — generates Jakarta security annotations on resource methods; only available when `useJakartaEe=true` and `library=quarkus`.

## Trade-offs

- **`jaxrs-spec` targets a *family* of servers, not Quarkus specifically** — most of the generated shape (JAX-RS annotations, method signatures) is identical whether `library` is `quarkus`, `helidon`, or `thorntail`; only a handful of options (`useMicroProfileOpenAPIAnnotations`, `useMutiny`, the generated build files) are Quarkus-aware. Don't expect Quarkus-idiomatic extras like Panache entities or REST Client interfaces to come out of this generator — it stops at the JAX-RS resource layer.
- **`useMutiny` commits generated signatures to a reactive style project-wide** — flipping it on changes every generated method's return type from `CompletionStage` to `Uni`/`Multi`; mixing that with a blocking implementation defeats the purpose and reintroduces the exact blocking-on-the-event-loop problem reactive Quarkus is designed to avoid.
- **`interfaceOnly=true` is the only safe default for a service you'll actually maintain** — without it, regenerating after a spec change can silently discard hand-written resource logic; the discipline is identical to the Spring generator's delegate pattern, just enforced through JAX-RS interfaces instead of Spring MVC ones.
- **Gradle's task-based model is more explicit but more manual than Maven's phase binding** — `openApiGenerate` doesn't run automatically; wiring `compileJava.dependsOn` (or an equivalent for each source set) is a step Maven's `generate-sources` binding does for free, and forgetting it means compiling against stale generated sources.

## Documentation Links

- [OpenAPI Generator — Plugins (Maven, Gradle, Mill)](https://openapi-generator.tech/docs/plugins/) — doc
- [OpenAPI Generator — jaxrs-spec generator reference](https://github.com/OpenAPITools/openapi-generator/blob/master/docs/generators/jaxrs-spec.md) — doc
