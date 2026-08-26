---
version: 1.0
updatedAt: 2026-08-19
title: A Classe Scanner
summary: "Scanner tokeniza a entrada vinda de System.in, de uma String ou de um arquivo via pares hasNextX()/nextX(), com uma armadilha clássica: nextInt() deixa a quebra de linha final sem consumir, então um nextLine() seguinte lê uma string vazia em vez da próxima linha de verdade."
---
## Objective

`Scanner` transforma a leitura de tokens formatados, delimitados por espaço em branco ou por padrão — vindos de `System.in`, uma `String`, um `File`, ou qualquer coisa que implemente `Readable` — em um loop pequeno e uniforme: pergunte `hasNextX()`, depois chame `nextX()`. É a ferramenta usada o tempo todo em scripts, exercícios de programação e ferramentas de linha de comando, e tem exatamente uma armadilha que pega quase todo mundo que a usa: misturar `nextInt()`/`nextDouble()` com `nextLine()` deixa uma quebra de linha não consumida no buffer, então o próximo `nextLine()` lê uma string vazia em vez do que o usuário de fato digitou em seguida.

## Use Cases

- Ler entrada interativa de console em uma ferramenta pequena ou script, onde `Scanner(System.in)` é genuinamente a opção correta mais simples.
- Fazer parsing de um arquivo ou string separado por espaço em branco ou delimitador — um formato tipo CSV, uma linha de log, um valor de configuração — sem escrever um tokenizador manual.
- Ler entrada de tipos mistos (um int, depois um double, depois uma palavra) em uma única passada, onde cada checagem `hasNextX()` diz o que ler em seguida antes de você tentar ler.
- Prototipagem ou exercícios onde ler entrada estruturada rapidamente importa mais do que a performance ou a precisão que um parser dedicado daria.

## Deep Dive

### Construção: uma classe, muitas fontes

```java
Scanner console = new Scanner(System.in);              // keyboard
Scanner fromString = new Scanner("42 3.14 done");        // a String
Scanner fromFile = new Scanner(Paths.get("data.txt"));   // a file, via Path (JDK 10+)
```

Qualquer coisa que implemente `Readable` ou `ReadableByteChannel` pode alimentar um `Scanner` — um `FileReader` resolve para o construtor `Scanner(Readable)` da mesma forma que `System.in` (um `InputStream`) resolve para `Scanner(InputStream)`.

### O loop central: hasNextX, depois nextX

```java
Scanner sc = new Scanner(System.in);
int sum = 0;
while (sc.hasNextInt()) {
    sum += sc.nextInt();
}
```

`hasNextInt()` espia se o *próximo token* pode ser interpretado como `int` sem consumi-lo; `nextInt()` consome e o retorna. Chamar um `nextX()` sem checar antes o `hasNextX()` correspondente lança `InputMismatchException` se o token não casar, ou `NoSuchElementException` se não sobrar token nenhum — checar antes é o que faz o loop terminar de forma limpa em vez de travar no primeiro token que não casa ou que falta.

`nextDouble()` casa com qualquer coisa que possa ser lida como `double`, incluindo um inteiro simples como `2` — então misturar tipos na mesma leitura importa numa ordem específica: cheque o tipo mais específico primeiro. Ler um fluxo `int`-depois-`double` chamando `nextDouble()` antes de `nextInt()` lê silenciosamente *ambos* como doubles, porque o padrão de `nextDouble()` também casa com um token inteiro.

### A armadilha clássica: `nextInt()` seguido de `nextLine()`

```java
Scanner sc = new Scanner(System.in);
System.out.print("Age: ");
int age = sc.nextInt();          // consumes "30", leaves the trailing newline in the buffer
System.out.print("Name: ");
String name = sc.nextLine();     // consumes just that leftover newline — reads "" !
```

`nextInt()` (e todo outro `nextX()` além de `nextLine()`) consome só o próprio token, não a quebra de linha que vem depois. `nextLine()` lê até e incluindo a próxima quebra de linha — então, logo após um `nextInt()`, a "próxima linha" que ele encontra é o resto vazio da linha em que o número estava, não a linha que o usuário digita depois. A correção é um `sc.nextLine()` extra para descartar explicitamente essa quebra de linha sobrando antes da chamada real de `nextLine()`:

```java
int age = sc.nextInt();
sc.nextLine();                   // consume the leftover newline
String name = sc.nextLine();     // now reads the actual next line
```

Essa única armadilha responde por boa parte dos relatos de bug do tipo "meu programa pula a leitura do nome" — não é um bug do `Scanner`, é uma incompatibilidade entre o que cada método de fato consome.

### Delimitadores: espaço em branco por padrão, um regex se precisar

```java
Scanner sc = new Scanner("10, 20,   30");
sc.useDelimiter(",\\s*");        // comma, then zero or more spaces
while (sc.hasNextInt()) {
    System.out.println(sc.nextInt());   // 10, 20, 30
}
```

`useDelimiter` recebe uma expressão regular, não um conjunto literal de caracteres — então um `Scanner` pode tokenizar sobre padrões arbitrários (`","`, `"\\s+"`, um limite de registro de largura fixa), não só a sequência padrão de espaços em branco. `delimiter()` retorna o `Pattern` atualmente em uso.

### `findInLine` e `findWithinHorizon`: buscando sem consumir tudo até o casamento

```java
Scanner sc = new Scanner("Name: Alice, Age: 28");
sc.findInLine("Age:");           // advances past "Age:" if found; returns the matched text or null
int age = sc.nextInt();          // 28
```

`findInLine` procura por um padrão na próxima linha independentemente do conjunto de delimitadores atual, consumindo só o trecho casado — útil para extrair um campo rotulado de um texto semiestruturado sem tokenizar a linha inteira primeiro. `findWithinHorizon` é a mesma ideia sobre uma janela de caracteres limitada (ou, com `0`, ilimitada) em vez de uma linha.

### Fechamento: `Scanner` implementa `AutoCloseable`

```java
try (Scanner sc = new Scanner(Paths.get("data.txt"))) {
    while (sc.hasNextLine()) {
        process(sc.nextLine());
    }
}   // sc.close() called automatically, which also closes the underlying file
```

Fechar um `Scanner` fecha o `Readable`/stream que o alimenta (se essa fonte implementar `Closeable`) — um motivo real para preferir try-with-resources aqui em vez de lembrar de uma chamada explícita a `close()`, exatamente o padrão coberto em `io-streams-fundamentals`.

## Trade-offs

- **`Scanner(System.in)` não deve ser fechado se você precisar de `System.in` de novo depois.** Fechar um `Scanner` que envolve `System.in` também fecha o stream subjacente — um `new Scanner(System.in)` mais tarde no mesmo programa vai encontrá-lo já fechado. Esse é um motivo real pelo qual algum código deliberadamente evita try-with-resources especificamente para o caso do `System.in`.
- **`Scanner` faz checagem de tipo em cada token contra o padrão solicitado, o que custa vazão de verdade** comparado a um tokenizador escrito à mão ou a `BufferedReader.readLine()` mais `split()`/parsing manual — tranquilo para entrada interativa ou arquivos modestos, um gargalo real em entradas muito grandes lidas token a token dentro de um loop quente.
- **A armadilha da quebra de linha `nextInt()`-depois-`nextLine()` não é um bug para remendar caso a caso — é consequência do que cada método consome**, e a correção generaliza: toda vez que uma chamada que não é `nextLine()` for seguida de uma chamada `nextLine()`, assuma que uma quebra de linha sobrando precisa de um descarte explícito antes, em vez de depurar isso do zero a cada vez que aparecer.
- **Um token ausente ou incompatível lança exceção, não retorna um valor nulo/sentinela** — `NoSuchElementException` para entrada esgotada, `InputMismatchException` para incompatibilidade de tipo — o que é exatamente o motivo pelo qual a disciplina `hasNextX()`-antes-de-`nextX()` importa; pular essa etapa transforma uma condição normal de "não há mais entrada" em um fluxo de controle guiado por exceção.

## Documentation Links

- [Scanner — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Scanner.html) — doc
- [Pattern — Java SE 25 API (used by `useDelimiter`)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Pattern.html) — doc
