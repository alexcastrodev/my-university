---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

`MockMvc` tests a Spring REST API at the web layer without starting a real HTTP server: it dispatches simulated requests straight into the Spring MVC `DispatcherServlet`, runs the matching controller, and lets you assert on the response status, content type, and JSON body. Because no socket is opened, these tests are fast and deterministic, yet they still exercise real routing, request mapping, and JSON serialization. The collaborators below the controller (services, repositories) are replaced with mocks so a failure points at the controller/serialization, not at the data layer.

## Use Cases

- Verifying a controller maps a route and HTTP verb to the right handler and returns the correct status code (`200`, `201`, `404`).
- Asserting the JSON shape a controller produces — field names, nested objects, array sizes — without a running server or a real client.
- Testing the request-body path of a `POST`/`PUT`: does the controller deserialize the payload and respond `201 Created` with the created resource?
- Testing error responses (a missing resource → `404`) driven by an `@ExceptionHandler`/`@ResponseStatus`.
- Getting fast web-layer feedback in CI where standing up the full application (or a real HTTP port) per test would be too slow.

## Deep Dive

### The controller under test

A plain `@RestController` exposing a couple of endpoints — the code MockMvc will drive:

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

### Wiring MockMvc and mocking the data layer

`@AutoConfigureMockMvc` builds and registers a `MockMvc` bean; the repository the controller depends on is replaced by a mock so the test isolates the web layer. **Note the mock annotation is `@MockitoBean`, not the book's `@MockBean`** (see the book-vs-today note below):

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

`mvc.perform(...)` returns a `ResultActions`; each `.andExpect(...)` applies a `ResultMatcher`. `status()`, `content()`, and `jsonPath()` are the static matchers from `MockMvcResultMatchers`.

### Asserting on the JSON body with jsonPath

`jsonPath` navigates the response body with a JSONPath expression, so you assert on individual fields rather than string-matching the whole payload:

```java
mvc.perform(get("/countries"))
   .andExpect(status().isOk())
   .andExpect(content().contentType(MediaType.APPLICATION_JSON))
   .andExpect(jsonPath("$", hasSize(3)))                 // array length
   .andExpect(jsonPath("$[0].codeName", is("US")));      // nested field
```

### Testing a POST with a request body

Serialize the payload to JSON, set the content type, and assert on the created resource and its `201` status:

```java
Passenger passenger = new Passenger("Peter Michelsen");
when(passengerRepository.save(any(Passenger.class))).thenReturn(passenger);

mvc.perform(post("/passengers")
        .content(new ObjectMapper().writeValueAsString(passenger))
        .contentType(MediaType.APPLICATION_JSON))
   .andExpect(status().isCreated())
   .andExpect(jsonPath("$.name", is("Peter Michelsen")));
```

### Book vs. today: `@WebMvcTest`, `@MockitoBean`, and exception handling

> **Load only the web layer.** The book uses full `@SpringBootTest` + `@AutoConfigureMockMvc`, which boots the entire context. For a controller test, the focused slice is `@WebMvcTest`, which loads only the MVC infrastructure and the target controller — much faster:

```java
@WebMvcTest(PassengerController.class)   // only the web layer + this controller
class PassengerControllerTest {
    @Autowired
    private MockMvc mvc;

    @MockitoBean
    private PassengerRepository passengerRepository;   // collaborators must be mocked
}
```

> **`@MockBean` is deprecated.** The book (Spring Boot 2.x) annotates the repository with `@MockBean`. Since Spring Boot 3.4 / Spring Framework 6.2, `@MockBean` and `@SpyBean` are deprecated in favor of `@MockitoBean` and `@MockitoSpyBean` (now in the framework itself) — that's why every snippet above uses `@MockitoBean`.

> **Exception assertions changed.** The book asserts `assertThrows(NestedServletException.class, () -> mvc.perform(get("/passengers/30")))`. `org.springframework.web.util.NestedServletException` is deprecated as of Spring 6.0 (standard `ServletException` nesting is used instead), and MockMvc no longer wraps a handler exception in it. Today you either assert the resolved HTTP status directly (with a proper `@ResponseStatus`/`@ExceptionHandler`) or expect the original exception:

```java
// book (Spring 5): wrapped
assertThrows(NestedServletException.class, () -> mvc.perform(get("/passengers/30")));
// today (Spring 6+): assert the mapped status, or the unwrapped exception
mvc.perform(get("/passengers/30")).andExpect(status().isNotFound());
```

## Trade-offs

- **MockMvc is not a real HTTP round trip** — it dispatches into the `DispatcherServlet` in-process, so it's fast but doesn't exercise the real network stack, servlet container, or a real client's (de)serialization; for a true end-to-end test use `@SpringBootTest(webEnvironment = RANDOM_PORT)` with `TestRestTemplate` or `WebTestClient`.
- **A slice must mock everything it doesn't load** — `@WebMvcTest` deliberately excludes services/repositories, so a forgotten `@MockitoBean` for a collaborator fails context startup:

```java
// @WebMvcTest(PassengerController.class) with no mock for PassengerRepository
// → controller can't be constructed → NoSuchBeanDefinitionException at startup
```

- **`jsonPath` assertions are stringly-typed** — the path is a string evaluated at runtime, so renaming a JSON field or restructuring the payload compiles fine and only fails when the test runs:

```java
.andExpect(jsonPath("$.name", is("Peter Michelsen"))) // silently wrong if the field becomes "fullName"
```

- **Full `@SpringBootTest` for a controller test is heavier than needed** — it boots the whole application (all auto-configuration, every bean) just to test one controller; the slice loads a fraction of that, so preferring `@WebMvcTest` keeps the web-layer suite fast.

## Documentation Links

- [Testing the Web Layer with MockMvc — Spring Boot reference](https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html#testing.spring-boot-applications.with-mock-environment) — doc
- [`@WebMvcTest` auto-configuration — Spring Boot reference](https://docs.spring.io/spring-boot/appendix/test-auto-configuration/index.html) — doc
- [`@MockitoBean` / `@MockitoSpyBean` (replaces `@MockBean`) — Spring Framework](https://docs.spring.io/spring-framework/reference/testing/annotations/integration-spring/annotation-mockitobean.html) — doc
- [MockMvc / `MockMvcResultMatchers` — Spring Framework testing](https://docs.spring.io/spring-framework/reference/testing/mockmvc.html) — doc
- [JUnit in Action, 3rd Ed. — Ch. 18, "Testing a REST API," pp. 359–372 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) — doc
