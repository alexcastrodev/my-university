---
version: 1.0
updatedAt: 2026-08-06
title: "Testando uma API REST com MockMvc"
summary: "Controlando um controller REST do Spring pelo MockMvc: requisições HTTP simuladas, asserções de status/content-type/jsonPath, e uma camada de dados mockada, com a fatia @WebMvcTest de hoje, o @MockitoBean (substituindo @MockBean), e a mudança do NestedServletException no Spring 6, do JUnit in Action, Third Edition, Cap. 18."
---
## Objective

O `MockMvc` testa uma API REST do Spring na camada web sem iniciar um servidor HTTP real: ele despacha requisições simuladas diretamente no `DispatcherServlet` do Spring MVC, roda o controller correspondente, e permite afirmar sobre o status da resposta, o content type e o corpo JSON. Como nenhum socket é aberto, esses testes são rápidos e determinísticos, mas ainda exercitam roteamento real, mapeamento de requisição e serialização JSON. Os colaboradores abaixo do controller (services, repositories) são substituídos por mocks, então uma falha aponta para o controller/serialização, não para a camada de dados.

## Use Cases

- Verificar que um controller mapeia uma rota e verbo HTTP para o handler certo e retorna o código de status correto (`200`, `201`, `404`).
- Afirmar sobre a forma do JSON que um controller produz (nomes de campo, objetos aninhados, tamanhos de array) sem um servidor rodando ou um cliente real.
- Testar o caminho de corpo de requisição de um `POST`/`PUT`: o controller desserializa o payload e responde `201 Created` com o recurso criado?
- Testar respostas de erro (um recurso ausente → `404`) conduzidas por um `@ExceptionHandler`/`@ResponseStatus`.
- Obter feedback rápido da camada web em CI, onde subir a aplicação completa (ou uma porta HTTP real) por teste seria lento demais.

## Deep Dive

### O controller sob teste

Um `@RestController` simples expondo alguns endpoints, o código que o MockMvc vai controlar:

```java
@RestController
public class PassengerController {
    private final PassengerRepository passengerRepository;

    public PassengerController(PassengerRepository passengerRepository) {
        this.passengerRepository = passengerRepository;
    }

    @GetMapping("/passengers")
    public List<Passenger> getAll() {
        return passengerRepository.findAll();
    }

    @PostMapping("/passengers")
    @ResponseStatus(HttpStatus.CREATED)
    public Passenger create(@RequestBody Passenger passenger) {
        return passengerRepository.save(passenger);
    }
}
```

### Configurando o MockMvc e mockando a camada de dados

`@AutoConfigureMockMvc` constrói e registra um bean `MockMvc`; o repository do qual o controller depende é substituído por um mock, então o teste isola a camada web. **Note que a anotação de mock é `@MockitoBean`, não o `@MockBean` do livro** (veja a nota de livro vs. hoje abaixo):

```java
@SpringBootTest
@AutoConfigureMockMvc
@Import(FlightBuilder.class)
public class RestApplicationTest {
    @Autowired
    private MockMvc mvc;                       // entry point for server-side REST tests

    @MockitoBean
    private PassengerRepository passengerRepository;   // data layer replaced by a mock

    @Test
    void testGetAllPassengers() throws Exception {
        when(passengerRepository.findAll()).thenReturn(List.of(new Passenger("John Smith")));

        mvc.perform(get("/passengers"))
           .andExpect(status().isOk())
           .andExpect(content().contentType(MediaType.APPLICATION_JSON))
           .andExpect(jsonPath("$", hasSize(1)));

        verify(passengerRepository, times(1)).findAll();
    }
}
```

`mvc.perform(...)` retorna um `ResultActions`; cada `.andExpect(...)` aplica um `ResultMatcher`. `status()`, `content()` e `jsonPath()` são os matchers estáticos de `MockMvcResultMatchers`.

### Afirmando sobre o corpo JSON com jsonPath

`jsonPath` navega o corpo da resposta com uma expressão JSONPath, então você afirma sobre campos individuais em vez de comparar a string do payload inteiro:

```java
mvc.perform(get("/countries"))
   .andExpect(status().isOk())
   .andExpect(content().contentType(MediaType.APPLICATION_JSON))
   .andExpect(jsonPath("$", hasSize(3)))                 // array length
   .andExpect(jsonPath("$[0].codeName", is("US")));      // nested field
```

### Testando um POST com corpo de requisição

Serialize o payload para JSON, defina o content type, e afirme sobre o recurso criado e seu status `201`:

```java
Passenger passenger = new Passenger("Peter Michelsen");
when(passengerRepository.save(any(Passenger.class))).thenReturn(passenger);

mvc.perform(post("/passengers")
        .content(new ObjectMapper().writeValueAsString(passenger))
        .contentType(MediaType.APPLICATION_JSON))
   .andExpect(status().isCreated())
   .andExpect(jsonPath("$.name", is("Peter Michelsen")));
```

### Livro vs. hoje: `@WebMvcTest`, `@MockitoBean` e tratamento de exceção

> **Carregue só a camada web.** O livro usa `@SpringBootTest` completo mais `@AutoConfigureMockMvc`, que inicializa o contexto inteiro. Para um teste de controller, a fatia focada é `@WebMvcTest`, que carrega só a infraestrutura MVC e o controller alvo, muito mais rápido:

```java
@WebMvcTest(PassengerController.class)   // only the web layer + this controller
class PassengerControllerTest {
    @Autowired
    private MockMvc mvc;

    @MockitoBean
    private PassengerRepository passengerRepository;   // collaborators must be mocked
}
```

> **`@MockBean` está obsoleto.** O livro (Spring Boot 2.x) anota o repository com `@MockBean`. Desde o Spring Boot 3.4 / Spring Framework 6.2, `@MockBean` e `@SpyBean` estão obsoletos em favor de `@MockitoBean` e `@MockitoSpyBean` (agora no próprio framework); é por isso que todo trecho acima usa `@MockitoBean`.

> **As asserções de exceção mudaram.** O livro afirma `assertThrows(NestedServletException.class, () -> mvc.perform(get("/passengers/30")))`. `org.springframework.web.util.NestedServletException` está obsoleta desde o Spring 6.0 (o aninhamento padrão de `ServletException` é usado em vez disso), e o MockMvc não envolve mais uma exceção de handler nela. Hoje você tanto afirma o status HTTP resolvido diretamente (com um `@ResponseStatus`/`@ExceptionHandler` adequado) quanto espera a exceção original:

```java
// book (Spring 5): wrapped
assertThrows(NestedServletException.class, () -> mvc.perform(get("/passengers/30")));
// today (Spring 6+): assert the mapped status, or the unwrapped exception
mvc.perform(get("/passengers/30")).andExpect(status().isNotFound());
```

## Trade-offs

- **O MockMvc não é uma ida e volta HTTP real**: ele despacha para dentro do `DispatcherServlet` em processo, então é rápido, mas não exercita a pilha de rede real, o container de servlet, ou a (des)serialização de um cliente real; para um teste verdadeiramente de ponta a ponta use `@SpringBootTest(webEnvironment = RANDOM_PORT)` com `TestRestTemplate` ou `WebTestClient`.
- **Uma fatia precisa mockar tudo o que não carrega**: `@WebMvcTest` exclui deliberadamente services/repositories, então um `@MockitoBean` esquecido para um colaborador falha a inicialização do contexto:

```java
// @WebMvcTest(PassengerController.class) with no mock for PassengerRepository
// → controller can't be constructed → NoSuchBeanDefinitionException at startup
```

- **Asserções `jsonPath` são tipadas por string**: o caminho é uma string avaliada em tempo de execução, então renomear um campo JSON ou reestruturar o payload compila sem problemas e só falha quando o teste roda:

```java
.andExpect(jsonPath("$.name", is("Peter Michelsen"))) // silently wrong if the field becomes "fullName"
```

- **`@SpringBootTest` completo para um teste de controller é mais pesado do que o necessário**: inicializa a aplicação inteira (toda a auto-configuração, cada bean) só para testar um controller; a fatia carrega uma fração disso, então preferir `@WebMvcTest` mantém a suíte da camada web rápida.

## Documentation Links

- [Testando a Camada Web com MockMvc: referência do Spring Boot](https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html#testing.spring-boot-applications.with-mock-environment) (doc)
- [Auto-configuração do `@WebMvcTest`: referência do Spring Boot](https://docs.spring.io/spring-boot/appendix/test-auto-configuration/index.html) (doc)
- [`@MockitoBean` / `@MockitoSpyBean` (substitui `@MockBean`): Spring Framework](https://docs.spring.io/spring-framework/reference/testing/annotations/integration-spring/annotation-mockitobean.html) (doc)
- [MockMvc / `MockMvcResultMatchers`: teste do Spring Framework](https://docs.spring.io/spring-framework/reference/testing/mockmvc.html) (doc)
- [JUnit in Action, 3rd Ed., Cap. 18, "Testing a REST API," pp. 359-372 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) (doc)
