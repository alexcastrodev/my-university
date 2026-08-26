---
version: 1.0
updatedAt: 2026-08-06
title: "Method Security Filtering: @PreFilter, @PostFilter e Spring Data"
---
## Objective

`@PreAuthorize` e `@PostAuthorize` respondem a uma pergunta sim/não sobre uma
chamada inteira: esse caller pode invocar este método, ou recebe uma
`AccessDeniedException`. Filtering responde a uma pergunta mais estreita
sobre os *dados* que fluem através da chamada: dos elementos nessa coleção,
quais o principal atual tem permissão de tocar? `@PreFilter` reduz a coleção
que um caller passa *para dentro* antes que o corpo do método a veja;
`@PostFilter` reduz a coleção que o método devolve *para fora* antes que o
caller a veja. Nenhum dos dois nega a chamada — o método ainda executa, só
que sobre (ou retornando) uma coleção menor. O resultado é que um método de
service carrega sua própria regra de scoping de dados como um aspecto, em vez
de cada caller precisar lembrar de aplicá-la.

## Use Cases

- Um método de service `sellProducts(List<Product>)` que só pode agir sobre
  produtos pertencentes ao usuário autenticado, não importa qual controller,
  scheduler ou outro service o chame — a regra de ownership vive no método,
  não em cada caller.
- Um método `findProducts()` cuja lista retornada precisa ser reduzida às
  próprias linhas do caller antes de chegar ao frontend, sem que o corpo do
  método saiba nada sobre quem está logado.
- Qualquer formato "multi-tenant por linha": a mesma query está correta para
  todo usuário, mas cada usuário tem direito a um subconjunto diferente do
  resultado.
- Empurrar esse mesmo predicado de ownership para dentro de um `@Query` do
  Spring Data, para que o banco de dados retorne só as linhas que o principal
  pode ver — a versão da regra que de fato sobrevive a tabelas grandes e
  paginação.

## Deep Dive

### `@PreFilter`: reduzindo um argumento de coleção

`@PreFilter` recebe uma expressão SpEL avaliada uma vez por elemento de um
parâmetro coleção. `filterObject` se refere ao elemento sob avaliação;
`authentication` se refere à `Authentication` no contexto de segurança.
Elementos para os quais a expressão é `false` são removidos antes que o
corpo do método execute.

```java
@Service
public class ProductService {

    @PreFilter("filterObject.owner == authentication.name")
    public List<Product> sellProducts(List<Product> products) {
        // `products` here contains only items owned by the caller
        return products;
    }
}
```

Com três produtos — `beer`/`nikolai`, `candy`/`nikolai`,
`chocolate`/`julien` — passados, `curl -u nikolai:12345 .../sell` retorna só
os dois itens do Nikolai, e `curl -u julien:12345 .../sell` retorna só
`chocolate`. O corpo do método não fez nada para isso acontecer.

`filterObject` é tipado como o tipo do elemento, não da coleção: com uma
`List<Product>`, `filterObject` *é* um `Product`, então `filterObject.owner`
resolve contra a entidade. Para um parâmetro `Map`, o elemento é uma entrada
do map, então a expressão alcança através de `value`:

```java
@PreFilter("filterObject.value.owner == authentication.name")
public Collection<Account> updateAccounts(Map<String, Account> accounts) { ... }
```

Se um método tem mais de um parâmetro coleção, SpEL não consegue adivinhar
qual filtrar; o atributo `filterTarget` o nomeia:

```java
@PreFilter(value = "filterObject.owner == authentication.name",
           filterTarget = "products")
public void reconcile(List<Product> products, List<Audit> auditTrail) { ... }
```

### A armadilha da coleção mutável

O aspecto de filtering não constrói uma nova coleção — ele *muta a que você
deu a ele*, removendo os elementos que falharam na expressão. A instância que
o corpo do método recebe é a mesma instância que o caller construiu. Isso
torna uma coleção imutável uma falha em runtime, não um no-op:

```java
@GetMapping("/sell")
public List<Product> sellProduct() {
    List<Product> products = List.of(          // immutable!
            new Product("beer", "nikolai"),
            new Product("candy", "nikolai"),
            new Product("chocolate", "julien"));

    return productService.sellProducts(products);
}
```

```
java.lang.UnsupportedOperationException: null
  at java.base/java.util.ImmutableCollections.uoe(ImmutableCollections.java:73)
```

O endpoint responde `500 Internal Server Error`. Trocar `List.of(...)` por
`new ArrayList<>(...)` resolve. Isso não é uma peculiaridade legada que já
foi suavizada: `DefaultMethodSecurityExpressionHandler.filter()` ainda muta a
coleção alvo nas versões atuais, e a mesma falha é uma reclamação recorrente
de usuários de Kotlin cujos tipos default `listOf`/`mapOf` são imutáveis.
Callers de um método anotado com `@PreFilter` precisam saber que devem
entregar a ele uma coleção mutável — um pequeno mas real vazamento do
aspecto para dentro do código chamador.

### `@PostFilter`: reduzindo o valor de retorno

`@PostFilter` é a imagem espelhada — o método executa sem impedimentos, e o
aspecto filtra a coleção que ele retornou:

```java
@Service
public class ProductService {

    @PostFilter("filterObject.owner == authentication.name")
    public List<Product> findProducts() {
        List<Product> products = new ArrayList<>();
        products.add(new Product("beer", "nikolai"));
        products.add(new Product("candy", "nikolai"));
        products.add(new Product("chocolate", "julien"));
        return products;
    }
}
```

A distinção em relação a `@PostAuthorize` importa e é fácil de confundir.
`@PostAuthorize` inspeciona `returnObject` e, se a regra falha, lança uma
exception — o caller não recebe nada. `@PostFilter` nunca lança em caso de
regra não batida; o caller sempre recebe uma coleção, possivelmente vazia,
com os elementos não permitidos silenciosamente removidos. "Negar a chamada"
versus "reduzir os dados" são ferramentas genuinamente diferentes, e escolher
a errada produz um `403` espúrio ou um resultado silenciosamente truncado.

Ambas as annotations só funcionam em coleções e arrays (mais `Map` e
`Stream` nas versões atuais). Colocar `@PostFilter` num método que retorna
um único `Product` é um erro de configuração, não um filter que por acaso
combina com tudo.

### Filtering num repository do Spring Data — e por que `@PostFilter` é a resposta errada ali

As annotations funcionam em métodos de interface repository exatamente como
funcionam em métodos de service:

```java
public interface ProductRepository extends JpaRepository<Product, Integer> {

    @PostFilter("filterObject.owner == authentication.name")
    List<Product> findProductByNameContains(String text);
}
```

Isso se comporta corretamente — buscar `c` como Nikolai retorna só `candy`,
mesmo que `chocolate` também combine com o texto — e ainda é um design
ruim. O banco de dados retorna *toda* linha que combina para *todo* owner, o
resultado inteiro é materializado no heap da JVM, e só então as linhas não
autorizadas são descartadas. Num `findAll()` sobre uma tabela grande isso é
uma rota direta para um `OutOfMemoryError`; fora esse caso, é simplesmente
mais lento do que buscar só o necessário. E quebra a paginação de vez: um
`Page` de 20 linhas filtrado para 3 não é uma página de 3 — os metadados da
página são uma mentira e a aritmética de paginação não funciona mais.

A correção é colocar o principal na query, para que o filtering aconteça no
banco de dados. Dois passos. Primeiro, expor um bean
`SecurityEvaluationContextExtension`, que torna as expressões do Spring
Security resolvíveis dentro do SpEL de query do Spring Data:

```java
@Configuration
@EnableMethodSecurity
public class ProjectConfig {

    @Bean
    public SecurityEvaluationContextExtension securityEvaluationContextExtension() {
        return new SecurityEvaluationContextExtension();
    }
}
```

Depois escrever a condição de ownership na cláusula `WHERE` usando a sintaxe
de parâmetro SpEL `?#{ ... }`:

```java
public interface ProductRepository extends JpaRepository<Product, Integer> {

    @Query("SELECT p FROM Product p " +
           "WHERE p.name LIKE %:text% AND p.owner = ?#{authentication.name}")
    List<Product> findProductByNameContains(String text);
}
```

O comportamento observável externamente é idêntico à versão com
`@PostFilter`; a diferença é que agora o banco de dados retorna três linhas
em vez de trezentas. `authentication` e `principal` estão ambos disponíveis
na expressão, então `?#{principal?.id}` (a forma que a documentação oficial
usa) funciona igualmente bem quando o principal é um `UserDetails` custom
carregando um id.

### Livro vs. hoje: as annotations não mudaram, só a annotation de habilitação se mudou

O livro habilita filtering com
`@EnableGlobalMethodSecurity(prePostEnabled = true)`. Essa annotation é
deprecated; a substituta atual é `@EnableMethodSecurity`, que habilita
`@PreAuthorize`, `@PostAuthorize`, `@PreFilter` e `@PostFilter` por default
(`prePostEnabled` tem default `true`, então não precisa ser explicitado). O
conceito irmão
`spring-security-method-security-preauthorization-and-postauthorization`
cobre essa migração e suas diferenças de comportamento em profundidade — o
ponto que vale a pena confirmar aqui é mais estreito: **`@PreFilter` e
`@PostFilter` em si não mudaram.** Mesmo pacote
(`org.springframework.security.access.prepost`), mesma variável
`filterObject`, mesmo atributo `filterTarget`, mesma semântica, não
deprecated. Todo snippet de filtering do capítulo 17 ainda compila e se
comporta identicamente uma vez que a annotation de habilitação é trocada:

```java
@Configuration
@EnableMethodSecurity      // was @EnableGlobalMethodSecurity(prePostEnabled = true)
public class ProjectConfig { }
```

As versões atuais *ampliaram* o que as annotations aceitam — a referência
agora documenta alvos `Map` e `Stream`, e varargs, ao lado de coleções e
arrays simples, onde o livro só discute coleções e arrays. Isso é
capacidade adicionada, não uma correção.

### Livro vs. hoje: a técnica de repository da seção 17.3 ainda é a oficialmente recomendada

Essa é a parte que mais vale a pena checar, porque "colocar SpEL num
`@Query`" soa como um workaround de 2020 que um framework moderno teria
substituído por algo tipado. Não foi. A referência atual do Spring Security
tem uma página dedicada de *Spring Data Integration* descrevendo exatamente
os dois passos do livro — declarar um bean
`SecurityEvaluationContextExtension`, depois referenciar expressões de
segurança dentro de `@Query` — com o mesmo raciocínio que o livro dá,
declarado quase diretamente:

> "This integration allows you to refer to the current user within your
> queries... necessary to support paged results since filtering results
> afterwards would not scale."

O aviso correspondente aparece na própria página de method security, anexado
a ambas as annotations de filter: "In-memory filtering can obviously be
expensive, and so be considerate of whether it is better to filter the data
in the data layer instead" — com a frase *filter the data in the data layer*
linkando direto para essa página de integração com Spring Data. Então o arco
narrativo do capítulo 17 do livro (mostrar `@PostFilter` num repository,
depois explicar por que você não deveria colocar isso em produção e mover o
predicado para a query) é a recomendação oficialmente documentada hoje, não
um conselho desatualizado.

Uma adição genuína a fazer: a documentação lista
`org.springframework.security:spring-security-data` como dependência
obrigatória para essa integração. O snippet de `pom.xml` do livro mostra só
`spring-boot-starter-security`, `spring-boot-starter-web`,
`spring-boot-starter-data-jpa`, e um driver JDBC. Se
`SecurityEvaluationContextExtension` não resolver, esse artefato faltando é
a primeira coisa a checar.

Para predicados genuinamente complexos e componíveis, as próprias APIs
`Specification` / QueryDSL do Spring Data são a forma idiomática de
construir a cláusula `WHERE` — mas note o que isso muda e o que não muda:
muda *como você expressa* o predicado, e você ainda precisa buscar o
principal você mesmo (tipicamente de `SecurityContextHolder`). O Spring
Security não documenta uma integração de segurança baseada em
`Specification` como substituta para a rota `@Query` +
`SecurityEvaluationContextExtension`. Trate `Specification` como a opção
para quando a própria query é dinâmica, não como a sucessora moderna da
seção 17.3.

## Trade-offs

- **Filtering desacopla a regra de scoping de dados da lógica de negócio, ao
  custo de torná-la invisível no ponto de chamada.** O ganho é real: a regra
  de ownership vale não importa quem chame `sellProducts`, e o corpo do
  método fica livre de lookups em `SecurityContextHolder`. A desvantagem é
  que um caller lendo `productService.sellProducts(products)` não tem nenhum
  sinal local de que a lista que passou está prestes a encolher por baixo
  dele.
- **`@PreFilter` mutar a coleção do caller é uma abstração vazada.**
  ```java
  productService.sellProducts(List.of(a, b, c));   // UnsupportedOperationException
  ```
  Um aspecto que silenciosamente exige que seu argumento seja mutável
  contrabandeou um contrato para dentro do código chamador que nenhuma
  assinatura expressa. Onde o método é chamado de muitos lugares, copiar
  defensivamente para um `ArrayList` na fronteira é mais barato do que
  debugar o 500 depois.
- **`@PostFilter` falha silenciosamente onde `@PostAuthorize` falha
  ruidosamente, e isso corta nos dois sentidos.** Descartar silenciosamente
  elementos não autorizados é exatamente certo para uma listagem, e
  exatamente errado quando o caller pediu algo específico e precisa saber
  que foi recusado. Um resultado filtrado até ficar vazio é indistinguível
  de um resultado genuinamente vazio.
- **`@PostFilter` num método de repository é o único uso contra o qual o
  livro argumenta ativamente, e a documentação oficial concorda.** Funciona,
  é fácil de escrever, e move o resultado inteiro pelo heap antes de
  descartar a maior parte dele. O princípio geral declarado no livro
  generaliza para além do Spring: *busque só os dados que você precisa, de
  onde quer que os dados venham — banco de dados, web service ou stream* —
  em vez de buscar amplamente e filtrar na aplicação.
- **Empurrar o predicado para dentro do `@Query` compra performance e
  paginação correta, e abre mão do desacoplamento que motivou o filtering em
  primeiro lugar.** A regra de segurança agora está embutida numa string
  JPQL: não é checada em tempo de compilação, é invisível para quem lê a
  assinatura do método, e tem que ser repetida em toda query que precisa
  dela. Essa geralmente é a troca certa para um repository, mas é uma troca,
  não uma melhoria estrita — a versão baseada em aspecto genuinamente era
  mais fácil de manter, só não escalava.
- **SpEL dentro de um `@Query` falha em runtime, não no startup.** Um erro
  de digitação em `?#{authentication.name}` — ou um bean
  `SecurityEvaluationContextExtension` faltando, ou o artefato
  `spring-security-data` faltando — só aparece na primeira vez que a query
  executa. Como um predicado de segurança quebrado pode falhar *aberto*
  (retornando linhas que o caller não deveria ver) tão facilmente quanto
  fechado, esses métodos de query pedem um teste de integração que de fato
  assere o scoping por linha sob dois principais diferentes, não só que o
  endpoint retorna `200`.

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 17, "Global method security: Pre- and postfiltering", sections 17.1-17.3, p. 414-432 — doc
- [Spring Security Reference — Method Security (@PreFilter / @PostFilter)](https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html) — doc
- [Spring Security Reference — Spring Data Integration](https://docs.spring.io/spring-security/reference/servlet/integrations/data.html) — doc
- [Spring Security API — PreFilter (value, filterTarget)](https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/access/prepost/PreFilter.html) — doc
- [Spring Security API — SecurityEvaluationContextExtension](https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/data/repository/query/SecurityEvaluationContextExtension.html) — doc
