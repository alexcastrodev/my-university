---
version: 1.0
updatedAt: 2026-08-04
title: Escrevendo Controllers RESTful com Spring MVC
---
## Objective

Uma API REST é, mecanicamente, apenas um conjunto de métodos de controller do
Spring MVC cujos valores de retorno são escritos diretamente no corpo da
resposta HTTP, em vez de serem entregues a uma view para renderização.
`@RestController` e uma família correspondente de annotations de mapeamento
específicas por método HTTP
(`@GetMapping`/`@PostMapping`/`@PutMapping`/`@PatchMapping`/`@DeleteMapping`)
transformam o modelo de controller do Spring MVC já familiar — usado para
controllers que renderizam HTML — numa API JSON, com a mesma mecânica de
tratamento de request, menos a camada de view.

## Use Cases

- Expor um modelo de domínio existente (apoiado por um repositório Spring
  Data) como uma API JSON para um frontend separado — uma single-page app, um
  client mobile, ou qualquer consumidor que não seja uma página HTML
  renderizada no servidor.
- Retornar um código de status HTTP específico e significativo
  (`201 Created`, `404 Not Found`, `204 No Content`) em vez de sempre responder
  `200 OK` independentemente do que realmente aconteceu.
- Distinguir uma substituição completa de recurso (PUT) de uma atualização
  parcial (PATCH) no nível da API, para que clients não precisem reenviar
  todos os campos só para mudar um.
- Permitir que um frontend hospedado separadamente (um host/porta diferente
  durante o desenvolvimento, ou uma origin diferente em produção) realmente
  chame a API apesar da política de mesma origem do browser.

## Deep Dive

### `@RestController`: pule a view, escreva o corpo da resposta diretamente

```java
@RestController
@RequestMapping(path="/design", produces="application/json")
@CrossOrigin(origins="*")
public class DesignTacoController {

    private TacoRepository tacoRepo;

    public DesignTacoController(TacoRepository tacoRepo) {
        this.tacoRepo = tacoRepo;
    }

    @GetMapping("/recent")
    public Iterable<Taco> recentTacos() {
        PageRequest page = PageRequest.of(
                0, 12, Sort.by("createdAt").descending());
        return tacoRepo.findAll(page).getContent();
    }
}
```

`@RestController` faz duas coisas ao mesmo tempo: é uma annotation de
estereótipo (como `@Controller`/`@Service`) que torna a classe descobrível por
component scanning, e diz ao Spring que o valor de retorno de todo método
handler deve ser escrito diretamente no corpo da resposta em vez de passado a
uma view para renderização — o comportamento específico de REST que
`@ResponseBody` teria que ser adicionado a cada método individualmente. O
`@RequestMapping` em nível de classe com `produces="application/json"`
restringe todo handler deste controller a requests cujo header `Accept`
realmente peça JSON — o que também significa que um controller *diferente*
pode tratar o mesmo caminho para requests não-JSON (por exemplo, um controller
que renderiza HTML em outro lugar da aplicação) sem conflitar. `@CrossOrigin`
inscreve o controller em CORS, permitindo que um frontend hospedado numa
origin diferente (uma porta diferente durante o desenvolvimento, um domínio
diferente em produção) realmente o chame — sem isso, a política de mesma
origem do browser bloqueia o request antes mesmo dele chegar ao servidor.

### Lendo um único recurso, e retornando um 404 de verdade

```java
@GetMapping("/{id}")
public Taco tacoById(@PathVariable("id") Long id) {
    Optional<Taco> optTaco = tacoRepo.findById(id);
    if (optTaco.isPresent()) {
        return optTaco.get();
    }
    return null;
}
```

`@PathVariable` liga o placeholder `{id}` no caminho ao parâmetro do método.
Retornar `null` quando o ID não corresponde a nada tecnicamente funciona, mas
o client recebe um corpo vazio com um `200 OK` — uma resposta que parece bem
sucedida mas não carrega nada utilizável. Envolver o resultado num
`ResponseEntity` resolve isso:

```java
@GetMapping("/{id}")
public ResponseEntity<Taco> tacoById(@PathVariable("id") Long id) {
    Optional<Taco> optTaco = tacoRepo.findById(id);
    if (optTaco.isPresent()) {
        return new ResponseEntity<>(optTaco.get(), HttpStatus.OK);
    }
    return new ResponseEntity<>(null, HttpStatus.NOT_FOUND);
}
```

`ResponseEntity<T>` carrega o código de status junto com o corpo, então um
recurso ausente agora é reportado como `404 Not Found` em vez de uma resposta
vazia enganosamente bem sucedida.

### Escrevendo dados: @PostMapping e @RequestBody

```java
@PostMapping(consumes="application/json")
@ResponseStatus(HttpStatus.CREATED)
public Taco postTaco(@RequestBody Taco taco) {
    return tacoRepo.save(taco);
}
```

`consumes` é a contraparte de entrada de `produces` — este método só trata
requests cujo `Content-Type` seja `application/json`. `@RequestBody` diz ao
Spring MVC para desserializar o corpo JSON do request num objeto `Taco`; sem
isso, o Spring MVC tentaria em vez disso vincular parâmetros de query/form ao
objeto, o que não é o que uma API JSON quer. `@ResponseStatus(HttpStatus.CREATED)`
sobrescreve o `200 OK` padrão com o mais descritivo `201 Created`, informando
ao client que um novo recurso agora existe como resultado do request.

### PUT vs. PATCH: substituir vs. mesclar, e por que a annotation sozinha não decide

`@PutMapping` e `@PatchMapping` parecem ambos mapeamentos de "atualização",
mas os dois métodos HTTP carregam semânticas genuinamente diferentes que a
própria annotation não faz nada para impor — a lógica do próprio método
handler precisa realmente honrar a distinção:

```java
// PUT: semantically a wholesale replacement — omitted fields become null
@PutMapping("/{orderId}")
public Order putOrder(@RequestBody Order order) {
    return repo.save(order);
}
```

```java
// PATCH: a partial update — only non-null incoming fields are applied
@PatchMapping(path="/{orderId}", consumes="application/json")
public Order patchOrder(@PathVariable("orderId") Long orderId,
                        @RequestBody Order patch) {

    Order order = repo.findById(orderId).get();
    if (patch.getDeliveryName() != null) {
        order.setDeliveryName(patch.getDeliveryName());
    }
    if (patch.getDeliveryStreet() != null) {
        order.setDeliveryStreet(patch.getDeliveryStreet());
    }
    // ...one null-check per field...
    return repo.save(order);
}
```

`putOrder()` salva o que quer que o client tenha enviado, por completo —
qualquer campo que o client omita é sobrescrito com `null`, exatamente o que a
semântica "coloque estes dados nesta URL" do PUT pede. `patchOrder()` faz o
oposto: carrega o pedido existente e só sobrescreve os campos que o objeto
`patch` recebido realmente definiu, deixando o resto intocado. As annotations
de mapeamento do Spring MVC só declaram *a qual método HTTP* um handler
responde — elas não dizem nada sobre *como* a atualização deve se comportar,
então a semântica de atualização parcial do PATCH tem que ser escrita à mão no
corpo do método toda vez.

### Excluindo um recurso

```java
@DeleteMapping("/{orderId}")
@ResponseStatus(code=HttpStatus.NO_CONTENT)
public void deleteOrder(@PathVariable("orderId") Long orderId) {
    try {
        repo.deleteById(orderId);
    } catch (EmptyResultDataAccessException e) {}
}
```

`@DeleteMapping` trata requests `DELETE` da mesma forma que as outras
annotations tratam seus respectivos métodos. `@ResponseStatus(NO_CONTENT)`
define a resposta como `204 No Content` — apropriado aqui porque não sobra
nenhum recurso para descrever no corpo depois que ele é excluído. Capturar (e
ignorar) `EmptyResultDataAccessException` trata "excluir algo que já sumiu" da
mesma forma que "excluir algo que existia" — o estado final (o recurso não
existe) é idêntico nos dois casos, então o método não distingue os dois.

## Trade-offs

- **`@RestController` economiza um `@ResponseBody` em cada método, mas só
  porque compromete a classe *inteira* a escrever corpos de resposta
  diretamente.** Um controller que precisa misturar endpoints JSON com um
  endpoint que renderiza view tem que ou se dividir em duas classes ou recorrer
  a `@Controller` mais `@ResponseBody` nos métodos que retornam JSON
  individualmente — `@RestController` é uma escolha tudo-ou-nada por classe.
- **Retornar `null` de um método handler é fácil de escrever e fácil de errar.**
  Compila, roda, e a resposta parece superficialmente ok — `200 OK` com um
  corpo vazio — até que um client tente usar esse corpo e não encontre nada
  lá. Envolver o resultado em `ResponseEntity` custa um pouco mais de código
  mas torna o caso "não encontrado" uma parte honesta do tipo de retorno do
  método em vez de um caso extremo silencioso.
- **A diferença semântica entre PUT e PATCH é uma convenção que o
  desenvolvedor precisa implementar, não algo que o framework imponha.** Nada
  impede um handler `@PatchMapping` de fazer uma substituição completa em vez
  de uma mesclagem, ou um handler `@PutMapping` de fazer uma atualização
  parcial — as annotations só roteiam o request; acertar o comportamento real
  da atualização é responsabilidade do corpo do método. O próprio alerta do
  livro vale a pena manter em mente: não existe um padrão único para como
  deveria ser um payload de PATCH (um objeto de domínio parcial, como mostrado
  aqui, vs. um formato dedicado de instruções de patch) — é uma decisão de
  design por API, não algo que HTTP ou Spring MVC ditem.
- **Livro vs. hoje: o Spring Framework 6 (Spring Boot 3+) adicionou
  `ProblemDetail`, uma representação nativa RFC 7807 "Problem Details for HTTP
  APIs"** — dando a uma resposta de erro um corpo JSON estruturado e
  autodescritivo, em vez do `new ResponseEntity<>(null, HttpStatus.NOT_FOUND)`
  de corpo vazio do livro:
  ```java
  @GetMapping("/{id}")
  public ResponseEntity<?> tacoById(@PathVariable("id") Long id) {
      return tacoRepo.findById(id)
          .<ResponseEntity<?>>map(ResponseEntity::ok)
          .orElseGet(() -> {
              ProblemDetail pd = ProblemDetail.forStatusAndDetail(
                  HttpStatus.NOT_FOUND, "No taco with id " + id);
              return ResponseEntity.status(HttpStatus.NOT_FOUND).body(pd);
          });
  }
  ```
  Confirmado pela referência atual do Spring Framework: uma exception que
  implementa `ErrorResponse` (ou a já pronta `ErrorResponseException`) é
  renderizada automaticamente como `application/problem+json` pelo Spring
  MVC, o que a documentação oficial agora apresenta como a abordagem
  preferida em vez de construir manualmente um `ResponseEntity` vazio para
  casos de erro — o padrão do livro ainda funciona e retorna o código de
  status correto, só que retorna um status puro sem corpo explicativo, uma
  capacidade que não existia na versão do Spring 5/Spring Boot 2 do
  framework.

## Documentation Links

- Craig Walls, "Spring in Action", 5th Edition (Manning, 2019) — Chapter 6, "Creating REST services", section 6.1, p. 138-149 — doc
- [Spring Framework Reference — Annotated Controllers (Mapping Requests)](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-requestmapping.html) — doc
- [Spring Framework Reference — Error Responses (ProblemDetail, RFC 7807)](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html) — doc
- [Spring Framework API — ProblemDetail](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/http/ProblemDetail.html) — doc
