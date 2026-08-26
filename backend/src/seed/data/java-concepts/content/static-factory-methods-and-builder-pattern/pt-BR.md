---
version: 1.0
updatedAt: 2026-08-13
title: Métodos de Fábrica Estáticos e o Padrão Builder
summary: Métodos estáticos nomeados podem substituir ou complementar construtores para criar objetos de forma mais clara, cacheável e flexível quanto a subtipos, e o padrão Builder domina classes com muitos campos opcionais.
---
## Objective

Um método de fábrica estático é simplesmente um método `static` de uma classe que retorna uma instância dessa classe — uma alternativa (ou complemento) a um construtor público. Por ser um método nomeado em vez de `new ClassName(...)`, ele pode comunicar o que o objeto retornado *é*, decidir se vai construir um novo objeto ou não, e devolver qualquer subtipo do seu tipo de retorno declarado. O padrão Builder resolve um problema diferente, mas relacionado: construir um objeto imutável que tem vários campos opcionais, sem recorrer a uma parede de construtores sobrecarregados ou a uma dança de setters mutáveis em várias etapas. Ambos são formas de controlar a construção de objetos de maneira mais deliberada do que um construtor público comum permite.

## Use Cases

- Dar um nome a uma operação parecida com um construtor, documentando a intenção — `BigInteger.probablePrime(bitLength, random)` diz muito mais no local da chamada do que um construtor com os mesmos dois argumentos jamais conseguiria.
- Evitar alocação redundante para valores baratos de reutilizar — retornando uma instância compartilhada e cacheada em vez de um objeto novo a cada chamada.
- Expor uma API puramente através de uma interface ou tipo abstrato, mantendo cada classe de implementação concreta não pública, de forma que quem chama nunca possa depender de (ou precise saber) qual classe realmente está segurando.
- Construir um objeto imutável que tem alguns campos obrigatórios e muitos opcionais — um objeto de configuração, um payload de requisição, um evento de domínio — sem uma pilha telescópica de sobrecargas de construtor.
- Construir vários objetos intimamente relacionados a partir de uma única instância de builder reutilizável e ajustável, em vez de repetir a mesma lista longa de argumentos para cada um.

## Deep Dive

### Fábricas estáticas vs. construtores: nomeadas, às vezes cacheadas, livres para retornar um subtipo

```java
Boolean b1 = Boolean.valueOf(true);   // static factory
Boolean b2 = new Boolean(true);       // constructor — deprecated since Java 9

b1 == Boolean.TRUE;   // true — valueOf(true) never allocates, it hands back the cached constant
```

`Boolean(boolean)` é deprecated justamente porque `valueOf(boolean)` faz o mesmo trabalho com melhor desempenho de espaço e tempo: ele retorna uma de duas constantes pré-alocadas (`Boolean.TRUE` / `Boolean.FALSE`) em vez de criar um novo objeto a cada chamada. Um construtor nunca pode fazer isso — `new` sempre produz uma nova instância.

Essa mesma liberdade permite que uma fábrica estática retorne um tipo que sua própria classe não revela:

```java
List<String> names = List.of("Ana", "Bo", "Cy");
```

`List.of(...)` não retorna um `ArrayList` — ele retorna uma entre várias classes package-private internamente, escolhida com base em quantos elementos foram passados. Quem chama só vê `List`, então o JDK é livre para mudar qual classe concreta atende a uma chamada de `List.of(...)` entre releases sem quebrar ninguém; ninguém poderia ter codificado contra uma classe que nunca lhe foi entregue. O `EnumSet` leva essa mesma ideia adiante: ele não tem nenhum construtor público (toda instância vem de `noneOf`, `allOf`, `of`, `range` ou `copyOf`), e seu tipo declarado é `public abstract sealed class EnumSet<E>` — as duas implementações por trás dele são subclasses permitidas e não públicas, não algo que quem chama possa instanciar com `new` ou estender.

### Convenções de nomenclatura

Fábricas estáticas não têm a resolução de sobrecarga guiada por parâmetros que construtores da mesma classe têm à disposição, então um punhado de convenções de nomenclatura carrega o significado que o "isto cria um `Foo`" implícito de um construtor forneceria de outra forma:

```java
Optional<String> opt = Optional.of("value");           // of — wraps a value as-is
Integer n = Integer.valueOf("42");                       // valueOf — converts from another representation
BufferedReader r = Files.newBufferedReader(path);        // newType — a new instance, factory lives in a different class
var dbf = DocumentBuilderFactory.newInstance();           // newInstance — each call is a distinct object
```

- **`valueOf`** — retorna uma instância com (aproximadamente) o mesmo valor de seu argumento; efetivamente uma conversão de tipo.
- **`of`** — um `valueOf` mais conciso, a convenção usada em todo o `java.util` (`List.of`, `Set.of`, `Map.of`) e `java.time`.
- **`getInstance` / `newInstance`** — `getInstance` pode retornar a mesma instância em várias chamadas (como uma chamada sem argumentos frequentemente faz para um objeto do tipo singleton); `newInstance` promete que cada instância retornada é distinta de todas as outras.
- **`getType` / `newType`** — como os dois anteriores, usados quando o método de fábrica vive em uma classe diferente do tipo que ele retorna, de forma que um simples `getInstance` seria ambíguo sobre o que volta.

Nada disso é imposto pelo compilador — são convenções de legibilidade, e a única coisa que realmente marca um método como fábrica estática é `static` mais um tipo de retorno igual (ou relacionado) à sua classe declarante.

### O padrão Builder: domando muitos parâmetros opcionais

Uma classe com poucos campos obrigatórios e muitos opcionais é desajeitada de construir de qualquer jeito: uma sobrecarga de construtor por combinação de parâmetros opcionais ("construtores telescópicos") é ilegível no local da chamada, e um construtor sem argumentos mais setters permite que o objeto exista parcialmente configurado e descarta a imutabilidade.

```java
// Telescoping constructors — every new optional field means another overload,
// and a call site like this is unreadable without checking the signature:
new EmailMessage("team@example.com", "Deploy done", "", List.of(), List.of(), "ops@example.com", true);
// which of those two booleans-shaped trailing args means what?
```

Um builder substitui os dois: o cliente passa os campos obrigatórios de antemão, encadeia métodos parecidos com setters para os campos opcionais que lhe interessam, e finaliza com uma chamada a `build()` que produz um resultado imutável.

```java
public record EmailMessage(
        String to, String subject, String body,
        List<String> cc, List<String> bcc, String replyTo, boolean highPriority) {

    public static final class Builder {
        private final String to;
        private final String subject;
        private String body = "";
        private List<String> cc = List.of();
        private List<String> bcc = List.of();
        private String replyTo;
        private boolean highPriority;

        public Builder(String to, String subject) {
            this.to = to;
            this.subject = subject;
        }

        public Builder body(String body)          { this.body = body; return this; }
        public Builder cc(List<String> cc)        { this.cc = cc; return this; }
        public Builder bcc(List<String> bcc)      { this.bcc = bcc; return this; }
        public Builder replyTo(String replyTo)    { this.replyTo = replyTo; return this; }
        public Builder highPriority()             { this.highPriority = true; return this; }

        public EmailMessage build() {
            if (to == null || to.isBlank()) {
                throw new IllegalStateException("recipient is required");
            }
            return new EmailMessage(to, subject, body, cc, bcc, replyTo, highPriority);
        }
    }
}
```

```java
var message = new EmailMessage.Builder("team@example.com", "Deploy done")
        .body("Release 4.2 is live.")
        .cc(List.of("alerts@example.com"))
        .highPriority()
        .build();
```

Cada método parecido com setter retorna `this`, o que é o que torna as chamadas encadeáveis — isso às vezes é chamado de API fluente. O builder em si é mutável enquanto está sendo configurado, mas `build()` é o único ponto onde os campos são copiados para o `EmailMessage` imutável, e é o lugar natural para impor invariantes que abrangem múltiplos campos, já que nesse momento todo valor opcional que quem chama quis definir já foi fornecido.

## Trade-offs

- **Uma fábrica estática não se destaca na documentação de API gerada da forma que um construtor se destaca.** O Javadoc lista construtores em sua própria seção; uma fábrica estática é só mais um método, então uma classe que só oferece fábricas estáticas (sem construtor público) pode ser mais difícil de descobrir como instanciar sem ler a documentação a nível de classe ou conhecer as convenções de nomenclatura acima.
- **Uma classe que expõe apenas fábricas estáticas (sem construtor público ou protegido) não pode ser estendida de fora do seu próprio pacote.** Isso costuma ser intencional — força composição em vez de herança — mas é fácil tropeçar nisso.
  ```java
  // EnumSet has no public constructor and is itself sealed —
  // this does not compile no matter what package it's written in:
  // class MyEnumSet<E extends Enum<E>> extends EnumSet<E> { }
  ```
- **O padrão Builder custa um objeto extra e mais código do que uma chamada de construtor.** Para uma classe com apenas um ou dois campos, um construtor simples (ou um record compacto) é mais simples e barato — recorra a um builder quando os campos opcionais começarem a se acumular (uma regra prática aproximada: quatro ou mais, especialmente se a maioria das chamadas define apenas alguns deles).
- **As invariantes do Builder só são verificadas uma vez, em `build()`, não à medida que cada campo é definido.** Um campo pode ficar em um estado intermediário inválido enquanto o builder ainda está sendo configurado; só o objeto final tem consistência garantida.
  ```java
  new EmailMessage.Builder("", "Deploy done").build();
  // throws IllegalStateException: recipient is required — but only here, at build()
  ```
- **O construtor compacto de um record (veja `records-and-sealed-types`) é a alternativa mais enxuta quando há apenas alguns campos, majoritariamente obrigatórios** — ele valida em um só lugar sem a cerimônia de uma classe builder separada. Porém isso não ajuda quando vários campos são genuinamente opcionais: o construtor canônico de um record ainda recebe todo componente posicionalmente, então um record sozinho não resolve o problema telescópico que um builder resolve.

## Documentation Links

- [Boolean — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Boolean.html) — doc
- [List — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html) — doc
- [EnumSet — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumSet.html) — doc
- [BigInteger — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigInteger.html) — doc
- [Nested Classes — The Java Tutorials](https://docs.oracle.com/javase/tutorial/java/javaOO/nested.html) — doc
