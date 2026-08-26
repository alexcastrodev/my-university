---
version: 1.0
updatedAt: 2026-08-18
title: "Switch Expressions: yield, Rótulos com Arrow e Exaustividade"
summary: "O switch statement e a switch expression são duas construções que compartilham uma palavra-chave — a forma com dois-pontos cai através dos casos (fall-through) e não produz nada, enquanto uma expression em forma arrow executa exatamente um ramo, produz um valor via yield quando o ramo é um bloco, e precisa ser comprovadamente exaustiva ou o compilador a rejeita."
---
## Objective

Entenda que o `switch` **statement** clássico e a `switch` **expression** (JEP 361, finalizada no Java 14) são duas construções diferentes que por acaso compartilham a palavra-chave `switch`. O statement é em forma de dois-pontos (`case X:`), cai (fall-through) de um rótulo para o próximo a menos que um `break` o interrompa, e não produz valor nenhum. A expression produz um valor diretamente utilizável em uma atribuição, um `return`, ou uma posição de argumento — o que força duas propriedades que o statement nunca teve: todo caminho precisa produzir definitivamente um valor, então o compilador rejeita uma switch expression que não consiga provar **exaustiva**, e rótulos arrow (`case X ->`) executam exatamente um ramo, sem fall-through.

Esta é a base mecânica sobre a qual `pattern-matching` se constrói. Aquele conceito usa ramos `->` e exaustividade o tempo todo, mas sempre a serviço de type e record patterns sobre hierarquias seladas. Aqui não há patterns nenhum — só a canalização: ramos arrow, `yield`, rótulos com múltiplos valores, e onde a exaustividade é checada, sobre valores comuns de `enum`, `String` e `int`.

## Use Cases

- Atribuir uma variável ou retornar um valor a partir de um conjunto pequeno e fixo de casos (um `enum`, um punhado de constantes `int`/`String`) sem declarar um local mutável e reatribuí-lo em cada ramo de um switch statement.
- Remover bugs acidentais de fall-through de código que usava a forma de dois-pontos e dependia de um humano lembrar de `break` em cada ramo.
- Mapear vários valores para um único resultado em uma linha só — `case SATURDAY, SUNDAY -> "Weekend"` — em vez de empilhar rótulos `case` soltos que caem intencionalmente em um corpo compartilhado.
- Produzir um valor a partir de um ramo que precisa de mais de um statement, via `yield`.

## Deep Dive

### Forma de dois-pontos vs. forma arrow

A forma de dois-pontos é o `switch` statement original. O controle entra no rótulo correspondente e continua rodando até um `break` (ou o fim do bloco) o interromper — inclusive atravessando direto pelo *próximo* rótulo:

```java
static String size(int code) {
    String label = "";
    switch (code) {
        case 1:
            label = "small";   // no break: execution continues into case 2
        case 2:
            label = "medium";
            break;
        default:
            label = "large";
    }
    return label;
}

size(1); // "medium", not "small"
```

Esse é o bug clássico de fall-through: nada na linguagem sinaliza isso, e o resultado é silenciosamente errado. A forma arrow torna esse erro estruturalmente impossível — só o ramo correspondente roda, e não existe sintaxe para cair no próximo:

```java
static String size(int code) {
    return switch (code) {
        case 1  -> "small";
        case 2  -> "medium";
        default -> "large";
    };
}

size(1); // "small"
```

Duas coisas valem a pena separar. A forma arrow é uma escolha de *sintaxe*: `switch (x) { case 1 -> doThing(); }` ainda é um statement, só que não pode cair através dos casos. Ser uma *expression* é uma propriedade diferente — significa que o `switch` inteiro é avaliado para um valor, que é do que o `return switch (...)` acima depende. A forma de dois-pontos só pode ser um statement; a forma arrow pode ser qualquer um dos dois.

Fall-through não é puramente um risco, no entanto: é a única coisa que a forma de dois-pontos consegue expressar e a forma arrow não consegue. Deixar deliberadamente o código de um caso cair no seguinte — acumulando trabalho entre rótulos — não tem equivalente em forma arrow, e esse é o risco de migração coberto em Trade-offs.

### yield: produzindo um valor a partir de um ramo com corpo em bloco

`case X -> expr` tem um valor óbvio: `expr`. Um bloco não tem esse valor implícito, então um ramo escrito como `case X -> { ... }` dentro de uma switch *expression* precisa devolver um valor explicitamente com `yield`:

```java
static int score(String grade) {
    return switch (grade) {
        case "A" -> 4;                       // single expression: its value is the arm's value
        case "B" -> {                        // block: needs an explicit yield
            System.out.println("logging a B");
            int base = 3;
            yield base;
        }
        default -> 0;
    };
}
```

Os ramos `"A"` e `"B"` produzem valores da mesma forma do ponto de vista de quem chama; só o ramo `"B"` precisa de `yield`, porque é um bloco. `yield` é obrigatório em um ramo em bloco de uma switch expression e não tem sentido em um switch statement (nada está sendo produzido ali).

`yield` é uma palavra-chave *contextual*, não uma palavra reservada, então código antigo que a usava como nome continua compilando:

```java
static int yield = 5;
static int yield() { return 7; }

System.out.println(yield);        // fine: field named yield
System.out.println(Foo.yield());  // fine, but the call must be qualified
```

Só um ponto estreito quebrou: uma chamada *não qualificada* `yield()` é rejeitada, porque é ambígua com a forma statement. Qualificá-la (`this.yield()`, `Foo.yield()`) resolve isso.

### Rótulos case com múltiplos valores

Um único ramo arrow pode listar várias constantes separadas por vírgula que mapeiam para o mesmo resultado:

```java
static String kind(Day d) {
    return switch (d) {
        case MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY -> "Weekday";
        case SATURDAY, SUNDAY                             -> "Weekend";
    };
}
```

Na forma de dois-pontos, o mesmo agrupamento exigia empilhar rótulos soltos e depender do fall-through para alcançar um corpo compartilhado:

```java
switch (d) {
    case SATURDAY:
    case SUNDAY:
        return "Weekend";
    default:
        return "Weekday";
}
```

Rótulos com múltiplos valores dizem diretamente o que o idioma de rótulos empilhados dizia indiretamente, e eles funcionam na forma de dois-pontos também — a lista separada por vírgula é um recurso do rótulo, não um recurso do arrow.

### Exaustividade é um requisito da switch *expression*

Uma switch expression precisa produzir um valor para toda entrada possível, então o compilador verifica a cobertura. Sobre um `enum` com um caso para cada constante, essa checagem passa sem `default` algum:

```java
enum Day { MONDAY, SATURDAY, SUNDAY }

static String kind(Day d) {
    return switch (d) {         // compiles: all three constants covered, no default needed
        case MONDAY   -> "Weekday";
        case SATURDAY -> "Weekend";
        case SUNDAY   -> "Weekend";
    };
}
```

O mesmo `switch` idêntico usado como *statement* não tem esse requisito, porque um statement não produz nada — um valor não coberto é simplesmente um no-op:

```java
static void report(Day d) {
    switch (d) {                // compiles fine, even though SATURDAY and SUNDAY are unhandled
        case MONDAY -> System.out.println("Weekday");
    }
}

report(Day.SUNDAY);             // prints nothing at all, no error
```

Esse no-op silencioso é exatamente a proteção que transformar o switch em expression garante.

Sobre um tipo cujos valores o compilador não consegue enumerar — um `int`, `String`, `long` comum, ou qualquer tipo de referência não selado — exaustividade não é demonstrável, então um ramo `default` é obrigatório:

```java
static String name(int i) {
    return switch (i) {         // error: the switch expression does not cover all possible input values
        case 1 -> "one";
        case 2 -> "two";
    };
}
```

Adicionar `default -> "many";` resolve. Só seletores `enum` (e, conforme o próximo parágrafo, seletores selados) podem dispensar `default`.

### O paralelo com tipos selados

O mesmo mecanismo de exaustividade tem uma segunda fonte de prova: quando o seletor é um tipo `sealed` e os rótulos case são type ou record patterns cobrindo todo subtipo permitido, o compilador consegue provar a cobertura sem um `default`, exatamente como faz para um enum completo. Esse é o assunto de `pattern-matching` — a mecânica desta página (ramos arrow, `yield`, a divisão expression/statement) é aquilo sobre o qual ele se apoia.

## Trade-offs

- **Um único estilo de rótulo por bloco switch** — rótulos em forma de dois-pontos e em forma arrow não podem ser misturados no mesmo `switch`. Não existe migração gradual, caso a caso; converter um switch significa converter tudo de uma vez:

```java
switch (i) {
    case 1: System.out.println("one"); break;
    case 2 -> System.out.println("two");   // error: different case kinds used in the switch
}
```

- **Perder o fall-through é uma mudança real de comportamento, não só de sintaxe** — uma migração mecânica que troca `:`/`break` por `->` caso a caso quebra silenciosamente qualquer lógica que *pretendia* cair através dos casos, porque o código compartilhado que costumava rodar para ambos os rótulos agora roda para apenas um. Essa lógica precisa ser reescrita como um rótulo com múltiplos valores (`case 1, 2 -> ...`) ou duplicada nos dois ramos; o compilador não vai apontar o que você perdeu, já que o resultado continua sendo código válido.

- **`yield` se liga à switch expression mais interna que a envolve** — em switches aninhados, o `yield` interno produz o valor do switch interno, e não há forma de "atravessar" para o externo; o ramo externo precisa do seu próprio `yield`. O único lugar onde isso é inequívoco é uma lambda dentro de um ramo: o corpo de uma lambda não faz parte do switch, então `yield` ali é um erro de compilação (`yield outside of switch expression`), em vez de uma surpresa silenciosa. Ainda assim, switch expressions profundamente aninhadas leem mal — extrair a interna para um método costuma ser mais claro do que depender do leitor rastrear a qual switch um `yield` pertence.

- **Um switch exaustivo sobre enum pode ficar desatualizado entre compilações** — a garantia de "não precisa de `default`" é checada em tempo de compilação contra o enum como ele existia *naquele momento*. Adicione uma constante, recompile só o enum, e o switch já compilado deixa de ser exaustivo. Ele não retorna silenciosamente um valor errado: o class file mantém um ramo sintético de não-correspondência que lança exceção (no JDK 21+ um `java.lang.MatchException`; releases mais antigas lançavam `IncompatibleClassChangeError` aqui, então o tipo exato não é algo para codificar contra). Este é o análogo, para enums, do risco de recompilação de hierarquias seladas, e a correção é a mesma — recompilar tudo que faz switch sobre o enum, o que transforma a falha em runtime de volta em um erro de compilação exigindo o novo caso:

```java
enum Day { MONDAY, SATURDAY }            // kind() compiled against this
enum Day { MONDAY, SATURDAY, SUNDAY }    // enum recompiled alone
kind(Day.SUNDAY);                        // MatchException at runtime
```

## Documentation Links

- [JEP 361: Switch Expressions](https://openjdk.org/jeps/361) — doc
- [The switch Statement — Java SE Tutorials](https://docs.oracle.com/javase/tutorial/java/nutsandbolts/switch.html) — doc
