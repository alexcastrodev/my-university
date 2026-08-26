---
version: 1.0
updatedAt: 2026-08-06
title: "Spring Batch: Filtrando e Validando Itens"
---
## Objective

A fase de processamento de um step chunk-oriented não serve só para transformar itens lidos (veja `spring-batch-item-processing-and-transformation`) — um `ItemProcessor` também pode *remover* itens e *rejeitá-los*. Este concept cobre dois usos relacionados dessa fase: **filtering** (um `process()` que retorna `null` descarta o item, e o `ItemWriter` nunca o vê) e **validation** (aplicando regras de negócio, seja filtrando itens inválidos ou lançando exception para pulá-los), além de **encadear** vários processors com `CompositeItemProcessor`.

A ideia mais importante de todas é que *filtering não é skipping*. Retornar `null` é uma decisão deliberada de "não escrever este registro", contada como `filterCount`; lançar uma exception é um erro que a maquinaria de fault-tolerance transforma num *skip* (`skipCount`) — um mecanismo separado, detalhado em `spring-batch-skip-policy-and-listeners`. Os dois mantêm o item fora do writer, mas significam coisas diferentes e são registrados separadamente no job repository.

## Use Cases

- Descartar registros que já existem na tabela de destino, para que uma importação noturna insira apenas linhas novas e nunca trave/atualize linhas que a loja online está servindo.
- Rejeitar itens inválidos do ponto de vista de negócio (um preço de produto negativo, um campo malformado) antes que cheguem ao banco de dados.
- Reutilizar as mesmas constraints de Bean Validation (`@NotNull`, `@Min`) na camada web, na camada JPA e no job batch, em vez de recodificá-las três vezes.
- Aplicar várias regras de negócio independentes num único step, encadeando processors de propósito único com `CompositeItemProcessor`.
- Escolher, por regra, se uma falha é um *filter* (silenciosamente não escrito) ou um *skip* (um erro tolerado até um limite), já que as contagens no job repository são diferentes.

## Deep Dive

### Filtering: retornar `null` para descartar um item do chunk

O contrato de filtering é propositalmente minúsculo: **se `process()` retorna `null`, o item não vai para o `ItemWriter`.** Todo o resto no processor é normal. O exemplo do livro descarta produtos já presentes no banco, então a importação insere apenas registros novos:

```java
public class ExistingProductFilterItemProcessor
    implements ItemProcessor<Product, Product> {

  private static final String SQL_COUNT_PRODUCT =
      "select count(1) from product where id = ?";
  private JdbcTemplate jdbcTemplate;

  @Override
  public Product process(Product item) throws Exception {
    return needsToBeFiltered(item) ? null : item;   // null -> filtered out
  }

  private boolean needsToBeFiltered(Product item) {
    return jdbcTemplate.queryForInt(SQL_COUNT_PRODUCT, item.getId()) != 0;
  }
}
```

A ligação não tem nada de especial — o processor fica entre o reader e o writer de um step chunk-oriented (veja `spring-batch-chunk-processing`), e os `null`s retornados simplesmente nunca se acumulam no chunk entregue ao writer. A recomendação de melhor prática do livro é **não misturar filtering e transformação num único processor**: se você precisa dos dois, use dois processors e os encadeie (veja `CompositeItemProcessor` abaixo).

### Filter não é skip

Essa é a distinção que o livro martela, e ela continua inalterada hoje:

- **Filtering** significa "o Spring Batch não deve *escrever* este registro" — um resultado normal. Você sinaliza isso retornando `null`, o que incrementa o `filterCount` do step.
- **Skipping** significa "este registro é *inválido*" — um resultado de erro. Você sinaliza isso *lançando* uma exception, e só se uma skip policy estiver configurada a exception é tolerada (senão o step falha). Isso incrementa `skipCount`.

```java
@Override
public Product process(Product item) throws Exception {
  if (alreadyImported(item)) {
    return null;                                       // FILTER: filterCount++
  }
  if (item.getPrice().signum() < 0) {
    throw new ValidationException("negative price");   // SKIP (if skippable): skipCount++
  }
  return item;
}
```

Os dois mantêm o item fora do writer, mas o job repository os registra separadamente, e o skipping é conduzido pela configuração fault-tolerant do step e por seus listeners — veja `spring-batch-skip-policy-and-listeners`.

### Validação com `ValidatingItemProcessor` e o contrato `Validator`

Em vez de codificar manualmente a decisão de lançar-ou-retornar, o Spring Batch traz o `ValidatingItemProcessor`, que envolve um `Validator` e expõe uma flag `filter`:

- `filter = false` (default) → uma `ValidationException` do validator é **relançada** (skip).
- `filter = true` → o item é **filtrado** (retorna `null`) em vez disso.

O contrato `Validator` é um único método, e um validator customizado para a regra "sem preço negativo" fica assim:

```java
package org.springframework.batch.item.validator; // pre-6.0 package

public interface Validator<T> {
  void validate(T value) throws ValidationException;
}

public class ProductValidator implements Validator<Product> {
  @Override
  public void validate(Product product) throws ValidationException {
    if (BigDecimal.ZERO.compareTo(product.getPrice()) >= 0) {
      throw new ValidationException("Product price cannot be negative!");
    }
  }
}
```

Como o `filter` default é `false`, o processor *pula* (skip) em caso de falha, então você precisa tornar `ValidationException` skippable, senão o job inteiro falha:

```xml
<batch:chunk reader="reader" processor="processor" writer="writer"
             commit-interval="100" skip-limit="5">
  <batch:skippable-exception-classes>
    <batch:include class="org.springframework.batch.item.validator.ValidationException"/>
  </batch:skippable-exception-classes>
</batch:chunk>

<bean id="processor"
      class="org.springframework.batch.item.validator.ValidatingItemProcessor">
  <property name="filter" value="false"/>
  <property name="validator">
    <bean class="com.manning.sbia.ch07.validation.ProductValidator"/>
  </property>
</bean>
```

Vire `filter` para `true` e você não precisa mais de nenhuma configuração de skip — o item inválido é silenciosamente filtrado em vez de pulado.

### Bean Validation com annotations

A abordagem mais reutilizável do livro é a JSR-303 Bean Validation: colocar as constraints na própria classe e aplicá-las em qualquer lugar (web, JPA, batch):

```java
public class Product {
  private BigDecimal price;

  @NotNull
  @Min(0)                       // book import: javax.validation.constraints.*
  public BigDecimal getPrice() { return price; }
}
```

Em 2012 o livro então escrevia à mão um `BeanValidationValidator` que inicializava uma `ValidatorFactory` JSR-303, chamava `validator.validate(value)`, e traduzia qualquer `ConstraintViolation` numa `ValidationException` do Spring Batch antes de injetá-la num `ValidatingItemProcessor`. Hoje essa cola já vem pronta — veja "Livro vs. hoje" abaixo.

### Encadeando com `CompositeItemProcessor`

Um step permite apenas *um* processor entre reader e writer. Para rodar várias regras de negócio, aplique o padrão composite: `CompositeItemProcessor` guarda uma lista de delegates e os chama em ordem, com a saída de cada um alimentando o próximo.

```xml
<bean id="processor"
      class="org.springframework.batch.item.support.CompositeItemProcessor">
  <property name="delegates">
    <list>
      <ref bean="productMapperProcessor"/>   <!-- PartnerProduct -> Product -->
      <ref bean="productIdMapperProcessor"/> <!-- partner ID -> ACME ID     -->
    </list>
  </property>
</bean>
```

Duas regras importam. Primeiro, os delegates precisam formar uma **cadeia type-compatible**: o tipo de saída de um precisa bater com o tipo de entrada do próximo. Segundo, **`null` faz curto-circuito na cadeia inteira** — se qualquer delegate retornar `null`, o composite para e o item é filtrado, então um processor de filtering colocado em qualquer ponto da lista ainda remove o item para o step inteiro. O composite reutiliza os delegates como estão, e é exatamente por isso que o livro recomenda um processor por responsabilidade.

### Livro vs. hoje: Bean Validation vem pronto, e as classes mudaram de pacote

Três mudanças concretas desde 2012:

1. **Você não escreve mais à mão uma ponte de Bean Validation.** O Spring Batch traz o `BeanValidatingItemProcessor` (uma subclasse de `ValidatingItemProcessor`, desde a 4.1) que já aplica as annotations JSR-303 / Jakarta Bean Validation prontas para uso, então o `BeanValidationValidator` customizado do livro está obsoleto:

```java
@Bean
public BeanValidatingItemProcessor<Product> validatingProcessor() {
  BeanValidatingItemProcessor<Product> p = new BeanValidatingItemProcessor<>();
  p.setFilter(false); // false = skip on violation, true = filter — same flag as before
  return p;
}
```

2. **`javax.validation` → `jakarta.validation`.** A partir do Spring Batch 5.0 (Spring Framework 6 / Jakarta EE 9+), as annotations são `jakarta.validation.constraints.Min` / `.NotNull`; os imports `javax.validation.*` do livro não resolvem mais. (O validator declarativo Valang / Spring Modules do livro está defunto há muito tempo; Bean Validation é o caminho idiomático hoje.)

3. **As classes de item foram realocadas no Spring Batch 6.0** de `org.springframework.batch.item.*` para `org.springframework.batch.infrastructure.item.*`. Os nomes totalmente qualificados modernos são `org.springframework.batch.infrastructure.item.validator.ValidatingItemProcessor` / `BeanValidatingItemProcessor` / `.validator.Validator` / `ValidationException`, e `org.springframework.batch.infrastructure.item.support.CompositeItemProcessor`; os caminhos pre-6.0 agora dão 404. A semântica de `filter` e o contrato de "null retorna filter" permanecem inalterados, e o namespace XML `batch:` mostrado acima está deprecated desde a 6.0 (remoção planejada para a 7.0) em favor da configuração Java com `JobBuilder`/`StepBuilder`. Confirmado pelo Javadoc do Spring Batch 6.0.x para `ValidatingItemProcessor`, `BeanValidatingItemProcessor`, e `CompositeItemProcessor`, pelos guias de migração 5.0/6.0 do Spring Batch, e pelo capítulo "Item processing" da referência do Spring Batch.

## Trade-offs

- **Filter vs. skip é uma decisão de modelagem, não um detalhe técnico** — retornar `null` diz "corretamente não escrito", lançar diz "inválido". Eles divergem no job repository (`filterCount` vs `skipCount`) e no comportamento: um skip precisa de um skip limit configurado e pode falhar o job quando excedido, enquanto um filter é sempre silencioso. Escolha o que corresponde ao que o registro realmente significa.
- **Bean Validation declarativo vs. `Validator` programático** — annotations no item são reutilizáveis entre web/JPA/batch e mantêm as regras num só lugar, mas um `Validator` escrito à mão pode acessar colaboradores (por exemplo, um `JdbcTemplate`) para checagens de consistência entre registros que annotations não conseguem expressar. Use annotations para regras de estado, um validator customizado para regras contextuais.
- **Separe filtering de transformação** — a melhor prática do livro é um processor por responsabilidade, composto com `CompositeItemProcessor`, em vez de um único processor que muta e descarta itens ao mesmo tempo. Isso mantém cada regra reutilizável e testável, ao custo de um bean extra e de uma ordem que você precisa acertar (um `null` de um delegate anterior faz curto-circuito no resto).
- **`filter = true` esconde rejeições** — filtrar itens inválidos em vez de pulá-los evita configuração de skip e nunca falha o job, mas os dados ruins desaparecem sem nenhuma exception e só um `filterCount` para mostrar. Skipping (com um `SkipListener`) dá um gancho para logar ou desviar o registro problemático.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 7, "Processing data", sections 7.3-7.4, "Filtering and validating items" / "Chaining item processors", p. 208-221 — doc
- [Spring Batch Reference — Item processing (filtering & validating input)](https://docs.spring.io/spring-batch/reference/processor.html) — doc
- [ValidatingItemProcessor — Spring Batch 6.0.x Javadoc (filter flag, infrastructure package)](https://docs.spring.io/spring-batch/docs/6.0.x/api/org/springframework/batch/infrastructure/item/validator/ValidatingItemProcessor.html) — doc
- [BeanValidatingItemProcessor — Spring Batch 6.0.x Javadoc (JSR-303 / Jakarta Bean Validation)](https://docs.spring.io/spring-batch/docs/6.0.x/api/org/springframework/batch/infrastructure/item/validator/BeanValidatingItemProcessor.html) — doc
- [Spring Batch 6.0 Migration Guide — package relocation & XML namespace deprecation](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
