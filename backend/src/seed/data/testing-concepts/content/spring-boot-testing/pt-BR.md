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

## Documentation Links

- [Testando Aplicações Spring Boot: referência do Spring Boot](https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html) (doc)
- [Auto-configuração de fatias de teste (`@WebMvcTest`, `@DataJpaTest`, ...)](https://docs.spring.io/spring-boot/appendix/test-auto-configuration/index.html) (doc)
- [`@MockitoBean` / `@MockitoSpyBean` (substitui `@MockBean`): Spring Framework](https://docs.spring.io/spring-framework/reference/testing/annotations/integration-spring/annotation-mockitobean.html) (doc)
- [JUnit in Action, 3rd Ed., Cap. 17, "Testing Spring Boot applications," pp. 337-357 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) (doc)
