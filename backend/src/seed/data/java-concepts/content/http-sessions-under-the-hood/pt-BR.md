---
version: 1.0
updatedAt: 2026-08-05
title: Sessões HTTP por Baixo dos Panos
summary: Como o estado de sessão é simulado sobre um HTTP sem estado — um ID de sessão aleatório, um round trip Set-Cookie/Cookie e um map do lado servidor indexado por esse ID — além do que falta na versão mínima (expiração, invalidação, armazenamento externalizado) e os atributos de segurança de cookie atuais (Secure, SameSite).
---
## Objective

HTTP é sem estado por design — cada requisição é independente, sem memória embutida da requisição anterior. "Sessão" é a camada construída por cima para simular ter estado: o servidor entrega ao cliente um identificador opaco via cookie, o cliente devolve esse identificador em toda requisição subsequente, e o servidor o usa como chave para um armazenamento do lado servidor com dados por usuário. `HttpSession` em um container de servlet, o Spring Session, e todo app web "logado" implementam essa mesma ideia — um ID aleatório, um header `Set-Cookie`, e um map do lado servidor indexado por esse ID.

## Use Cases

- Entender no que uma chamada `getSession()`/`req.session` de um framework realmente se apoia, antes de recorrer a um armazenamento de sessão distribuído (sessões apoiadas em Redis) em um deployment com múltiplas instâncias.
- Depurar "usuário foi deslogado sem motivo" — muitas vezes é uma remoção do armazenamento de sessão, um cookie que não está sendo enviado (`Secure` ausente sobre HTTP, `SameSite` bloqueando uma requisição cross-site), ou duas instâncias de servidor que não compartilham estado de sessão.
- Reconhecer por que os dados de sessão somem ao reiniciar o servidor nas implementações mais simples — um map em memória não tem persistência a menos que ela seja adicionada explicitamente.
- Decidir entre estado baseado em sessão e uma alternativa sem estado (JWT/tokens assinados) — uma escolha arquitetural real, não só um detalhe de implementação.

## Deep Dive

### O mecanismo central: ID + cookie + map do lado servidor

```java
public class SessionManager {
    private static final Map<String, Map<String, Object>> sessions = new ConcurrentHashMap<>();

    public static String getOrCreateSessionId(Request req, Response res) {
        String sessionId = req.getCookies().get("SESSION_ID");

        if (sessionId == null || !sessions.containsKey(sessionId)) {
            sessionId = UUID.randomUUID().toString();
            sessions.put(sessionId, new ConcurrentHashMap<>());
            res.addHeader("Set-Cookie", "SESSION_ID=" + sessionId + "; Path=/; HttpOnly");
        }
        return sessionId;
    }

    public static Map<String, Object> getSession(String sessionId) {
        return sessions.get(sessionId);
    }
}
```

Três peças móveis: um **ID de sessão** gerado com uma fonte aleatória criptograficamente forte (`UUID.randomUUID()` aqui — o ID precisa ser inadivinhável, já que qualquer um que o tenha pode se passar por aquela sessão), um **cookie** carregando esse ID de ida e volta (`Set-Cookie` na saída, o header `Cookie` na volta) e um **armazenamento do lado servidor** (`ConcurrentHashMap` — a thread safety importa porque requisições concorrentes para sessões diferentes, ou até para a mesma sessão, podem atingir o map simultaneamente) mapeando o ID para dados arbitrários por usuário.

### Lendo e escrevendo dados de sessão

```java
// In a request handler:
String sessionId = SessionManager.getOrCreateSessionId(req, res);
Map<String, Object> session = SessionManager.getSession(sessionId);
session.put("lastVisit", LocalDateTime.now());

// Reading it back on a later request:
LocalDateTime last = (LocalDateTime) session.get("lastVisit");
res.write("Your last visit was: " + last);
```

Como o armazenamento é um `Map<String, Object>` genérico, ele pode guardar o que a aplicação precisar — strings, objetos de domínio, listas — sem esquema. Essa flexibilidade também é o maior ponto fraco desse armazenamento: nada impede guardar algo grande ou não serializável, o que passa a importar assim que as sessões precisam sobreviver a um restart ou ser compartilhadas entre instâncias.

### O que ainda falta nessa versão mínima

Um mecanismo de sessão em produção construído sobre essa mesma ideia central normalmente adiciona: **expiração** (um time-to-live por sessão, com uma varredura em segundo plano ou remoção preguiçosa no acesso), **invalidação** (um logout explícito removendo a entrada) e **armazenamento externalizado** (Redis, um banco de dados ou um cache distribuído em vez de um `Map` em memória — necessário assim que existe mais de uma instância de servidor, já que um map em memória só é visível ao processo que o criou).

## Trade-offs

- **Um armazenamento de sessão em memória não sobrevive a um restart, e não escala além de uma instância** — o `ConcurrentHashMap` aqui vive no heap de uma única JVM; ao implantar uma segunda instância atrás de um load balancer, uma requisição roteada para a instância B não sabe nada sobre uma sessão criada na instância A, a menos que as sessões sejam feitas "sticky" (roteadas de forma consistente para a mesma instância) ou o armazenamento seja externalizado.
- **Um ID de sessão é uma credencial portadora (bearer credential)** — qualquer um que tenha a string exata do cookie `SESSION_ID` pode agir como aquele usuário, sem precisar de senha, enquanto a sessão durar; é exatamente por isso que o ID precisa vir de uma fonte aleatória forte (`UUID.randomUUID()`, não um contador ou timestamp) e por que o roubo de cookie (via XSS, sniffing de rede, ou uma linha de log vazada) equivale ao roubo de credencial.
```java
String weakId = String.valueOf(sessionCounter++);   // guessable — never do this
String strongId = UUID.randomUUID().toString();      // cryptographically strong
```
- **Sessões vs. tokens sem estado (JWT) é uma escolha arquitetural real, não uma preferência de estilo** — uma sessão mantém o estado no servidor (fácil de invalidar imediatamente removendo a entrada, mas exige um armazenamento compartilhado/sticky entre instâncias); um token assinado mantém o estado no cliente (trivialmente escalável horizontalmente, sem precisar de armazenamento do lado servidor, mas não pode ser revogado antes de sua expiração sem um mecanismo extra de denylist). Nenhum dos dois é estritamente melhor — a escolha depende de o que importa mais para um dado sistema: revogação instantânea ou escalabilidade sem estado.
- **Livro vs. hoje: o cookie do exemplo está sem dois atributos que a orientação atual trata como obrigatórios para um cookie de sessão, não opcionais.** `Set-Cookie: SESSION_ID=...; Path=/; HttpOnly` define `HttpOnly` (corretamente — ele bloqueia o JavaScript de ler o cookie, mitigando o roubo de sessão via XSS) mas omite `Secure` (que impede o cookie de ser enviado por HTTP puro, mitigando interceptação em nível de rede) e `SameSite` (que controla se o cookie é enviado em requisições cross-site, mitigando CSRF — `Strict` é a recomendação atual especificamente para um cookie de autenticação). Um cookie de sessão escrito hoje deveria se parecer mais com `SESSION_ID=...; Path=/; HttpOnly; Secure; SameSite=Strict`.

## Lab

Neste lab você recebe a classe `SessionStore` com os métodos vazios e constrói à mão o que um container de servlets faz por baixo de `HttpSession`: gerar um id, guardar atributos no servidor, acompanhar a atividade para decidir expiração e, no desafio, devolver o id ao cliente por um `Set-Cookie`. A ideia central é que uma sessão é só contabilidade em memória, e que lógica de expiração fica testável quando o tempo entra como parâmetro.

**O cenário**

Uma tabela em memória guarda sessões, cada uma com um id, um conjunto de atributos e o instante do último acesso. Não há container nem HTTP, só a contabilidade por baixo.

- `SessionStore.java`: a única classe. Ela tem uma classe interna `Session` (atributos e `lastAccessed`) e um mapa de id para sessão. Todos os métodos sensíveis ao tempo recebem um `Instant` em vez de chamar `Instant.now()`.

Essa decisão é deliberada: lógica de expiração que lê o relógio do sistema só se testa esperando. Passando o "agora" como parâmetro, os testes usam instantes fixos e nenhum `Thread.sleep()`. Outra regra que vale notar: um id desconhecido sempre lança `NoSuchElementException`.

**O que você vai fazer, passo a passo**

1. **Criar a sessão (TODO-00).** Em `createSession()`, gere um id único (`UUID.randomUUID().toString()` serve), guarde uma `Session` nova com `now` como último acesso e devolva o id.
2. **Registrar atividade (TODO-01).** Em `touch()`, mova o último acesso da sessão para `now`. Só `touch()` e `createSession()` contam como atividade, de propósito.
3. **Ler e escrever atributos (TODO-02 e TODO-03).** `put()` guarda o valor sob a chave, sem mexer no último acesso. `get()` devolve o valor ou `null` se a chave nunca foi guardada. Nos dois, id desconhecido lança `NoSuchElementException(sessionId)`.
4. **Decidir a expiração (TODO-04).** Em `isExpired()`, devolva `true` quando o tempo entre o último acesso e `now` for MAIOR que `timeout`. Pense no caso de borda: exatamente igual ao timeout ainda não expirou.

**Como saber que terminou**

`mvn test` fica todo verde. Você deve conseguir explicar por que passar o `Instant` como parâmetro dispensa `Thread.sleep()` nos testes e por que `put()` não renova a sessão.

**Desafios opcionais**

- **TODO-05:** implemente `setCookieHeader()`, devolvendo o valor do cabeçalho `Set-Cookie` no formato `JSESSIONID=<id>; Path=/; HttpOnly` (sem o prefixo `Set-Cookie: `), com `NoSuchElementException` para id desconhecido.

**Pré-requisitos:** sintaxe básica de Java, `java.time.Instant` e `java.time.Duration`, e familiaridade com `Map`.

**Como rodar:** clone o repositório, entre em `java-concepts/http-sessions-under-the-hood` e rode `mvn test` (ou, da raiz, `mvn -pl java-concepts/http-sessions-under-the-hood test`). Os métodos pendentes lançam `UnsupportedOperationException("Not implemented yet.")` com um comentário `TODO-NN`, então os testes vermelhos são o seu checklist.

## Documentation Links

- [MDN — Using HTTP cookies (attributes, security considerations)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies) — doc
- [UUID.randomUUID() — java.util API docs (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/UUID.html#randomUUID()) — doc
- [ConcurrentHashMap — java.util.concurrent API docs (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html) — doc
- [RFC 6265 — HTTP State Management Mechanism (cookies)](https://www.rfc-editor.org/rfc/rfc6265) — doc
- [IETF draft-ietf-httpbis-rfc6265bis — Cookies: HTTP State Management Mechanism (SameSite, in-progress update to RFC 6265)](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis) — doc
