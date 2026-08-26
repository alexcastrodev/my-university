---
version: 1.0
updatedAt: 2026-08-24
title: "OpenAPI Generator: Geração de Código Contract-First com o Plugin Maven"
---
## Objective

O plugin Maven do OpenAPI Generator transforma uma especificação OpenAPI (YAML/JSON) em código-fonte Java — interfaces de controller, DTOs e stubs de client — durante o build do Maven, para que o contrato seja a única fonte de verdade em vez de DTOs escritos à mão que vão se desalinhando da API documentada.

## Use Cases

- Desenvolvimento API-first: a especificação OpenAPI é escrita (ou desenhada colaborativamente) antes de qualquer código Java, e tanto o formato do controller quanto os modelos de request/response são gerados a partir dela.
- Manter as classes de request/response de uma API pública perfeitamente sincronizadas com sua documentação publicada — os DTOs *são* a especificação, não um espelho manual dela.
- Gerar um client Java tipado para uma API de terceiros ou interna a partir do seu documento OpenAPI publicado, em vez de escrever chamadas `RestTemplate`/`WebClient` e DTOs na mão.
- Times grandes onde backend e frontend/consumidores concordam num contrato primeiro, e depois geram seus respectivos códigos de client/server independentemente a partir do mesmo arquivo.

## Deep Dive

### Ligando o plugin ao build

O plugin se liga por padrão à fase `generate-sources` do Maven, para que o código-fonte gerado exista antes de o `compile` rodar:

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

### Escolhendo o sabor Spring: `library`

`generatorName=spring` gera "uma aplicação server Spring Boot em Java usando a integração com SpringDoc", mas três valores de `library` mudam a cara desse código de servidor:

- `spring-boot` (default) — um servidor Spring Boot padrão: classes anotadas com `@RestController` geradas (ou interfaces, veja abaixo).
- `spring-cloud` — um client Feign com auto-configuração do Spring Cloud, para chamar a API documentada de outro serviço.
- `spring-http-interface` — as interfaces HTTP declarativas do Spring 6 (requer Spring Boot 3+), uma alternativa mais leve a um client Feign completo.

### `interfaceOnly` e o padrão delegate

Por padrão o gerador produz uma implementação completa de controller. Definir `interfaceOnly=true` gera só a interface da API (por exemplo `PetApi`, com métodos abstratos correspondendo a cada operação) e deixa a implementação por sua conta:

```java
// gerado: PetApi.java (interface, apenas assinaturas de método)
public interface PetApi {
    @Operation(summary = "Find pet by ID")
    @GetMapping("/pet/{petId}")
    ResponseEntity<Pet> getPetById(@PathVariable Long petId);
}
```

```java
// escrito à mão: implementa o contrato gerado no seu próprio bean
@RestController
public class PetController implements PetApi {
    @Override
    public ResponseEntity<Pet> getPetById(Long petId) {
        return ResponseEntity.ok(petService.find(petId));
    }
}
```

Esse é o padrão que mantém a lógica de negócio escrita à mão totalmente fora do código gerado — regenerar a partir da especificação nunca corre o risco de sobrescrever um método de controller que você editou manualmente. `delegatePattern=true` vai um passo além, gerando uma interface delegate intermediária entre o controller e seu service, útil quando várias implementações da mesma API precisam ser trocadas entre si.

### Ajustes de naming e versão

- `useTags=true` deriva os nomes de classe/método gerados a partir das tags do OpenAPI em vez do `operationId` — importa para como as interfaces geradas são organizadas quando uma especificação agrupa operações por tag.
- `useSpringBoot3=true` (o default atual) gera imports `jakarta.*` em vez de `javax.*`; `useSpringBoot4` existe para o Spring Boot 4.x.
- `dateLibrary=java8` (default) mapeia `date`/`date-time` do OpenAPI para `java.time.LocalDate`/`OffsetDateTime` (JSR-310) em vez de Joda-Time ou o antigo `java.util.Date`.

## Trade-offs

- **Código gerado é o contrato, não uma sugestão** — editar um `PetApi.java` gerado diretamente é uma armadilha: o próximo `mvn generate-sources` sobrescreve silenciosamente. `interfaceOnly=true` mais implementar a interface você mesmo é a única forma de adicionar lógica que sobrevive à regeneração.
- **Anotações Swagger v2 e v3 não são binariamente compatíveis** — misturar uma dependência `swagger-annotations` (v2) com código gerado esperando `swagger-core`/`swagger-parser` (v3) falha em runtime ou em tempo de compilação dependendo do descompasso; fixe uma versão major só, para o projeto inteiro.
- **Um client gerado acopla seu código à versão da especificação de outra pessoa** — regenerar contra um documento OpenAPI upstream mais novo pode mudar silenciosamente assinaturas de método (um campo vira obrigatório, um enum ganha um valor), o que é uma quebra de compilação, não uma surpresa em runtime — em tese esse é o ponto, mas significa que o CI precisa regenerar e rebuildar a cada mudança de especificação upstream para pegar isso cedo.
- **`library=spring-cloud` traz o Feign e todo o maquinário de auto-configuração dele** — conveniente se o projeto já usa Spring Cloud, mas exagero para uma única chamada de client num projeto que não tem mais nada a ver com Spring Cloud; `spring-http-interface` é a escolha mais leve no Spring Boot 3+.

## Documentation Links

- [OpenAPI Generator — Plugins (Maven, Gradle, Mill)](https://openapi-generator.tech/docs/plugins/) — doc
- [OpenAPI Generator — Spring generator reference](https://openapi-generator.tech/docs/generators/spring) — doc
