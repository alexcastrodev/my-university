---
version: 1.0
updatedAt: 2026-08-06
title: "Testando Aplicações Spring Boot"
summary: "Inicializando um contexto de aplicação completo com @SpringBootTest: varredura de componentes, auto-configuração e autowiring de beans, além das fatias de teste mais rápidas de hoje (@WebMvcTest, @DataJpaTest) e a mudança @MockBean para @MockitoBean, do JUnit in Action, Third Edition, Cap. 17."
---
## Objective

O Spring Boot empilha auto-configuração e varredura de componentes sobre o Spring TestContext framework. A anotação única `@SpringBootTest` inicializa um contexto de aplicação completo para um teste: localiza a configuração do Boot, varre o pacote da classe de teste e subpacotes em busca de beans, aplica a auto-configuração e então injeta o que o teste pedir. Isso transforma a configuração multi-anotação do Spring puro (`@ExtendWith(SpringExtension.class)` + `@ContextConfiguration`) em um único ponto de entrada opinativo para teste de integração de uma aplicação Boot.

## Use Cases

- Testar uma funcionalidade de ponta a ponta em integração com o grafo real de beans (controllers, services, repositories) carregado exatamente como a aplicação os montaria.
- Testar um comportamento que atravessa vários beans colaborando (publicar um evento Spring e afirmar que os listeners reagiram), onde mockar tudo derrotaria o propósito.
- Migrar um teste Spring puro para o Boot: abandonar `@ContextConfiguration` em favor da varredura de componentes do `@SpringBootTest`.
- Trazer beans de fixture extras para o contexto de um teste via `@Import(SomeBuilder.class)` sem poluir a configuração de produção.
- Fazer a ponte entre uma configuração XML legada e um teste Boot com `@ImportResource` enquanto se migra a configuração para anotações/config Java.

## Deep Dive

### `@SpringBootTest` = contexto + varredura de componentes + auto-config

`@SpringBootTest` inicia o contexto de aplicação da forma como o Spring Boot faria em tempo de execução. Ele busca no pacote da classe de teste atual e seus subpacotes por definições de bean, então beans ali são descobertos e podem ser injetados diretamente no teste:

```java
@SpringBootTest
@Import(FlightBuilder.class)               // brings in the Flight + Country fixture beans
public class FlightTest {
    @Autowired
    private Flight flight;                  // discovered/imported and injected

    @Autowired
    private RegistrationManager registrationManager;  // found by component scan

    @Test
    void testFlightPassengersRegistration() {
        for (Passenger passenger : flight.getPassengers()) {
            assertFalse(passenger.isRegistered());
            registrationManager.getApplicationContext()
                .publishEvent(new PassengerRegistrationEvent(passenger));
        }
        for (Passenger passenger : flight.getPassengers()) {
            assertTrue(passenger.isRegistered());
        }
    }
}
```

Nenhum `@ExtendWith` é escrito aqui: `@SpringBootTest` é meta-anotado com `@ExtendWith(SpringExtension.class)`, então a extensão é aplicada transitivamente.

### Combinando com configuração existente

Durante a migração, um teste Boot ainda pode consumir beans definidos do jeito antigo. `@ImportResource` traz um contexto XML; `@EnableAutoConfiguration` (implícito em `@SpringBootTest`, mas mostrado aqui explicitamente no passo de migração do livro) dispara a auto-configuração do Boot:

```java
@SpringBootTest
@EnableAutoConfiguration
@ImportResource("classpath:application-context.xml")  // legacy XML beans
class RegistrationTest {
    @Autowired
    private RegistrationManager registrationManager;   // still autowired
}
```

Este é o caminho de "migração suave": mantenha os beans XML funcionando sob o Boot, então os mova para config Java aos poucos.

### Livro vs. hoje: fatias de teste em vez de sempre carregar tudo

> O livro (Spring Boot 2.x, 2020) recorre a `@SpringBootTest` para seus exemplos, carregando o contexto inteiro toda vez. O Spring Boot também oferece **fatias de teste (test slices)**: anotações que carregam só os beans de uma camada, deixando os testes muito mais rápidos e focados:

```java
@WebMvcTest(CountryController.class)   // only the web layer (controllers, MVC infra)
class CountryControllerTest { /* no service/repository beans loaded */ }

@DataJpaTest                            // only JPA repositories + an embedded DB
class PassengerRepositoryTest { /* controllers/services not loaded */ }
```

> Recorra a `@SpringBootTest` quando genuinamente precisar do contexto completo (integração de ponta a ponta de verdade); recorra a uma fatia quando estiver testando uma única camada. A abordagem do livro ainda funciona, é só mais pesada do que o necessário para testes de camada única.

## Trade-offs

- **Testes de contexto completo são o tipo mais lento**: `@SpringBootTest` inicializa a aplicação inteira, então uma suíte deles é bem mais lenta do que testes fatiados ou unitários; o contexto é cacheado e reutilizado entre classes com configuração idêntica, mas um contexto completo ainda é caro de construir na primeira vez.
- **A varredura de componentes depende do posicionamento do pacote**: `@SpringBootTest` varre o pacote da classe de teste e subpacotes, então um bean definido fora dessa árvore simplesmente não é encontrado, e o autowiring falha silenciosamente:

```java
@Autowired
private RegistrationManager registrationManager; // fails if the bean lives outside the scanned package tree
```

- **A conveniência esconde o que foi carregado**: como uma única anotação traz auto-configuração e uma varredura completa, é fácil depender de um bean sem perceber que ele estava ali, tornando a superfície real de dependências do teste maior e mais frágil do que uma fatia que carrega um conjunto conhecido e mínimo.
- **`@MockBean` seguiu adiante**: o livro substitui beans reais por `@MockBean`; desde o Spring Boot 3.4 / Spring Framework 6.2, `@MockBean` e `@SpyBean` estão obsoletos em favor de `@MockitoBean` e `@MockitoSpyBean` (agora parte do framework, não do Boot):

```java
// book (Boot 2.x)         →   today (Boot 3.4+ / Framework 6.2+)
// @MockBean                    @MockitoBean
private CountryRepository countryRepository;
```

## Lab

Neste lab você recebe uma aplicação Spring Boot **pronta e funcionando** (`OrderService`, `InventoryService`, `InventoryListener` e `GreetingController`) e duas classes de teste com métodos que falham de propósito. Seu trabalho é escrever dois tipos diferentes de teste sobre a mesma aplicação: um `@SpringBootTest` com o contexto completo e um slice estreito com `@WebMvcTest`. A ideia central é ver com os próprios olhos quando cada um é a ferramenta certa: o slice é barato e testa uma camada isolada, o contexto completo é o único que prova que os beans realmente colaboram.

**O cenário**

Fazer um pedido atualiza o estoque, mas sem que um bean chame o outro.

- `OrderService.placeOrder(order)`: só publica um `OrderPlacedEvent`. Nunca fala com o `InventoryService`.
- `InventoryListener`: um `@EventListener` que reage ao evento e chama `InventoryService.reserve(...)`. Roda de forma síncrona na thread de quem publicou, então quando `placeOrder` retorna o estoque já mudou.
- `InventoryService`: estoque em memória (`widget` com 100 e `gadget` com 50). `reserve` lança `IllegalArgumentException` para produto desconhecido e `IllegalStateException` se faltar estoque.
- `GreetingController`: `GET /greeting` devolve "Hello, Kurz!" e não tem colaboradores.
- `OrderPlacingIntegrationTest` (`@SpringBootTest`) e `GreetingControllerSliceTest` (`@WebMvcTest(GreetingController.class)`) são os testes a completar.

**O que você vai fazer, passo a passo**

1. **Provar a cadeia ponta a ponta (TODO-00).** Em `OrderPlacingIntegrationTest`, chame `orderService.placeOrder(new Order("widget", 10))` e confira que `inventoryService.getStock("widget")` agora é 90. Só funciona porque o contexto completo liga evento, listener e serviço como as mesmas instâncias que você injetou. Um slice `@WebMvcTest` nem carregaria o `InventoryListener`.
2. **Provar o efeito cumulativo (TODO-01).** Faça dois pedidos de 5 unidades de "gadget" e confira o estoque indo de 50 para 45 e depois para 40. Isso mostra que o estado mudado por um bean é visto por outro, porque todos compartilham o mesmo contexto em cache.
3. **Testar o endpoint pelo slice (TODO-03).** Em `GreetingControllerSliceTest`, faça `GET /greeting` com `MockMvc`, confira `status().isOk()` e o corpo "Hello, Kurz!" com `content().string(...)`.
4. **Provar o que o slice não carrega (TODO-04).** Confira que `applicationContext.getBeanNamesForType(InventoryService.class)` tem tamanho 0. O controller não depende do serviço, então o slice nunca o carrega: escolher entre `@SpringBootTest` e slice não é só velocidade, é quais beans entram no teste.

**Como saber que terminou**

`mvn test` fica todo verde. Você consegue explicar por que o teste de estoque não faria sentido com um mock do `InventoryService`, e por que o slice testa só uma camada mas inicia bem mais rápido.

**Desafios opcionais**

- **TODO-02:** confira que `orderService.placeOrder(new Order("unknown", 1))` lança `IllegalArgumentException`. Como o `@EventListener` é síncrono por padrão, a exceção do `reserve` volta por `publishEvent(...)` até a sua chamada.

**Pré-requisitos:** o lab de Spring REST API Testing with MockMvc (`@WebMvcTest`, `MockMvc`) e ler `OrderService`, `InventoryService`, `InventoryListener`, `OrderPlacedEvent` e `GreetingController` em `src/main/java` antes de escrever qualquer teste.

**Como rodar:** clone o repositório, entre em `testing-concepts/spring-boot-testing` e rode `mvn test` (ou, da raiz, `mvn -pl testing-concepts/spring-boot-testing test`). Os métodos de teste começam com `fail("TODO-NN: not implemented yet")`, então os testes vermelhos são o seu checklist.

## Documentation Links

- [Testando Aplicações Spring Boot: referência do Spring Boot](https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html) (doc)
- [Auto-configuração de fatias de teste (`@WebMvcTest`, `@DataJpaTest`, ...)](https://docs.spring.io/spring-boot/appendix/test-auto-configuration/index.html) (doc)
- [`@MockitoBean` / `@MockitoSpyBean` (substitui `@MockBean`): Spring Framework](https://docs.spring.io/spring-framework/reference/testing/annotations/integration-spring/annotation-mockitobean.html) (doc)
- [JUnit in Action, 3rd Ed., Cap. 17, "Testing Spring Boot applications," pp. 337-357 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) (doc)
