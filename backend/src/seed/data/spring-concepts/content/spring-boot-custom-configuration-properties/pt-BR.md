---
version: 1.0
updatedAt: 2026-08-04
title: Criando Suas Próprias Configuration Properties com @ConfigurationProperties
summary: Como @ConfigurationProperties transforma os setters de qualquer bean em valores vindos da configuração, por que extraí-los para um bean holder dedicado mantém controllers e services limpos, e como gerar metadados de IDE para propriedades customizadas, além de por que records com constructor binding são agora a alternativa preferida a uma classe holder mutável baseada em Lombok.
---
## Objective

Os próprios beans do Spring Boot (`DataSource`, o servidor embutido, o
sistema de logging) não são as únicas coisas que conseguem ler da abstração
de environment — as propriedades de qualquer bean podem, assim que ele é
anotado com `@ConfigurationProperties`. Isso transforma um valor codificado
(um tamanho de página, um limite, uma feature flag) em algo alterável sem
rebuild e — assim que a propriedade é retirada da classe que a usa e
colocada num bean holder dedicado — algo reutilizável e independentemente
validável também.

## Use Cases

- Substituir uma constante codificada (tamanho de página, uma contagem de
  retry, um timeout) por um valor que pode ser mudado por ambiente via
  `application.yml`, uma variável de ambiente, ou um argumento de linha de
  comando, sem exigir rebuild.
- Reunir vários valores de configuração relacionados que múltiplos beans
  precisam (tamanho de página, um limite de exibição, um toggle de feature)
  numa única classe holder dedicada em vez de duplicar
  `@ConfigurationProperties` em cada bean que precisa de um deles.
- Aplicar validação (um mínimo/máximo, um valor obrigatório) a um valor de
  configuração num único lugar, em vez de repetir anotações de validação em
  cada bean que por acaso usa essa propriedade.
- Ganhar autocomplete e documentação ao passar o mouse na IDE para uma
  propriedade customizada, a mesma experiência que as próprias propriedades
  embutidas do Spring já oferecem.

## Deep Dive

### Transformando um valor codificado numa configuration property

Dado um controller com um tamanho de página codificado para uma lista
paginada de pedidos:

```java
@GetMapping
public String ordersForUser(
    @AuthenticationPrincipal User user, Model model) {

    Pageable pageable = PageRequest.of(0, 20);
    model.addAttribute("orders",
        orderRepo.findByUserOrderByPlacedAtDesc(user, pageable));

    return "orderList";
}
```

`@ConfigurationProperties` no próprio controller transforma o `20`
codificado num campo configurável, vinculado a qualquer propriedade sob o
`prefix` dado:

```java
@Controller
@RequestMapping("/orders")
@SessionAttributes("order")
@ConfigurationProperties(prefix = "taco.orders")
public class OrderController {

    private int pageSize = 20;

    public void setPageSize(int pageSize) {
        this.pageSize = pageSize;
    }

    @GetMapping
    public String ordersForUser(
        @AuthenticationPrincipal User user, Model model) {

        Pageable pageable = PageRequest.of(0, pageSize);
        model.addAttribute("orders",
            orderRepo.findByUserOrderByPlacedAtDesc(user, pageable));

        return "orderList";
    }
}
```

O `prefix` significa que a propriedade é definida como
`taco.orders.pageSize` — em YAML, como variável de ambiente, ou como
argumento de linha de comando, exatamente como qualquer propriedade
embutida do Spring Boot:

```yaml
taco:
  orders:
    pageSize: 10
```

```bash
$ export TACO_ORDERS_PAGESIZE=10
```

### Extraindo um holder dedicado de configuration properties

Colocar `@ConfigurationProperties` direto no `OrderController` funciona, mas
mistura preocupações de configuração numa classe cujo trabalho é tratar
requisições HTTP. Um bean holder — uma classe cujo propósito inteiro é
carregar dados de configuração — mantém essa separação e torna as
propriedades reutilizáveis por qualquer outro bean que precise delas:

```java
@Component
@ConfigurationProperties(prefix = "taco.orders")
@Data
public class OrderProps {

    private int pageSize = 20;
}
```

`@Component` deixa o component scanning do Spring descobri-lo e registrá-lo
como bean; `@Data` (Lombok) gera o par getter/setter pelo qual
`@ConfigurationProperties` faz o binding. `OrderController` então depende de
`OrderProps` em vez de possuir a própria propriedade:

```java
@Controller
@RequestMapping("/orders")
@SessionAttributes("order")
public class OrderController {

    private OrderRepository orderRepo;
    private OrderProps props;

    public OrderController(OrderRepository orderRepo, OrderProps props) {
        this.orderRepo = orderRepo;
        this.props = props;
    }

    @GetMapping
    public String ordersForUser(
        @AuthenticationPrincipal User user, Model model) {

        Pageable pageable = PageRequest.of(0, props.getPageSize());
        model.addAttribute("orders",
            orderRepo.findByUserOrderByPlacedAtDesc(user, pageable));

        return "orderList";
    }
}
```

### Validando uma configuration property num único lugar

Como a propriedade agora mora numa única classe, adicionar validação
significa mexer só em `OrderProps` — não em todo bean que por acaso usa
`pageSize`:

```java
@Component
@ConfigurationProperties(prefix = "taco.orders")
@Data
@Validated
public class OrderProps {

    @Min(value = 5, message = "must be between 5 and 25")
    @Max(value = 25, message = "must be between 5 and 25")
    private int pageSize = 20;
}
```

`@Validated` dispara a Bean Validation nas propriedades vinculadas na
inicialização — um valor fora da faixa falha rápido, antes da aplicação
terminar de subir, em vez de aparecer depois como um comportamento de
paginação inesperado.

### Documentando propriedades customizadas com metadados de IDE

Uma propriedade customizada como `taco.orders.pageSize` não tem descrição
embutida da forma que as propriedades do próprio Spring têm, o que aparece
como um aviso de "Unknown Property" numa IDE que entende metadados de
configuração do Spring. Um arquivo JSON em
`src/main/resources/META-INF/additional-spring-configuration-metadata.json`
preenche essa lacuna:

```json
{
  "properties": [
    {
      "name": "taco.orders.page-size",
      "type": "java.lang.String",
      "description": "Sets the maximum number of orders to display in a list."
    }
  ]
}
```

Os metadados usam a forma kebab-case `taco.orders.page-size` — o binding
relaxado de propriedades do Spring Boot trata isso como equivalente a
`taco.orders.pageSize`. Com os metadados em vigor, a propriedade ganha
documentação ao passar o mouse e autocomplete na IDE igual a uma fornecida
pelo próprio framework; os metadados são puro açúcar de ferramenta e não
têm efeito nenhum sobre se a propriedade de fato faz bind.

## Trade-offs

- **`@ConfigurationProperties` direto num controller (ou qualquer bean que
  já faz outra coisa) funciona, mas mistura duas responsabilidades numa só
  classe.** Extrair um holder dedicado custa mais uma classe, mas significa
  que o controller não precisa mais saber que também é um alvo de
  configuração, e o mesmo holder se torna reutilizável por qualquer outro
  bean que precise dos mesmos valores.
- **Centralizar uma propriedade num bean holder torna renomear, validar ou
  remover uma mudança feita num único lugar em vez de um
  buscar-e-substituir por cada consumidor.** O próprio exemplo do livro —
  adicionar `@Min`/`@Max` — de outra forma precisaria ser repetido em cada
  bean que lia `pageSize` diretamente.
- **Metadados de configuração são pura documentação, não aplicação.** Pular
  o arquivo `additional-spring-configuration-metadata.json` não quebra
  nada; só significa que a IDE não consegue mostrar uma descrição ou
  oferecer autocomplete para aquela propriedade específica, e mostra um
  aviso de "propriedade desconhecida" que é cosmético, não um erro de
  verdade.
- **Book vs. today: a descoberta via `@Component` não é mais o caminho de
  registro recomendado para classes `@ConfigurationProperties`.** O livro
  depende de `@Component` mais component scanning de classpath para
  encontrar `OrderProps`. A documentação de referência oficial do Spring
  Boot hoje recomenda `@ConfigurationPropertiesScan` (tipicamente na classe
  `@SpringBootApplication`) ou `@EnableConfigurationProperties(OrderProps.class)`
  explícito em vez disso — e é explícita ao dizer que `@Component` só deve
  ser usado quando o bean de propriedades *também* precisa de outros beans
  injetados via seu construtor, já que beans de configuration-properties
  descobertos via `@Component` usam binding de propriedade estilo JavaBean
  simples, não o binding via construtor mais novo descrito a seguir.
  Confirmado pela referência atual do Spring Boot:
  ```java
  @SpringBootApplication
  @ConfigurationPropertiesScan
  public class TacoCloudApplication { }
  ```
- **Book vs. today: records agora são uma alternativa imutável e de
  primeira classe a uma classe holder mutável com Lombok `@Data`.** Desde o
  Spring Boot 2.6 (com Java 16+), um record pode ser anotado
  `@ConfigurationProperties` diretamente, com binding feito via construtor
  em vez de setters — e a menos que o record tenha mais de um construtor,
  `@ConstructorBinding` nem é necessário. Isso não era possível quando o
  livro foi publicado (records em si não existiam como um recurso finalizado
  do Java até o Java 16, em 2021), mas endereça diretamente o próprio design
  de `OrderProps` do livro, que precisa do Lombok especificamente para
  evitar escrever getters/setters à mão para algo que é conceitualmente um
  valor imutável:
  ```java
  @ConfigurationProperties(prefix = "taco.orders")
  public record OrderProps(int pageSize) { }
  ```
  Classes com binding via construtor (incluindo records) precisam ser
  registradas via `@ConfigurationPropertiesScan` ou
  `@EnableConfigurationProperties` — elas não podem ser descobertas via
  `@Component`, confirmado pela referência atual.

## Lab

Neste lab você recebe um `record` de configuração de e-mail (`MailProperties`) com as constraints de validação já escritas, mas **nada ligado** ao Spring Boot. Seu trabalho é fazer o Boot preencher o `record` a partir do ambiente e **falhar a inicialização** quando um valor for inválido. A ideia central é o fail-fast: um host em branco ou uma porta fora do intervalo deve derrubar o contexto na partida, e não virar um bug misterioso em tempo de execução.

**O cenário**

Configuração de envio de e-mail com `host`, `port`, `retryCount` e `enabled`, lida de propriedades `mail.*`.

- `MailProperties`: o `record`. `host` já tem `@NotBlank` e `port` já tem `@Min`/`@Max` (1 a 65535); `retryCount` ainda não tem constraint.
- `MailConfig`: uma `@Configuration` vazia.
- `MailPropertiesBindingTest`: usa `ApplicationContextRunner` com `MailConfig`. Cobre o binding válido, o relaxed binding de `mail.retry-count`, e três falhas de partida (host em branco, porta 70000 e retry negativo). Nas duas primeiras o teste confere que a mensagem de falha cita `mail.host` ou `mail.port`.

**O que você vai fazer, passo a passo**

1. **Ligar o prefixo (TODO-00).** Anote `MailProperties` com `@ConfigurationProperties(prefix = "mail")`. É o relaxed binding que leva `mail.retry-count` até `retryCount`.
2. **Ativar a validação (TODO-01).** Anote também com `@Validated` (de `org.springframework.validation.annotation`). Sem isso, as constraints Jakarta existem mas são ignoradas durante o binding.
3. **Completar as constraints (TODO-02).** Adicione `@PositiveOrZero` com uma `message` em `retryCount`, para que `-1` falhe na partida.
4. **Registrar o bean (TODO-03).** Anote `MailConfig` com `@EnableConfigurationProperties(MailProperties.class)`. Sem isso, nenhum bean `MailProperties` existe no contexto.

**Como saber que terminou**

`mvn test` fica verde. Você deve conseguir explicar a diferença entre as duas provas do teste: o binding (nomes em kebab-case chegando aos componentes do record) e a validação (valores inválidos impedindo o contexto de subir), e qual anotação é responsável por cada uma.

**Desafios opcionais**

- **TODO-04:** adicione a fábrica estática `MailProperties.disabled(String host, int port)` que devolve uma instância com `retryCount` 0 e `enabled` falso, útil em testes e ambientes que nunca devem enviar e-mail.

**Pré-requisitos:** wiring básico de beans no Spring Boot, records e binding por construtor, e anotações do Jakarta Bean Validation (`@NotBlank`, `@Min`, `@Max`).

**Como rodar:** clone o repositório, entre em `spring-concepts/spring-boot-custom-configuration-properties` e rode `mvn test`. Os testes falham até as anotações estarem no lugar; comece pelos comentários `TODO` em `MailProperties` e `MailConfig`.

## Documentation Links

- Craig Walls, "Spring in Action", 5th Edition (Manning, 2019) — Chapter 5, "Working with configuration properties", section 5.2, p. 122-129 — doc
- [Spring Boot Reference — Externalized Configuration (Type-safe Configuration Properties)](https://docs.spring.io/spring-boot/reference/features/external-config.html) — doc
- [Spring Boot Reference — Configuration Metadata (Generating Your Own Metadata via the Annotation Processor)](https://docs.spring.io/spring-boot/specification/configuration-metadata/annotation-processor.html) — doc
- [Spring Boot API — ConfigurationPropertiesScan](https://docs.spring.io/spring-boot/api/java/org/springframework/boot/context/properties/ConfigurationPropertiesScan.html) — doc
