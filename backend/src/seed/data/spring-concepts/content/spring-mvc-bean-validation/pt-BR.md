---
version: 1.0
updatedAt: 2026-07-31
title: Validação de Formulário no Spring MVC com a Bean Validation API
---
## Objective

Deixar dados inválidos chegarem à lógica de negócio de um controller significa
que todo método handler acaba cheio de checagens `if`/`then` tediosas de
escrever e fáceis de errar. A Bean Validation API (JSR-303, agora parte do
Jakarta EE) permite declarar regras de validação diretamente nos campos de uma
classe de domínio com annotations, e então fazer o Spring MVC impô-las
automaticamente no momento do form-binding — então um método handler só
precisa perguntar "houve erros?" em vez de re-derivar o que "válido" significa.

## Use Cases

- Rejeitar um pedido submetido cujo nome, rua, cidade, estado, ou CEP esteja
  em branco, sem escrever à mão uma checagem de branco para cada campo.
- Validar o formato de um número de cartão de crédito (`@CreditCardNumber`,
  uma checagem pelo algoritmo de Luhn), o formato `MM/AA` de uma data de
  expiração (`@Pattern`), e a contagem de dígitos de um CVV (`@Digits`)
  declarativamente em vez de com código de parsing customizado.
- Reexibir o mesmo formulário com mensagens de erro por campo quando a
  validação falha, em vez de uma página genérica de "algo deu errado".

## Deep Dive

### Declarando regras de validação na classe de domínio

Annotations de `jakarta.validation.constraints` (a Bean Validation API
central) e `org.hibernate.validator.constraints` (as extensões do Hibernate
Validator) vão diretamente nos campos sendo validados:

```java
public class Taco {

    @NotNull
    @Size(min = 5, message = "Name must be at least 5 characters long")
    private String name;

    @Size(min = 1, message = "You must choose at least 1 ingredient")
    private List<String> ingredients;
}
```

```java
public class Order {

    @NotBlank(message = "Name is required")
    private String name;

    @NotBlank(message = "Street is required")
    private String street;

    @CreditCardNumber(message = "Not a valid credit card number")
    private String ccNumber;

    @Pattern(regexp = "^(0[1-9]|1[0-2])([\\/])([1-9][0-9])$",
             message = "Must be formatted MM/YY")
    private String ccExpiration;

    @Digits(integer = 3, fraction = 0, message = "Invalid CVV")
    private String ccCVV;
}
```

Toda annotation de constraint carrega um atributo `message` para o texto
mostrado ao usuário quando aquela regra específica falha —
`@CreditCardNumber` roda uma checagem de Luhn (captura erros de digitação e
entrada malformada, não se o cartão de fato pode ser cobrado), enquanto
`@Pattern` cobre formatos (como `MM/YY`) que não têm uma annotation
específica.

### Impondo a validação no form binding: `@Valid` + `Errors`

Adicionar `@Valid` ao argumento vinculado de um handler diz ao Spring MVC
para rodar a validação logo depois de vincular os dados do formulário
submetido e antes do corpo do método executar; o resultado cai num parâmetro
`Errors` (ou `BindingResult`, que estende `Errors`) que precisa vir
imediatamente após o argumento validado:

```java
@PostMapping
public String processOrder(@Valid Order order, Errors errors) {
    if (errors.hasErrors()) {
        return "orderForm";
    }
    return "redirect:/";
}
```

Se `errors.hasErrors()` for verdadeiro, o método retorna o nome da view do
formulário de novo em vez de processar os dados (inválidos) — o mesmo padrão
se aplica a qualquer outro command object anotado com `@Valid`, como o
`Taco` vinculado num handler separado.

### Records e validação: annotations declarativas vs. o construtor compacto

Um record pode carregar as mesmas annotations de constraint que uma classe
carrega:

```java
public record ReviewRequest(@NotNull @Min(1) @Max(5) Integer rating,
                             @NotBlank String comment) {}
```

Desde o Java 16, uma annotation num componente de record é copiada para
todo target aplicável — o campo privado, o método accessor, e o parâmetro do
construtor canônico — então isso compila e parece em espírito idêntico aos
exemplos de `Order`/`Taco` acima. Mas se comporta de forma completamente
diferente a menos que algo ative a validação sobre ele:

```java
new ReviewRequest(-5, null);   // compiles, runs, throws nothing at all
```

`@NotNull`/`@Min`/`@Max` são metadados inertes — nada os lê a menos que um
`Validator` seja invocado sobre o objeto. `@Valid` num argumento de
controller é exatamente essa invocação, o que explica por que isso só
"funciona" dentro de um handler do Spring MVC: fora de um handler (um `new`
num service, um teste, um consumer de mensagem), as annotations não fazem
nada.

O próprio **construtor compacto** de um record é um mecanismo totalmente
diferente — código real, imperativo, que roda incondicionalmente em todo
caminho de construção, sem framework nenhum envolvido:

```java
public record ReviewRequest(Integer rating, String comment) {
    ReviewRequest {
        if (rating == null || rating < 1 || rating > 5) {
            throw new IllegalArgumentException("rating must be between 1 and 5");
        }
    }
}
```

Isso lança imediatamente em `new ReviewRequest(-5, null)`, sem `@Valid` e
sem contexto Spring necessário — veja `records-and-sealed-types` para saber
por que isso roda em todo caminho de construção, incluindo deserialização.
Os dois não são soluções concorrentes para o mesmo problema: um construtor
compacto é o lugar certo para um invariante que precisa valer *não importa
como* o objeto foi construído, enquanto `@Valid` mais annotations de
constraint existem especificamente para o caso da fronteira HTTP, onde o
Spring MVC coleta toda violação de uma vez e entrega à view um
`BindingResult` com uma mensagem por campo — algo que uma única exception
lançada por um construtor não pode produzir, já que ela para na primeira
checagem que falhar.

### Exibindo erros no nível de campo na reexibição

Uma vez que o controller redireciona de volta para a view do formulário na
falha, a camada de view lê o mesmo objeto `Errors`/`BindingResult` para
renderizar mensagens por campo ao lado dos inputs em questão
(`#fields.hasErrors('fieldName')` e `th:errors` do Thymeleaf são uma forma
de fazer isso, mas a mecânica de binding/validação acima é agnóstica de
biblioteca de template).

## Trade-offs

- **Validação declarativa troca flexibilidade por legibilidade.** Um regex
  em `@Pattern` ou uma cadeia de annotations nativas cobre a maioria dos
  formatos, mas uma regra que atravessa múltiplos campos (por exemplo, "se
  o tipo de pagamento é cartão de crédito, então `ccNumber` é obrigatório")
  precisa de uma constraint em nível de classe customizada ou de um bean
  `Validator` — a Bean Validation não é um substituto completo para
  validação de regras de negócio.
- **O parâmetro `Errors`/`BindingResult` precisa vir imediatamente depois
  do argumento `@Valid` a que corresponde** — o Spring MVC o resolve
  posicionalmente, então reordenar os parâmetros do método quebra
  silenciosamente a captura de erros em vez de falhar ruidosamente na
  inicialização.
- **Annotations de constraint não validam nada por si mesmas.** São
  metadados declarativos que um `Validator` precisa ler ativamente —
  `@Valid` é um gatilho, mas a mesma classe (ou record) pode ser construída
  em qualquer outro lugar da base de código, totalmente inválida, com zero
  imposição. A validação de um construtor compacto, em contraste, é
  incondicional no nível do tipo. Recorra a annotations de constraint para
  regras de fronteira de requisição que precisam de report de erro por
  campo; recorra a um construtor compacto para um invariante que o próprio
  tipo nunca deveria conseguir violar.
- **Livro vs. hoje:** este livro (2019) diz que a Validation API e a
  implementação do Hibernate vêm transitivamente com o starter web do
  Spring Boot — verdade na época, mas a partir do **Spring Boot 2.3** essas
  dependências foram removidas de `spring-boot-starter-web`. Hoje você
  precisa adicionar `spring-boot-starter-validation` explicitamente, e as
  próprias annotations vivem sob `jakarta.validation.*` em vez de
  `javax.validation.*` desde a migração de namespace do Jakarta EE no
  Spring Boot 3.0.

## Documentation Links

- Craig Walls, "Spring in Action", 5th Edition (Manning, 2019) — Chapter 2, "Developing web applications", section 2.3, "Validating form input", p. 45-50 — doc
- [Spring Framework Reference — Java Bean Validation](https://docs.spring.io/spring-framework/reference/core/validation/beanvalidation.html) — doc
- [Spring Boot Reference — Validation (spring-boot-starter-validation)](https://docs.spring.io/spring-boot/reference/io/validation.html) — doc
- [Jakarta Bean Validation 3.0 Specification](https://jakarta.ee/specifications/bean-validation/3.0/) — doc
- [Hibernate Validator Documentation](https://hibernate.org/validator/documentation/) — doc
