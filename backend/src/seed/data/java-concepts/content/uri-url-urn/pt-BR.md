---
version: 1.0
updatedAt: 2026-08-19
title: "URI, URL e URN"
summary: "URI é sintaxe pura, URL sabe também localizar e abrir um recurso, e URN nomeia um recurso sem dizer onde encontrá-lo — e desde o JDK 20 o JDK direciona a construção via URI.toURL() em vez dos construtores de URL, agora deprecados."
---
## Objective

"URI", "URL" e "URN" são usados como sinônimos na fala casual, mas o `java.net` os modela como coisas genuinamente diferentes, com garantias diferentes: um **URI** é sintaxe pura — uma string parseada segundo a RFC 3986, sem nenhuma promessa de que ela se refere a algo alcançável; uma **URL** é um URI que também sabe *como localizar* um recurso (esquema, host, porta, caminho) e consegue abrir uma conexão com ele; um **URN** é um URI que *nomeia* um recurso sem dizer onde encontrá-lo (`mailto:`, `urn:isbn:...`). `java.net.URI` e `java.net.URL` são classes separadas exatamente por esse motivo, e desde o JDK 20 o próprio JDK direciona você a construir um `URI` primeiro e convertê-lo para `URL` só no ponto em que você realmente precisa de um, em vez de construir uma `URL` diretamente.

## Use Cases

- Validar e normalizar um link fornecido pelo usuário (removendo segmentos `..`, resolvendo-o contra uma URL base) antes de tentar abrir qualquer conexão com ele.
- Construir uma URL a partir de uma base e uma referência relativa — links de paginação, cabeçalhos de redirecionamento `Location`, alvos de `<a href>` em HTML — via `resolve()`.
- Comparar ou deduplicar links que são textualmente diferentes mas apontam para o mesmo recurso, via `normalize()`.
- Representar um identificador não obtível por fetch — um ISBN, uma chave de banco de dados, um ID opaco interno — como um `URI` (`urn:isbn:0-486-27557-4`) sem que ele nunca seja confundido com algo em que você pode chamar `openStream()`.
- Migrar código que usa os construtores deprecados de `new URL(String)` sem mudar o comportamento.

## Deep Dive

### Os três termos, e qual classe modela qual

```java
URI uri = new URI("https://darwinsys.com/java/../openbsd/../index.html");
URI normalized = uri.normalize();
System.out.println(normalized);                 // https://darwinsys.com/index.html

URI base = new URI("https://darwinsys.com");
System.out.println(base.relativize(uri));        // index.html

URL url = normalized.toURL();                    // now a locator, ready to connect
```

Um `URI` só checa sintaxe — `new URI("bean:WonderBean")` funciona mesmo que nada chamado `bean` seja um esquema de rede real, porque URI não precisa saber como alcançar nada. Uma `URL` é mais estrita em um ponto específico e mais permissiva em outro: ela exige um handler de protocolo registrado para o seu esquema (então `new URL("bean:WonderBean")` lança `MalformedURLException`), mas historicamente seu parsing por esquema era inconsistente quanto ao que contava como sintaxe válida — o que é o motivo da depreciação descrita abaixo.

Um **URN** nem é uma classe Java distinta — é só um `URI` cujo esquema nomeia um recurso em vez de localizá-lo:

```java
URI mailto = new URI("mailto:someone@example.com");
URI isbn   = URI.create("urn:isbn:0-486-27557-4");
```

Nenhum dos dois pode ser aberto como stream — não existe `toURL()` para `mailto:` ou `urn:` sem um handler registrado, porque "como você buscaria isso" não é uma pergunta que um URN responde.

### normalize(), relativize(), resolve()

Essas três são as operações que de fato justificam manter `URI` e `URL` separados em vez de fazer tudo em uma única classe:

```java
URI base = URI.create("https://api.example.com/v1/");

base.resolve("orders/42");        // https://api.example.com/v1/orders/42
base.resolve("/v2/orders/42");    // https://api.example.com/v2/orders/42  (absolute path wins)
base.relativize(
    URI.create("https://api.example.com/v1/orders/42"));   // orders/42
```

`resolve` é o que transforma um link relativo de uma página HTML ou de um cabeçalho `Location` em um absoluto contra a própria URL da página; `relativize` é o inverso, útil para imprimir links relativos mais curtos quando você já sabe a base da qual todo leitor está partindo. `normalize` só reescreve segmentos `.`/`..` — não segue redirecionamentos, não checa alcançabilidade, nem busca nada; é manipulação pura de string sobre os componentes já parseados.

### Por que `new URL(String)` está deprecado (desde o JDK 20)

```java
URL url = new URL("https://example.com/page");   // deprecated since Java 20
```

Os construtores públicos de `URL` foram deprecados porque sua checagem de sintaxe variava por esquema e, em alguns pontos, era inconsistente com a RFC — uma string que deveria ter sido rejeitada às vezes não era, dependendo de qual handler estivesse instalado. O parsing de `URI` é uma checagem de sintaxe RFC 3986 uniforme, independente do esquema, então o caminho de construção recomendado agora é primeiro URI:

```java
URL url = URI.create("https://example.com/page").toURL();

// or, for anything with a userinfo/host/port worth validating explicitly:
URI uri = new URI("https://example.com/page");
uri.parseServerAuthority();     // throws URISyntaxException if the authority isn't well-formed
URL strict = uri.toURL();
```

`URI.create(String)` lança a `IllegalArgumentException` não verificada em entradas malformadas (útil para literais que você sabe que são válidos); o construtor `URI(String)` lança a `URISyntaxException` verificada (útil quando a string vem de fora do seu programa e uma malformada é um caso esperado e recuperável).

### Abrindo a conexão

Só uma `URL` — nunca um `URI` — consegue de fato buscar alguma coisa:

```java
URL url = URI.create("https://darwinsys.com").toURL();
try (InputStream in = url.openStream()) {
    // read the resource
}
```

Para qualquer coisa além de um GET-e-leia-o-corpo — cabeçalhos, corpos de POST, timeouts, HTTP/2 — use `HttpClient` em vez de `URLConnection`; `openStream()` continua útil exatamente para o caso "só buscar esses bytes".

## Trade-offs

- **Um `URI` que faz parse com sucesso não é um `URI` que se refere a algo real.** `new URI("https://this-domain-does-not-exist.invalid/")` funciona — validação de sintaxe e alcançabilidade são duas questões inteiramente diferentes, e só `toURL()` mais uma tentativa de conexão de verdade responde a segunda.
- **`normalize()` é puramente sintático.** Ele remove segmentos `..` e `.` textualmente; não tem noção de quais segmentos são significativos para o servidor (um `..` além da raiz, ou um servidor que trata parâmetros de query como significativos para identidade) e não pode substituir uma política de URL canônica do lado do servidor.
- **Os construtores deprecados de `URL` ainda funcionam — estão deprecados, não removidos** — código existente compila hoje com um aviso, não um erro, então não há um forçador de migração além do próprio aviso; um código-base que nunca olha os warnings do compilador carrega a forma deprecada indefinidamente.
- **URN como conceito praticamente não tem comportamento em runtime no `java.net`.** Não existe classe `URN` nem mecanismo de resolução dedicado — tratar algo como URN é puramente uma escolha de modelagem sobre o que a string *significa*, garantida por convenção (nunca chamar `toURL()` nela), não pelo sistema de tipos.

## Documentation Links

- [URI — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/URI.html) — doc
- [URL — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/URL.html) — doc
- [RFC 3986: Uniform Resource Identifier (URI): Generic Syntax — IETF](https://datatracker.ietf.org/doc/html/rfc3986) — doc
- [JDK-8296385: Release Note — java.net.URL Constructors Are Deprecated](https://bugs.openjdk.org/browse/JDK-8296385) — doc
- [Quality Outreach Heads-up — JDK 20: Deprecate URL Public Constructors — Inside.java](https://inside.java/2023/02/15/quality-heads-up/) — doc
