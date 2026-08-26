---
version: 1.0
updatedAt: 2026-08-19
title: Aritmética Exata com BigDecimal e BigInteger
summary: Como java.math.BigDecimal e BigInteger oferecem precisão arbitrária e arredondamento explícito onde double e long silenciosamente perdem dinheiro ou estouram.
---
## Objective

`double` e `long` são rápidos porque são tipos binários de largura fixa — e é exatamente por isso que são a ferramenta errada para dinheiro, impostos ou chaves criptográficas. Um `double` não consegue representar `0.1` de forma alguma, e um `long` para em 9.223.372.036.854.775.807. `java.math.BigDecimal` e `java.math.BigInteger` trocam velocidade por duas garantias que os tipos primitivos não conseguem dar: precisão arbitrária (o número cresce tanto quanto a memória permitir) e aritmética decimal *exata* sob uma política de arredondamento que você escolhe explicitamente, em vez de uma que o hardware escolhe por você. Ambos são classes imutáveis semelhantes a tipos de valor, então toda operação retorna um novo objeto.

## Use Cases

- Aritmética monetária — preços, totais de fatura, impostos, juros — onde uma fração de centavo perdida por arredondamento binário é um bug de reconciliação ou um achado de auditoria.
- Qualquer coisa com uma regra de arredondamento legalmente exigida (arredondamento bancário, arredondamento de IVA, escalas específicas de moeda) que precisa estar declarada no código, não herdada do IEEE 754.
- Criptografia e teoria dos números: inteiros do tamanho usado em RSA, exponenciação modular, geração de primos prováveis — tudo muito além de `long`.
- Fazer parsing e reemitir dados decimais (JSON, CSV, colunas `NUMERIC` de banco de dados) sem mudar o valor ou seu número de casas decimais.
- Combinatória e resultados exatos com números grandes — fatoriais, `2^4096`, números de Fibonacci grandes — onde o overflow silenciosamente daria a volta em um `long`.

## Deep Dive

### Por que `double` perde valores decimais

Um `double` armazena uma fração binária. `0.1` é uma fração periódica na base 2, então é armazenada como o valor representável mais próximo, e o erro fica visível assim que você soma:

```java
System.out.println(0.1 + 0.2);        // 0.30000000000000004
System.out.println(0.1 + 0.2 == 0.3); // false

double sum = 0;
for (int i = 0; i < 10; i++) sum += 0.1;
System.out.println(sum);              // 0.9999999999999999
```

`BigDecimal` armazena os dígitos que você realmente escreveu, na base 10, então o mesmo cálculo é exato:

```java
BigDecimal sum = BigDecimal.ZERO;
for (int i = 0; i < 10; i++) sum = sum.add(new BigDecimal("0.1"));
System.out.println(sum);              // 1.0
```

Note `sum = sum.add(...)`. `BigDecimal` é imutável; um simples `sum.add(x);` calcula um valor e o descarta:

```java
BigDecimal balance = new BigDecimal("10.00");
balance.add(new BigDecimal("5"));     // return value discarded
System.out.println(balance);          // 10.00
```

### O modelo de `BigDecimal`: valor não escalonado e escala

Um `BigDecimal` é exatamente duas coisas: um inteiro de precisão arbitrária (`unscaledValue()`, um `BigInteger`) e uma `scale()` de 32 bits. O valor é `unscaledValue × 10^-scale`:

```java
BigDecimal d = new BigDecimal("12.3400");
System.out.println(d.unscaledValue()); // 123400
System.out.println(d.scale());         // 4
System.out.println(d.precision());     // 6  (total significant digits)
```

A escala faz parte da identidade do objeto, e é por isso que `equals()` distingue `2.0` de `2.00` enquanto `compareTo()` não:

```java
BigDecimal a = new BigDecimal("2.0");
BigDecimal b = new BigDecimal("2.00");
System.out.println(a.equals(b));       // false — different scales
System.out.println(a.compareTo(b));    // 0     — same numeric value
```

Para dinheiro isso é um recurso: `2.00` carrega "duas casas decimais" como dado, e `setScale()` é como você normaliza isso.

```java
BigDecimal price = new BigDecimal("2.345");
System.out.println(price.setScale(2, RoundingMode.HALF_UP));   // 2.35
System.out.println(price.setScale(2, RoundingMode.HALF_EVEN)); // 2.34
```

### Construindo um corretamente

`new BigDecimal(double)` é exato — e esse é o problema. Ele registra fielmente a aproximação binária que o `double` já carrega, todos os 55 dígitos dela:

```java
System.out.println(new BigDecimal(0.1));
// 0.1000000000000000055511151231257827021181583404541015625

System.out.println(BigDecimal.valueOf(0.1));   // 0.1
System.out.println(new BigDecimal("0.1"));     // 0.1
```

`BigDecimal.valueOf(double)` passa por `Double.toString()`, então dá o decimal curto que uma pessoa teria digitado. O construtor com `String` nunca envolve um `double` de forma alguma — prefira-o sempre que o valor vier originalmente de texto (o corpo de uma requisição, uma célula de CSV, um arquivo de configuração). `BigInteger` tem a mesma divisão: `BigInteger.valueOf(long)` para valores que cabem, o construtor com `String` para qualquer coisa maior.

```java
BigInteger big = new BigInteger("3419229223372036854775807");
System.out.println(Long.MAX_VALUE);   // 9223372036854775807
System.out.println(big);              // 3419229223372036854775807
```

### Divisão obriga você a declarar uma política de arredondamento

`add`, `subtract` e `multiply` sempre têm uma resposta decimal exata, então as formas com um único argumento são seguras. Divisão frequentemente não tem, e a `divide()` de um argumento se recusa a adivinhar:

```java
BigDecimal.ONE.divide(new BigDecimal("3"));
// ArithmeticException: Non-terminating decimal expansion;
// no exact representable decimal result.
```

Forneça uma escala alvo mais um `RoundingMode`, ou um `MathContext` que fixe o número de dígitos significativos:

```java
BigDecimal.ONE.divide(new BigDecimal("3"), 5, RoundingMode.HALF_UP);
// 0.33333

BigDecimal.ONE.divide(new BigDecimal("3"), MathContext.DECIMAL64);
// 0.3333333333333333
```

`RoundingMode` (em `java.math`, compartilhado com `setScale`) tem oito constantes: `UP`, `DOWN`, `CEILING`, `FLOOR`, `HALF_UP`, `HALF_DOWN`, `HALF_EVEN` e `UNNECESSARY`. `HALF_EVEN` é o arredondamento bancário — arredonda empates em direção ao vizinho par para que uma longa sequência de arredondamentos não derive para cima, e é por isso que é o padrão em todo preset de `MathContext` exceto `UNLIMITED`. `UNNECESSARY` afirma que nenhum arredondamento deveria ser necessário e lança exceção se for:

```java
new BigDecimal("2.5").setScale(0);   // ArithmeticException: Rounding necessary
```

`MathContext` empacota uma precisão (dígitos significativos) com um `RoundingMode`, e todo método aritmético tem uma sobrecarga que aceita um: `DECIMAL32`, `DECIMAL64`, `DECIMAL128` espelham os formatos decimais do IEEE 754 (7, 16 e 34 dígitos, todos `HALF_EVEN`), e `MathContext.UNLIMITED` significa "exato, ou lance exceção".

### `BigInteger`: inteiros ilimitados, aritmética modular e de primos

`BigInteger` cobre os operadores inteiros mais a teoria dos números que a criptografia de chave pública precisa:

```java
BigInteger.valueOf(2).pow(4096).bitLength();          // 4097
BigInteger.valueOf(48).gcd(BigInteger.valueOf(18));   // 6
BigInteger.valueOf(1000).sqrt();                      // 31 (floor)
BigInteger.valueOf(4).modPow(BigInteger.valueOf(13),
                             BigInteger.valueOf(497)); // 445
```

`modPow` é a operação por trás do RSA, e não é o mesmo que `pow().mod()` — ela nunca materializa o intermediário astronomicamente grande. A primalidade é probabilística: `isProbablePrime(certainty)` e `nextProbablePrime()` podem reportar um composto como primo com probabilidade menor que `1 - 1/2^certainty`, enquanto `probablePrime(bitLength, random)` gera um candidato novo de um determinado tamanho:

```java
BigInteger p = BigInteger.probablePrime(2048, new SecureRandom());
System.out.println(p.isProbablePrime(100));   // true
```

As constantes `ZERO`, `ONE`, `TWO` e `TEN` existem em ambas as classes (`BigInteger.TWO` desde o Java 9, `BigDecimal.TWO` desde o Java 19), e ambas implementam `Comparable`, então ordenam e funcionam em um `TreeMap` sem um comparador.

### Voltando sem perder dados silenciosamente

Os métodos `xxxValue()` são conversões restritivas (narrowing) e são discretos sobre isso. Um `BigInteger` além de `Double.MAX_VALUE` vira `Infinity`; um `BigDecimal` com fração é truncado:

```java
System.out.println(BigInteger.TEN.pow(400).doubleValue()); // Infinity
System.out.println(new BigDecimal("2.99").intValue());     // 2
```

As variantes `...Exact` — `intValueExact()`, `longValueExact()`, `toBigIntegerExact()` — falham de forma ruidosa em vez disso:

```java
new BigDecimal("2.50").intValueExact();
// ArithmeticException: Rounding necessary
```

A impressão tem uma armadilha equivalente: `toString()` pode mudar para notação científica, `toPlainString()` nunca faz isso.

```java
BigDecimal x = new BigDecimal("600.0").stripTrailingZeros();
System.out.println(x);                  // 6E+2
System.out.println(x.toPlainString());  // 600
```

### Onde `java.math` para: sem complexo, sem tipo racional

`java.math` tem só duas classes numéricas. Não existe um tipo complexo, racional, matriz ou sem sinal embutido — para isso você escreve uma pequena classe de valor ou adota uma dependência de biblioteca (o `Complex`, `BigFraction` do Apache Commons Math). Desde o Java 16, um `record` torna a versão feita à mão praticamente de graça, e a imutabilidade vem junto:

```java
public record Complex(double re, double im) {
    public Complex plus(Complex o)  { return new Complex(re + o.re, im + o.im); }
    public Complex times(Complex o) {
        return new Complex(re * o.re - im * o.im, re * o.im + im * o.re);
    }
    public double magnitude() { return Math.hypot(re, im); }
}

var c = new Complex(3, 5).times(new Complex(2, -2));
System.out.println(c);            // Complex[re=16.0, im=4.0]
```

Note a nomeação `plus`/`times`: Java não tem sobrecarga de operadores, então cada um desses tipos — incluindo `BigDecimal` — é usado por meio de chamadas de método, e `a.add(b).multiply(c)` é o melhor que a sintaxe consegue oferecer.

## Trade-offs

- **Correção custa velocidade e alocação** — toda operação aloca um novo objeto e roda em software em vez de uma instrução de CPU, então `BigDecimal` é ordens de magnitude mais lento que `long` ou `double`. Código monetário de alto volume frequentemente armazena unidades mínimas inteiras (centavos) em um `long` e recorre a `BigDecimal` só nas fronteiras onde escala e arredondamento acontecem.
- **`equals()` e `compareTo()` discordam, então coleções baseadas em hash e ordenadas discordam também** — `BigDecimal` deliberadamente quebra a expectativa usual de "consistente com equals", e `2.0` versus `2.00` é uma chave duplicada silenciosa em um `HashMap`.
  ```java
  var values = List.of(new BigDecimal("2.0"), new BigDecimal("2.00"));
  new HashSet<>(values).size();   // 2  — equals() sees two values
  new TreeSet<>(values).size();   // 1  — compareTo() sees one
  ```
- **`new BigDecimal(double)` importa exatamente o erro do qual você fugiu** — o construtor é exato sobre um valor que já estava errado, então um `double` em qualquer ponto anterior à conversão já perdeu a precisão.
  ```java
  new BigDecimal(1.1).multiply(new BigDecimal("3"));
  // 3.300000000000000266453525910037569701671600341796875
  new BigDecimal("1.1").multiply(new BigDecimal("3"));  // 3.3
  ```
- **Divisão sem arredondamento lança exceção em vez de aproximar** — mais seguro que uma resposta errada, mas significa que toda `divide()` na base de código precisa tomar uma decisão de política, e uma sobrecarga faltando é uma `ArithmeticException` em produção em vez de um erro de compilação.
  ```java
  new BigDecimal("10").divide(new BigDecimal("3")); // ArithmeticException
  ```
- **Imutabilidade torna resultados descartados invisíveis** — nada avisa quando um valor de retorno é descartado, diferente do erro de compilação que você teria ao usar mal um operador de atribuição.
  ```java
  BigDecimal total = new BigDecimal("0.00");
  total.add(new BigDecimal("9.99"));   // silently does nothing
  ```
- **A escala é ilimitada, e o custo também** — `BigInteger` cresce com o valor e a precisão de `BigDecimal` cresce a cada `multiply`, então aritmética exata encadeada sobre entrada fornecida pelo usuário pode consumir quantidades surpreendentes de memória e CPU. `MathContext` em cada operação, ou um `setScale()` periódico, limita isso.
- **A legibilidade sofre** — uma fórmula escrita em chamadas de método `BigDecimal` é materialmente mais difícil de ler e revisar do que a mesma fórmula em operadores, o que é um argumento real para manter a camada de aritmética exata fina e bem testada em vez de espalhá-la pelo modelo de domínio.

## Documentation Links

- [BigDecimal — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html) — doc
- [BigInteger — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigInteger.html) — doc
- [MathContext — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/MathContext.html) — doc
- [RoundingMode — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/RoundingMode.html) — doc
- [Double — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Double.html) — doc
