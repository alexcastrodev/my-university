---
version: 1.1
updatedAt: 2026-08-17
title: "Testando Spring com SpringExtension"
summary: "Carregando um ApplicationContext do Spring em um teste JUnit 5 com @ExtendWith(SpringExtension.class) e @ContextConfiguration, injetando beans via @Autowired, com uma nota sobre o atalho @SpringJUnitConfig de hoje, do JUnit in Action, Third Edition, Cap. 16."
---
## Objective

O Spring é um container de IoC (inversão de controle): em vez de uma classe construir seus próprios colaboradores, o container cria e conecta ("beans") e os entrega. Testar uma aplicação Spring, portanto, significa carregar um `ApplicationContext` e trazer beans conectados para dentro do teste. O JUnit 5 faz isso pelo `Spring TestContext Framework`, ativado por `@ExtendWith(SpringExtension.class)`, o mesmo mecanismo de extensão que o Mockito usa, combinado com `@ContextConfiguration` para dizer *qual* contexto carregar e `@Autowired` para injetar beans na classe de teste.

## Use Cases

- Verificar que os beans estão conectados corretamente entre si (um `Passenger` recebe seu `Country`) carregando o contexto real do Spring no teste, em vez de construir objetos à mão.
- Testar um service que depende de outros componentes gerenciados pelo Spring, deixando o container injetar o grafo inteiro no teste via `@Autowired`.
- Migrar uma suíte de teste Spring 4 + JUnit 4 (`@RunWith(SpringJUnit4ClassRunner.class)`) para Spring 5 + JUnit 5 (`@ExtendWith(SpringExtension.class)`).
- Carregar uma configuração de contexto específica de teste (uma config XML/Java dedicada com beans de teste) separada da configuração de produção.
- Reutilizar um contexto carregado em muitos métodos de teste, já que o TestContext framework o armazena em cache em vez de reconstruí-lo por teste.

## Deep Dive

### O container de IoC e os beans

Um contexto Spring descreve objetos e suas dependências; o container os instancia e conecta. O livro começa com XML para clareza: um bean `passenger` cuja propriedade `country` referencia um bean `country`:

```xml
<bean id="passenger" class="com.manning.junitbook.spring.Passenger">
    <constructor-arg name="name" value="John Smith"/>
    <property name="country" ref="country"/>
</bean>
<bean id="country" class="com.manning.junitbook.spring.Country">
    <constructor-arg name="name" value="USA"/>
    <constructor-arg name="codeName" value="US"/>
</bean>
```

Sem nenhum framework de teste, você carregaria esse contexto e pediria beans à mão:

```java
ClassPathXmlApplicationContext context =
    new ClassPathXmlApplicationContext("classpath:application-context.xml");
Passenger passenger = (Passenger) context.getBean("passenger");
```

### Conectando o contexto a um teste JUnit 5 com SpringExtension

`SpringExtension` (introduzida no Spring 5) integra o Spring TestContext framework com o JUnit Jupiter. Registrada com `@ExtendWith`, ela lê `@ContextConfiguration` para construir o contexto e então satisfaz campos `@Autowired` no próprio teste, substituindo as chamadas manuais a `getBean(...)` acima:

```java
@ExtendWith(SpringExtension.class)
@ContextConfiguration("classpath:application-context.xml")
public class SpringAppTest {
    @Autowired
    private Passenger passenger;   // injected by the container, not constructed here

    @Test
    public void testInitPassenger() {
        assertEquals(getExpectedPassenger(), passenger);
    }
}
```

`spring-test` fornece `SpringExtension` e `@ContextConfiguration`; `spring-context` fornece `@Autowired`. O container procura um único bean do tipo autowired; se houver dois beans `Passenger`, a injeção fica ambígua e o contexto falha com `UnsatisfiedDependencyException`.

### Migrando do runner do JUnit 4

No JUnit 4, a mesma integração era um *runner*, e só um runner podia ser aplicado por classe:

```java
// JUnit 4 + Spring 4
@RunWith(SpringJUnit4ClassRunner.class)
@ContextConfiguration("classpath:application-context.xml")
public class SpringAppTest { /* ... */ }
```

```java
// JUnit 5 + Spring 5, same @ContextConfiguration, extension instead of runner
@ExtendWith(SpringExtension.class)
@ContextConfiguration("classpath:application-context.xml")
public class SpringAppTest { /* ... */ }
```

Como `@ExtendWith` é repetível (diferente de `@RunWith`), a extensão do Spring agora pode coexistir com, digamos, a do Mockito na mesma classe.

### Livro vs. hoje: `@SpringJUnitConfig` e config Java

> O livro (Spring 5.2, 2020) escreve `@ExtendWith(SpringExtension.class)` + `@ContextConfiguration` como duas anotações separadas. O Spring fornece um atalho composto, `@SpringJUnitConfig`, que empacota exatamente essas duas: o idioma moderno para a mesma conexão:

```java
@SpringJUnitConfig(locations = "classpath:application-context.xml")
public class SpringAppTest {
    @Autowired
    private Passenger passenger;
}
```

> O livro também começa com XML "como uma introdução suave" e passa para anotações depois; hoje o padrão são classes Java `@Configuration` (`@SpringJUnitConfig(AppConfig.class)`), com XML reservado a contextos legados. XML continua totalmente suportado, então os exemplos do livro ainda rodam; simplesmente deixaram de ser a primeira escolha.

### Cache de contexto e esgotamento de pool de conexões

O cache é o que torna uma suíte grande de `@SpringBootTest` tolerável: um contexto de "mesma configuração" (mesmos `@Import`s, mesmos `@MockitoBean`s, mesmo `@TestPropertySource`/`properties`, mesmos perfis ativos...) é construído uma vez e reutilizado por toda classe de teste que o solicitar. Mas "mesma configuração" é uma régua mais rígida do que parece: mude qualquer uma dessas entradas (um `@MockitoBean` extra, um `properties = {...}` diferente em `@SpringBootTest`, um `@Import` diferente) e você ganha uma **nova** chave de cache, logo um `ApplicationContext` novo, logo um `DataSource` novo com seu próprio pool de conexões. Uma suíte com algumas centenas de classes de teste pode facilmente acabar com duas ou três dezenas de contextos distintos vivos em cache ao mesmo tempo (a eviction padrão de cache do Spring só entra em ação por volta de 32 entradas).

Cada um desses contextos abre seu próprio pool HikariCP no tamanho padrão (10 conexões). Multiplique: 30 contextos vivos × 10 conexões dá até 300 conexões simultâneas pedidas de uma instância Postgres cujo `max_connections` padrão é 100. A falha que aparece é:

```
FATAL: sorry, too many clients already
```

surgindo como `FlywaySqlUnableToConnectToDbException` ou `BeanCreationException: Error creating bean with name 'entityManagerFactory'` enquanto uma classe de teste *posterior*, sem relação, está tentando inicializar seu contexto, não vinda dos testes que abriram as conexões anteriores. Parece uma falha de teste instável e aleatória (intermitente, dependente da posição na suíte, some quando você reroda a classe que falhou isoladamente), porque no momento em que se manifesta, a causa real (contextos demais vivos ao mesmo tempo) já ficou várias classes de teste para trás. Reexecuções isoladas passam porque o cache está frio de novo e só um contexto disputa conexões.

A correção não é caçar o teste "instável"; é dimensionar o pool para o que a *JVM de teste* de fato faz com ele. Os testes de cada contexto rodam majoritariamente em uma única thread (`MockMvc`, uma chamada de repository, um método de service `@Transactional`), então um pool de 10 conexões ociosas mas reservadas por contexto é puro desperdício multiplicado por quantos contextos o cache estiver segurando:

```yaml
# application-test.yml
spring:
  datasource:
    hikari:
      maximum-pool-size: 3
      minimum-idle: 1
```

Três conexões são folga de sobra para uma classe de teste de thread única (thread principal, mais a conexão de migração do Flyway na inicialização, mais alguma thread ocasional de algo como um agendador de jobs sob teste), e isso transforma o mesmo pior caso de 30 contextos em cerca de 90 conexões, em vez de 300, confortavelmente abaixo do `max_connections`. As correções alternativas são piores: aumentar o `max_connections` do Postgres só move o teto sem resolver o desperdício, e reduzir manualmente o número de configurações distintas de contexto entre algumas centenas de testes é uma refatoração muito maior para o mesmo resultado.

## Trade-offs

- **Carregar um contexto é mais pesado do que um teste unitário puro**: `SpringExtension` constrói um `ApplicationContext` real, então esses testes são testes de integração, mais lentos do que um teste unitário só com Mockito; o TestContext framework mitiga isso armazenando em cache e reutilizando o contexto entre classes de teste com a mesma configuração.
- **O cache troca classes de teste lentas por muitos pools de conexão vivos**: toda combinação distinta de `@Import`, `@MockitoBean` e `@SpringBootTest(properties = ...)` é uma nova entrada de cache com seu próprio `DataSource`; uma suíte grande pode manter contextos suficientes vivos ao mesmo tempo para esgotar o `max_connections` do banco de dados, surgindo como `FATAL: sorry, too many clients already` em uma classe de teste posterior e sem relação (veja "Cache de contexto e esgotamento de pool de conexões" acima).
- **Uma suposição de um-bean-por-tipo para autowiring de campo**: `@Autowired` por tipo falha quando existem dois beans desse tipo:

```java
@Autowired
private Passenger passenger; // UnsatisfiedDependencyException if the context has 2 Passenger beans
```

- **Injeção por campo em testes é conveniente, mas não é o estilo recomendado para produção**: `@Autowired` em um campo se lê de forma limpa em um teste, mas o próprio Spring recomenda injeção por construtor para beans de aplicação (imutabilidade, construção standalone mais fácil); um teste pode usar qualquer uma das duas, mas espelhar injeção por campo em toda parte carrega o hábito para o código de produção, onde é desencorajado.
- **O contexto acopla o teste à configuração, não só ao código**: renomear um bean ou um recurso ausente em `@ContextConfiguration` faz o teste falhar no momento de carregamento do contexto, com um erro de conexão, em vez de uma falha de asserção, o que é um caminho de depuração diferente de um teste unitário puro.

## Documentation Links

- [Spring TestContext Framework: documentação do Spring Framework](https://docs.spring.io/spring-framework/reference/testing/testcontext-framework.html) (doc)
- [`@SpringJUnitConfig` / SpringExtension: anotações de teste do Spring](https://docs.spring.io/spring-framework/reference/testing/annotations/integration-junit-jupiter.html) (doc)
- [Cache de Contexto: documentação de teste do Spring Framework](https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/ctx-management/caching.html) (doc)
- [Referência de configuração do HikariCP (`maximum-pool-size`, `minimum-idle`)](https://github.com/brettwooldridge/HikariCP#gear-configuration-knobs-baby) (doc)
- [JUnit in Action, 3rd Ed., Cap. 16, "Testing Spring applications," pp. 311-336 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) (doc)
