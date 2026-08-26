---
version: 1.0
updatedAt: 2026-08-02
title: Expressões Regulares com Pattern e Matcher
summary: Por que Pattern.compile() e Matcher existem como dois objetos separados (compile uma vez, faça match muitas vezes), a diferença entre find()/matches()/lookingAt(), e como grupos de captura — numerados e nomeados — extraem substrings de um match em vez de apenas testar sim/não.
---
## Objective

`Pattern` e `Matcher` dividem o trabalho com regex em duas etapas: `Pattern.compile()` transforma uma string de regex em um pattern reutilizável e pré-processado uma única vez, e `Pattern.matcher(input)` cria um `Matcher` que executa esse pattern contra um pedaço específico de texto — quantas vezes forem necessárias, contra quantos inputs forem necessários, sem recompilar a regex a cada vez.

## Use Cases

- Validar que uma string tem um formato específico (algo parecido com um e-mail, um código de produto) antes de aceitá-la como entrada.
- Extrair substruturas de uma string maior — o domínio de um endereço de e-mail, o ano/mês/dia de uma string parecida com data — via grupos de captura em vez de aritmética manual de índices.
- Varrer um grande bloco de texto em busca de cada ocorrência de um pattern, um match por vez, chamando `find()` repetidamente.
- Substituir cada substring que corresponde a um pattern por outra coisa em uma única chamada, em vez de um loop manual de busca e substituição.

## Deep Dive

### Pattern e Matcher: compile uma vez, faça match muitas vezes

```java
Pattern pattern = Pattern.compile("Java");
Matcher matcher = pattern.matcher("Java SE");
if (matcher.find()) {
    System.out.println("subsequence found");
}
```

`Pattern` não tem construtor público — `compile()` é a única forma de obter um, e o objeto resultante é seguro para reutilizar contra vários inputs diferentes. `Pattern.matcher(CharSequence)` cria um novo `Matcher` vinculado a uma sequência de entrada específica.

### matches() vs. find() vs. lookingAt()

- `matches()` — a sequência de entrada *inteira* precisa dar match com o pattern, do início ao fim. `"Java".matches` contra o pattern `"Java"` funciona; contra `"Java SE"` falha, mesmo que `"Java"` apareça no início.
- `find()` — funciona se *qualquer* subsequência der match, em qualquer lugar do input. Chamadas repetidas continuam a busca de onde o match anterior terminou, e é assim que você varre todas as ocorrências:
  ```java
  Matcher m = Pattern.compile("test").matcher("This is a test. Another test follows.");
  while (m.find()) {
      System.out.println("test found at index " + m.start());
  }
  ```
- `lookingAt()` — parecido com `matches()`, mas só exige que o match comece no início do input; não precisa consumir a string toda.

### Grupos de captura — numerados e nomeados

Parênteses em um pattern criam um grupo de captura; `group(n)` recupera o que o grupo `n` capturou (`group(0)`, ou simplesmente `group()`, é o match inteiro):

```java
Matcher m = Pattern.compile("(\\d{4})-(\\d{2})-(\\d{2})").matcher("Date: 2026-08-02");
if (m.find()) {
    String year = m.group(1);    // "2026"
    String month = m.group(2);   // "08"
}
```

Grupos nomeados (`(?<name>...)`) permitem recuperar um valor capturado pelo nome em vez de pela posição — muito mais legível quando o pattern tem mais de dois ou três grupos:

```java
Matcher m = Pattern.compile("(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})").matcher("2026-08-02");
if (m.matches()) {
    System.out.println(m.group("year"));   // "2026"
}
```

### Quantificadores greedy, reluctant e possessive

```java
Pattern.compile("e.+d").matcher("extend cup end").find();    // greedy: matches "extend cup end"
Pattern.compile("e.+?d").matcher("extend cup end");           // reluctant: matches "extend", then "end"
```

Um quantificador simples (`+`, `*`, `{n,m}`) é *greedy* por padrão — ele dá match com a maior sequência possível. Adicionar `?` o torna *reluctant* (o menor match possível); adicionar `+` o torna *possessive* (dá match greedily e nunca faz backtracking, mesmo que isso signifique que o match geral falhe onde um quantificador greedy teria sucesso). A distinção importa mais sempre que um coringa (`.`) é seguido de outra construção quantificada no mesmo pattern.

### Substituindo e dividindo (replace e split)

```java
"Jon Jonathan Frank".replaceAll("Jon.*? ", "Eric ");   // "Eric Eric Frank"

Pattern.compile("[ ,.!]+").split("one two, alpha9.12!done");
// ["one", "two", "alpha9", "12", "done"]
```

`Matcher.replaceAll()`/`String.replaceAll()` substituem cada match; `Pattern.split()`/`String.split()` tratam cada match do pattern como um delimitador e retornam os tokens entre eles, descartando os próprios delimitadores.

### Match único sem um objeto Pattern

Para um pattern usado apenas uma vez, `Pattern.matches(String, CharSequence)` e `String.matches(String)` pulam as etapas explícitas de `compile()`/`matcher()`:

```java
boolean ok = "2026-08-02".matches("\\d{4}-\\d{2}-\\d{2}");
```

Ambos recompilam a regex internamente a cada chamada — tudo bem para uma verificação pontual, mas desperdício se o mesmo pattern rodar contra muitos inputs em um loop.

## Trade-offs

- **Compilar o mesmo pattern repetidamente (via `String.matches()` em um loop, por exemplo) joga fora a única vantagem real de performance que `Pattern`/`Matcher` oferece** — compile uma vez fora do loop e reutilize o `Pattern` para cada input.
  ```java
  Pattern p = Pattern.compile("\\d+");           // compiled once
  for (String s : inputs) if (p.matcher(s).matches()) { /* ... */ }
  ```
- **`matches()` exige que o input inteiro dê match; `find()` só exige que uma subsequência dê.** Usar `matches()` quando a intenção era `find()` (ou vice-versa) é uma fonte comum de bugs do tipo "por que isso não dá match" — sempre confira qual dos dois a intenção realmente pede.
- **Quantificadores greedy podem silenciosamente capturar mais do que o pretendido quando um coringa abrange caracteres que você não esperava incluir** — `"e.+d"` dando match desde o primeiro `e` até o *último* `d` da string é correto pela especificação, não um bug, mas surpreende quem espera o menor match.
- **`group(n)` e `start()`/`end()` lançam `IllegalStateException` se chamados antes de um match bem-sucedido** — sempre verifique o retorno booleano de `matches()`/`find()`/`lookingAt()` antes de chamar qualquer método que leia o resultado do match.

## Documentation Links

- [Pattern — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Pattern.html) — doc
- [Matcher — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Matcher.html) — doc
