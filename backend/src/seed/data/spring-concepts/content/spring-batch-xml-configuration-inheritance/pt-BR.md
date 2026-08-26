---
version: 1.0
updatedAt: 2026-08-04
title: Herança de Configuração XML no Spring Batch: abstract e parent
summary: Como o vocabulário XML do Spring Batch reaproveita o mecanismo de herança de beans abstract/parent do Spring puro para permitir que a definição de um job ou step herde e sobrescreva os atributos de outra, como a flag merge="true" combina em vez de substituir a lista de listeners de um parent, e por que a configuração Java não tem um equivalente direto — a reutilização ali é conseguida extraindo configuração compartilhada em métodos Java comuns em vez de uma palavra-chave dedicada de herança.
---
## Objective

Uma aplicação batch com vários jobs ou steps parecidos — um step "importar
produtos" e um step "importar clientes" que compartilham o mesmo intervalo de
commit, política de skip e listeners, digamos — acaba duplicando o mesmo
fragmento XML em cada um deles. O vocabulário XML do Spring Batch reaproveita
um mecanismo que o XML puro do Spring oferece desde a versão 2.0 — herança de
bean via `abstract`/`parent` — de forma que uma definição de job ou step
"parent" pode conter os defaults compartilhados uma única vez, com cada
definição "child" herdando e sobrescrevendo seletivamente esses valores.

## Use Cases

- Definir parâmetros de step padrão (intervalo de commit, comportamento de
  restart, política de skip) uma única vez para uma família de steps batch
  parecidos, em vez de repetir os mesmos atributos de `<tasklet>`/`<chunk>` em
  todo step.
- Alterar um default compartilhado (um intervalo de commit, um limite de skip)
  em exatamente um lugar e fazer com que todo step que o herda pegue a mudança
  automaticamente.
- Combinar um listener válido para todo job com um listener específico de um
  job, sem que uma lista substitua silenciosamente a outra.

## Deep Dive

### De onde isso vem: herança de bean pura do Spring

O Spring Batch não inventa seu próprio mecanismo de herança — ele reaproveita
os atributos `abstract`/`parent` que o XML puro do Spring suporta no elemento
`<bean>` desde o Spring 2.0, construídos especificamente para modularizar
configuração e evitar duplicação:

```xml
<bean id="parentBean" abstract="true">
  <property name="propertyOne" value="(...)"/>
</bean>
<bean id="childBean" parent="parentBean">
  <property name="propertyOne" value="(...)"/>
  <property name="propertyTwo" value="(...)"/>
</bean>
```

Um bean marcado com `abstract="true"` é apenas um template — o Spring nunca o
instancia diretamente. `parent="parentBean"` vincula um bean concreto a esse
template: o child herda toda propriedade que o parent define e pode
sobrescrever qualquer uma delas. Os elementos `job`/`step` do Spring Batch
aceitam os mesmos dois atributos, descritos na tabela 3.13 do livro:

| Atributo | Descrição |
|---|---|
| `abstract` | Quando `true`, o elemento job ou step é apenas um template — nunca instanciado, presente puramente para modularizar configuração para outros elementos. |
| `parent` | O elemento parent do qual um dado job ou step herda; o child tem todas as propriedades do parent e pode sobrescrevê-las. |

### Herança de step na prática

Um `parentStep` contém os defaults compartilhados de tasklet/chunk;
`productStep` os herda via `parent="parentStep"`, mantendo o que não
sobrescreve e fornecendo o reader/writer/processor e o intervalo de commit
que são específicos dele:

```xml
<step id="parentStep">
  <tasklet allow-start-if-complete="true">
    <chunk commit-interval="100"/>
  </tasklet>
</step>

<step id="productStep" parent="parentStep">
  <tasklet start-limit="5">
    <chunk reader="productItemReader"
           writer="productItemWriter"
           processor="productItemProcessor"
           commit-interval="15"/>
  </tasklet>
</step>
```

`productStep` acaba com a mesma hierarquia de elementos de `parentStep` (um
`tasklet` envolvendo um `chunk`), mais seu próprio reader/writer/processor e
um `commit-interval` de `15` sobrescrevendo o `100` do parent. Onde o parent
define um atributo que o child não repete, o child simplesmente o herda
inalterado; onde ambos definem o mesmo atributo, o valor do child vence.

### Combinando listas em vez de substituí-las: o atributo `merge`

Por padrão, um elemento de valor-lista do child (como o `<listeners>` de um
job) *substitui* a lista do parent em vez de se combinar com ela. Definir
`merge="true"` no elemento de lista do child muda para comportamento aditivo:

```xml
<job id="parentJob" abstract="true">
  <listeners>
    <listener ref="globalListener"/>
  <listeners>
</job>

<job id="importProductsJob" parent="parentJob">
  (...)
  <listeners merge="true">
    <listener ref="specificListener"/>
  <listeners>
</job>
```

Com `merge="true"`, `importProductsJob` acaba com *ambos* os listeners
registrados — `globalListener` do parent e `specificListener` próprio — em
vez de `specificListener` substituir `globalListener` silenciosamente. Sem a
flag `merge`, a lista do child sobrescreveria completamente a do parent.

## Trade-offs

- **Herança economiza duplicação, mas dificulta enxergar a configuração
  efetiva de um step num só lugar.** Ler `productStep` isoladamente não mostra
  `allow-start-if-complete="true"` — isso só é visível lendo também
  `parentStep`. Essa é a mesma troca de legibilidade que todo mecanismo de
  herança faz: menos repetição, mais indireção para rastrear ao debugar.
- **Elementos de valor-lista assumem substituição por padrão, não merge —
  `merge="true"` é opt-in, não o padrão, e fácil de esquecer.** Um bloco
  `<listeners>` de um job child substituindo em silêncio em vez de estender o
  do parent é uma surpresa comum na primeira vez que alguém depende de herança
  especificamente para listeners, já que a maioria dos outros atributos se
  comporta como esperado (o child sobrescreve só o que define
  explicitamente).
- **Templates `abstract="true"` não são instanciados, então um typo ou um
  atributo obrigatório faltando num job/step abstrato não aparece até que um
  child concreto realmente tente usá-lo** — a definição abstrata em si nunca é
  validada como um job ou step executável por conta própria.
- **Livro vs. hoje: esse mecanismo inteiro é específico do namespace XML de
  batch, que não tem um equivalente direto em configuração Java — não porque
  foi substituído por outra coisa, mas porque a configuração Java resolve o
  mesmo problema de "evitar duplicar configurações de step/job compartilhadas"
  com recursos comuns da linguagem em vez de uma palavra-chave dedicada de
  herança.** Confirmado pela referência atual do Spring Batch: os atributos
  `abstract`/`parent` e a página de documentação `Inheriting from a Parent
  Step` descrevem apenas configuração XML, sem contraparte documentada em
  Java-config. Em configuração Java, a mesma reutilização é tipicamente
  conseguida extraindo as configurações compartilhadas de step/job para um
  método comum ou constante que várias cadeias `StepBuilder`/`JobBuilder`
  chamam:
  ```java
  private StepBuilder commonStep(String name, JobRepository jobRepository,
          PlatformTransactionManager tx) {
      return new StepBuilder(name, jobRepository)
          .allowStartIfComplete(true);
      // shared defaults set here; each call site adds its own
      // reader/writer/processor/chunk size on top
  }

  @Bean
  public Step productStep(JobRepository jobRepository,
          PlatformTransactionManager tx) {
      return commonStep("productStep", jobRepository, tx)
          .<Product, Product>chunk(15, tx)
          .reader(productItemReader())
          .writer(productItemWriter())
          .processor(productItemProcessor())
          .build();
  }
  ```
  Isso é composição via Java puro, não um recurso de herança em nível de
  framework — não existe um equivalente a `merge="true"` para combinar duas
  listas de listeners; esse comportamento precisaria ser escrito
  explicitamente (por exemplo, concatenando duas listas antes de passá-las
  para chamadas `.listener(...)`) em vez de declarado. O namespace XML de
  batch em si — e esse mecanismo de herança junto com ele — está deprecado
  desde o Spring Batch 6.0, com remoção planejada para a 7.0, a mesma
  migração já observada para o vocabulário de job/step/chunk em outra parte
  deste workflow.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 3, "Batch configuration", section 3.4.4, "Configuration inheritance", p. 83-86 — doc
- [Spring Batch Reference — Inheriting from a Parent Step](https://docs.spring.io/spring-batch/reference/step/chunk-oriented-processing/inheriting-from-parent.html) — doc
- [Spring Batch Reference — Configuring a Step (StepBuilder)](https://docs.spring.io/spring-batch/reference/step/chunk-oriented-processing/configuring.html) — doc
- [Spring Batch 6.0 Migration Guide — XML namespace deprecation](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
