---
version: 1.0
updatedAt: 2026-08-18
title: "Text Blocks: Literais String Multi-Linha"
summary: "Como o text block com aspas triplas escreve SQL, JSON e HTML multi-linha sem escapes de \n ou concatenação com + — e o algoritmo preciso de whitespace incidental por trás disso, onde a própria coluna do delimitador de fechamento decide quanta indentação é removida, espaços finais desaparecem a menos que sejam presos com \s, e terminadores de linha são normalizados para \n. Continua sendo exatamente uma String em runtime, sem interpolação e sem forma de diferenciá-la de um literal comum."
---
## Objective

Entenda o text block (`"""`, JEP 378, finalizada no Java 15): um literal de string multi-linha que remove o ruído de `\n` a cada quebra de linha, `+` a cada fim de linha, e escape de cada aspas ao construir texto multi-linha com literais `"..."` comuns. Um text block é *apenas sintaxe de código-fonte* — o compilador produz exatamente uma `String`, com o mesmo tipo, os mesmos métodos e o mesmo interning de um literal comum equivalente.

## Use Cases

- Embutir uma query SQL multi-linha, um payload JSON, ou um fragmento HTML/XML diretamente no código-fonte Java, sem uma parede de concatenações e escapes.
- Escrever a saída multi-linha esperada de um teste (asserções no estilo snapshot) de uma forma que corresponda visualmente ao que ela representa.
- Qualquer literal que antes precisava de uma chamada `String.join("\n", ...)`, um `StringBuilder`, ou um método auxiliar só para se manter legível.

## Deep Dive

### O delimitador de abertura precisa terminar sua linha

Um text block começa com três aspas duplas seguidas por *nada além de* espaços finais opcionais e um terminador de linha. O conteúdo começa na linha seguinte:

```java
String bad = """Hello, world""";   // error: illegal text block open delimiter sequence,
                                   //        missing line terminator
```

```java
String good = """
        Hello, world
        """;
```

O delimitador de fechamento pode ficar em sua própria linha, ou no final da última linha de conteúdo. Essa escolha decide se o valor termina com uma quebra de linha:

```java
String withNewline = """
        one
        two
        """;        // "one\ntwo\n"

String noNewline = """
        one
        two""";     // "one\ntwo"  — no trailing \n
```

### Whitespace incidental: o delimitador de fechamento é parte da entrada

Esse é o mecanismo que surpreende todo mundo. O compilador olha para toda **linha de conteúdo não vazia** *e* **a linha que contém o delimitador de fechamento**, pega a contagem mínima de whitespace inicial entre elas, e remove exatamente essa quantidade de caracteres de espaço em branco no início de cada linha.

```java
class Report {
    static String sql() {
        return """
                SELECT id, name
                  FROM users
                 WHERE active = true
                """;
    }
}
```

As linhas de conteúdo estão indentadas em 16, 18 e 17 colunas; o `"""` de fechamento fica na coluna 16. O mínimo é 16, então 16 colunas são removidas de cada linha:

```text
SELECT id, name
  FROM users
 WHERE active = true
```

Agora mova só o delimitador de fechamento quatro colunas para a esquerda — o conteúdo permanece intocado:

```java
        return """
                SELECT id, name
                  FROM users
                 WHERE active = true
            """;
```

O mínimo agora é 12, então só 12 colunas são removidas e toda linha mantém quatro espaços iniciais:

```text
    SELECT id, name
      FROM users
     WHERE active = true
```

A coluna do delimitador é genuinamente uma *entrada* do algoritmo, não apenas um terminador. Note a assimetria: empurrar o `"""` de fechamento mais para a **direita** do que a linha de conteúdo menos indentada não muda nada (o mínimo do conteúdo ainda prevalece), enquanto empurrá-lo para a **esquerda** adiciona indentação ao valor. Linhas em branco não participam do mínimo — elas são simplesmente normalizadas para linhas vazias.

### Whitespace final é sempre removido

Independente do algoritmo de indentação, espaço em branco final é removido do fim de cada linha:

```java
String s = """
        alpha   
        beta
        """;      // "alpha\nbeta\n" — the three spaces after "alpha" are gone
```

Isso é deliberado (torna impossível introduzir espaços finais invisíveis por acidente em um diff), mas significa que um text block *não* é uma cópia byte a byte do que você digitou. Para manter um espaço final, você precisa de `\s` (abaixo).

### Terminadores de linha são normalizados para `\n`

Seja qual for o padrão usado pelo arquivo-fonte — LF, CRLF ou CR — todo terminador de linha dentro de um text block vira um único `\n` na `String` resultante. Um arquivo escrito no Windows e um escrito no Linux compilam para o mesmo valor idêntico:

```java
String twoLines = """
        first
        second
        """;
// twoLines.equals("first\nsecond\n") is true on every platform
assert !twoLines.contains("\r");
```

Se você genuinamente precisa de CRLF no valor, escreva-o explicitamente com escapes `\r\n`.

### Aspas e escapes dentro de um text block

Todos os escapes familiares continuam funcionando (`\n`, `\t`, `\\`, `\"`, escapes unicode). A diferença é que uma `"` solta não precisa de escape nenhum, porque só uma sequência de três aspas é ambígua:

```java
String quoted = """
        She said "yes" — a single quote pair needs no escape.
        Two in a row are fine as well: ""
        Three would close the block, so escape one of them: \"""
        """;
```

Qualquer um de `\"""`, `"\""`, ou `""\"` funciona; só três ou mais aspas consecutivas exigem escape.

O processamento de escapes acontece **depois** da remoção do whitespace incidental, motivo pelo qual um `\n` escrito dentro de um text block nunca confunde o algoritmo de indentação — no momento da remoção ele ainda são dois caracteres, não uma quebra de linha.

### Os dois escapes exclusivos de text blocks: `\s` e continuação de linha

`\s` se traduz em um único espaço (U+0020). Como é traduzido *depois* da remoção do whitespace final, ele age como uma cerca que protege tudo à sua esquerda:

```java
String padded = """
        red  \s
        green\s
        blue
        """;
// "red   \ngreen \nblue\n"
//     ^^^ two typed spaces + the \s space survive
```

Uma barra invertida no final de uma linha suprime o terminador dessa linha, permitindo que uma linha lógica seja quebrada em várias linhas físicas do código-fonte:

```java
String oneLine = """
        The quick brown fox \
        jumps over \
        the lazy dog.
        """;
// "The quick brown fox jumps over the lazy dog.\n"
```

O espaço antes de cada `\` é preservado: a linha deixa de *terminar* em whitespace, então não há nada para a passagem de remoção de whitespace final remover. Esse escape de continuação de linha não é válido em um literal `"..."` comum — ele existe só para text blocks.

### Continua sendo exatamente uma String

Um text block é um literal de string, então é uma expressão constante em tempo de compilação sempre que seu conteúdo é totalmente conhecido em tempo de compilação — utilizável como uma constante `static final`, um valor de anotação, ou um rótulo de case de `switch`, e sofre interning como qualquer outro literal:

```java
static final String GREETING = """
        hello""";

GREETING == "hello";   // true — constant expression, same interned instance
```

Não há interpolação, então variáveis entram através da API normal de `String`:

```java
String body = """
        {"user": "%s", "id": %d}
        """.formatted(name, id);
```

O Java 15 também expôs o algoritmo em runtime: `String.stripIndent()` aplica as mesmas regras de whitespace incidental a uma string comum, e `String.translateEscapes()` executa a tradução de escapes — útil quando o texto vem de um arquivo em vez de vir do código-fonte.

## Trade-offs

- **A coluna do delimitador de fechamento muda o valor silenciosamente.** Um auto-formatter, ou uma reindentação descuidada durante revisão, pode deslocar o `"""` de fechamento e mudar a string em runtime sem nenhum aviso do compilador — as duas versões são sintaticamente perfeitamente válidas. Testes de golden-file e `assertEquals` sobre saída multi-linha são onde isso morde:

```java
String a = """
        x
        """;      // "x\n"
String b = """
        x
    """;          // "    x\n"  — same content, delimiter 4 columns left
```

- **Sem interpolação.** Diferente de template literals em outras linguagens, `${...}` e afins não existem aqui; injetar um valor ainda significa `formatted()`, `String.format()`, ou concatenação — e para SQL especificamente, isso significa que um text block não faz nada para ajudar a evitar injeção, então placeholders de parâmetro continuam obrigatórios:

```java
String sql = """
        SELECT * FROM users WHERE id = ?
        """;   // still a PreparedStatement parameter, not string-built
```

- **Whitespace final não pode ser digitado, só escapado.** Qualquer conteúdo cujo significado dependa de espaços finais (formatos de registro de largura fixa, algumas quebras de linha do Markdown) precisa de um `\s` explícito em cada linha afetada, o que é fácil de esquecer e invisível no valor até um teste falhar.

- **Zero distinção em runtime.** Uma `String` não carrega marcador nenhum de ter vindo de um text block, então nada consegue detectar "isso era um text block" reflexivamente ou em runtime — é puramente um recurso de ergonomia de código-fonte, e uma API nunca deve ser projetada em torno de distinguir os dois:

```java
"a\nb\n".equals("""
        a
        b
        """);   // true — indistinguishable
```

## Documentation Links

- [JEP 378: Text Blocks](https://openjdk.org/jeps/378) — doc
- [Text Blocks — Java SE developer guide](https://docs.oracle.com/en/java/javase/25/text-blocks/index.html) — doc
