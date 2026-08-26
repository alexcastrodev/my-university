---
version: 1.0
updatedAt: 2026-08-24
---
## Objective

The OpenAPI Generator Maven plugin turns an OpenAPI spec (YAML/JSON) into Java source — controller interfaces, DTOs, and client stubs — during the Maven build, so the contract is the single source of truth instead of hand-written DTOs drifting away from the documented API.

## Use Cases

- API-first development: the OpenAPI spec is written (or designed collaboratively) before any Java code, and both the controller shape and the request/response models are generated from it.
- Keeping a public API's request/response classes perfectly in sync with its published documentation — the DTOs *are* the spec, not a manual mirror of it.
- Generating a typed Java client for a third-party or internal API from its published OpenAPI document, instead of hand-rolling `RestTemplate`/`WebClient` calls and DTOs.
- Large teams where the backend and frontend/consumer teams agree on a contract first, then generate their respective client/server code independently from the same file.

## Deep Dive

### Wiring the plugin into the build

The plugin binds to Maven's `generate-sources` phase by default, so generated sources exist before `compile` runs:

```xml
<plugin>
    <groupId>org.openapitools</groupId>
    <artifactId>openapi-generator-maven-plugin</artifactId>
    <version>7.24.0</version>
    <executions>
        <execution>
            <goals><goal>generate</goal></goals>
            <configuration>
                <inputSpec>${project.basedir}/src/main/resources/api.yaml</inputSpec>
                <generatorName>spring</generatorName>
                <configOptions>
                    <sourceFolder>src/gen/java/main</sourceFolder>
                    <interfaceOnly>true</interfaceOnly>
                </configOptions>
            </configuration>
        </execution>
    </executions>
</plugin>
```

### Choosing the Spring flavor: `library`

`generatorName=spring` targets "a Java SpringBoot server application using the SpringDoc integration," but three `library` values change what that server code looks like:

- `spring-boot` (default) — a standard Spring Boot server: generated `@RestController`-annotated classes (or interfaces, see below).
- `spring-cloud` — a Feign client with Spring Cloud auto-configuration, for calling another service's documented API.
- `spring-http-interface` — Spring 6's declarative HTTP interfaces (requires Spring Boot 3+), a lighter alternative to a full Feign client.

### `interfaceOnly` and the delegate pattern

By default the generator produces a full controller implementation. Setting `interfaceOnly=true` generates just the API interface (e.g. `PetApi`, with abstract methods matching each operation) and leaves the implementation to you:

```java
// generated: PetApi.java (interface, method signatures only)
public interface PetApi {
    @Operation(summary = "Find pet by ID")
    @GetMapping("/pet/{petId}")
    ResponseEntity<Pet> getPetById(@PathVariable Long petId);
}
```

```java
// hand-written: implement the generated contract in your own bean
@RestController
public class PetController implements PetApi {
    @Override
    public ResponseEntity<Pet> getPetById(Long petId) {
        return ResponseEntity.ok(petService.find(petId));
    }
}
```

This is the pattern that keeps hand-written business logic out of generated code entirely — regenerating the spec never risks overwriting a controller method you edited by hand. `delegatePattern=true` goes a step further, generating an intermediate delegate interface between the controller and your service, useful when several implementations of the same API need to be swapped.

### Naming and version knobs

- `useTags=true` derives generated class/method names from OpenAPI tags instead of `operationId` — matters for how the generated interfaces are organized when a spec groups operations by tag.
- `useSpringBoot3=true` (the current default) generates `jakarta.*` imports instead of `javax.*`; `useSpringBoot4` exists for Spring Boot 4.x.
- `dateLibrary=java8` (default) maps OpenAPI `date`/`date-time` to `java.time.LocalDate`/`OffsetDateTime` (JSR-310) rather than Joda-Time or legacy `java.util.Date`.

## Trade-offs

- **Generated code is the contract, not a suggestion** — editing a generated `PetApi.java` directly is a trap: the next `mvn generate-sources` overwrites it silently. `interfaceOnly=true` plus implementing the interface yourself is the only way to add logic that survives regeneration.
- **Swagger v2 and v3 annotations are not binary compatible** — mixing a `swagger-annotations` (v2) dependency with generated code expecting `swagger-core`/`swagger-parser` (v3) fails at runtime or compile time depending on the mismatch; pin one major version project-wide.
- **A generated client couples your code to someone else's spec version** — regenerating against a newer upstream OpenAPI document can silently change method signatures (a field becomes required, an enum gains a value), which is a compile break, not a runtime surprise — arguably the point, but it means CI needs to regenerate and rebuild on every upstream spec change to catch it early.
- **`library=spring-cloud` pulls in Feign and its auto-configuration machinery** — convenient if the project already uses Spring Cloud, but overkill for a single client call in a project that otherwise has nothing to do with Spring Cloud; `spring-http-interface` is the lighter-weight choice on Spring Boot 3+.

## Documentation Links

- [OpenAPI Generator — Plugins (Maven, Gradle, Mill)](https://openapi-generator.tech/docs/plugins/) — doc
- [OpenAPI Generator — Spring generator reference](https://openapi-generator.tech/docs/generators/spring) — doc
