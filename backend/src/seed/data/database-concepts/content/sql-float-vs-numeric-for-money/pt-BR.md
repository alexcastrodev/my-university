---
version: 1.0
updatedAt: 2026-08-13
title: "Por que Float Falha para Dinheiro: NUMERIC, Centavos-como-Inteiros, e BigDecimal"
summary: Float e double não conseguem representar a maioria das frações decimais exatamente porque são base 2, então 0.1 + 0.2 !== 0.3 e totais monetários derivam silenciosamente; o conserto é NUMERIC/DECIMAL, unidades menores inteiras, ou BigDecimal, não arredondar mais forte a cada passo.
---
## Objective

`0.1 + 0.2` não é igual a `0.3` em quase nenhum computador, e o motivo não é um bug de arredondamento na adição: é que `float`/`double` representam números em base 2, e a maioria das frações decimais (`0.1`, `0.2`, `0.3`, `0.7`) não têm expansão binária finita, do mesmo jeito que `1/3` não tem expansão decimal finita. O valor de fato armazenado é a aproximação representável mais próxima, então qualquer coluna ou variável tipada como `float8`/`double precision` já está mentindo por algumas unidades na décima sétima casa decimal antes de qualquer cálculo rodar. Para dinheiro isso deixa de ser uma curiosidade: um total armazenado de `108.80` pode ser silenciosamente `108.80000000000001` internamente, e `WHERE total = 108.80` pode não encontrar a linha que está procurando. O conserto não é "arredondar mais forte": arredondar a cada passo de uma agregação grande introduz a mesma decisão enviesada milhares de vezes; é escolher uma representação que seja exata desde o início: `NUMERIC`/`DECIMAL` no banco de dados, unidades menores inteiras (centavos), ou `BigDecimal` em código de aplicação, em vez de um float binário fingindo ser decimal.

## Use Cases

- Armazenar ou comparar totais monetários em uma coluna de banco de dados, onde `WHERE total = 108.80` precisa de fato corresponder à linha que exibe como `108.80`.
- Somar milhares de itens de linha (faturas, totais de pedido, entradas de livro-razão) onde *quando* o arredondamento acontece (uma vez no final versus uma vez por linha) muda o total final por dinheiro real.
- Escolher um tipo de schema para uma coluna de preço/valor: `NUMERIC(10,2)`, uma coluna de centavos inteira, ou (a escolha errada) `FLOAT`/`DOUBLE PRECISION`.
- Integrar com uma API de pagamento ou faturamento, a maioria das quais fala unidades menores inteiras (centavos, pence) na comunicação especificamente para desviar desse problema.
- Explicar uma discrepância de "um centavo a menos/mais" entre um total que seu código computou e um total que um banco, fatura, ou planilha reporta de volta.

## Deep Dive

### Por que `0.1` não tem representação binária exata

Um `float`/`double` é uma soma de potências de dois. Alguns decimais por acaso são exatos em binário porque são construídos a partir de potências negativas de dois:

```text
0.5   = 1/2   = 0.1₂
0.25  = 1/4   = 0.01₂
0.125 = 1/8   = 0.001₂
```

Mas `0.1` é `1/10`, e `10` não é uma potência de dois: então, assim como `1/3` em decimal produz um `0.3333...` interminável, `1/10` em binário produz uma fração repetindo interminável:

```text
0.1 (decimal) ≈ 0.0001100110011001100110011... (binary, repeating)
```

Um `double` tem 52 bits de mantissa, então esse padrão repetido é cortado e arredondado para o valor representável mais próximo. O número de fato armazenado para o literal `0.1` é:

```text
0.1000000000000000055511151231257827021181583404541015625
```

não `0.1`. Ele só *exibe* como `0.1` porque a rotina de impressão arredonda de volta para o decimal mais curto que lê igual. Essa é uma propriedade do próprio ponto flutuante binário IEEE 754: vale identicamente se o `0.1` é um `float` do Python, um `float8` do PostgreSQL, um `double` do Java, ou um `number` do JavaScript, porque os quatro usam o mesmo formato binary64.

### Veja acontecendo: somando duas aproximações, não dois decimais

`0.1 + 0.2` não soma os decimais `0.1` e `0.2`: soma o que quer que o binary64 de fato armazenou para cada um deles, e *essa* soma é o que é impresso:

```viz
type: moves
mark 0 | "0.1" é armazenado como 0.1000000000000000055511151231257827021181583404541015625, o valor binary64 mais próximo, não o decimal exato.
mark 1 | "0.2" é armazenado como 0.200000000000000011102230246251565404236316680908203125, também não exato.
mark 2 | Somar as duas aproximações armazenadas dá 0.3000000000000000444089209850062616169452667236328125, que imprime como 0.30000000000000004, não 0.3.
---
0.1
0.2
sum
```

A aritmética em si não cometeu nenhum erro de arredondamento; as duas entradas já estavam erradas antes de o `+` rodar, e somar dois números levemente errados não consegue produzir um exatamente certo.

### "Arredondar no final" ganha de "arredondar a cada passo", mas não é uma regra universal

Um conserto tentador é arredondar depois de todo cálculo:

```js
(0.1 + 0.2).toFixed(2) // "0.30"
```

`toFixed` arredonda o valor já impreciso na memória: não recupera o decimal original, então ainda pode dar errado em valores exatamente numa fronteira de arredondamento. Pior é arredondar em *todo passo intermediário* de uma agregação grande. Dadas 10.000 linhas cada uma valendo `10.004`:

```text
value → round to 2 places → sum      -- 10,000 independent rounding decisions
sum all values → round once          -- 1 rounding decision
```

A primeira forma toma a mesma decisão direcional 10.000 vezes, o que pode acumular em uma deriva real e sistemática; a segunda a toma uma vez. Isso não é uma regra universal: regras fiscais e contábeis às vezes *exigem* arredondamento em passos intermediários específicos, mas arredondar ou truncar arbitrariamente a cada passo, sem nenhuma regra conduzindo isso, acumula viés sem motivo. Truncamento torna isso pior do que arredondamento: truncar `10.009` para duas casas dá `10.00`, enquanto arredondar dá `10.01`: repetido milhares de vezes, truncamento enviesa o total para baixo de um jeito que arredondamento não faz.

### Strings preservam dígitos mas não são um modelo numérico

Armazenar `"108.80"` como texto preserva os caracteres exatos, mas no momento em que o código precisa fazer aritmética nisso, precisa ser parseado de volta em um número:

```js
Number("108.80") // 108.8 — a float again, same problem as before
```

Uma string está bem para transporte ou exibição; não é um substituto para um tipo numérico que suporta adição, comparação, e regras de arredondamento.

### Unidades menores inteiras: dinheiro como um inteiro puro

Em vez de armazenar `10.99`, armazene `1099` (centavos) e faça toda operação como aritmética inteira:

```text
  1099   (10.99)
+  550   ( 5.50)
------
  1649   (16.49)
```

Não há `0.1 + 0.2` aqui: só inteiros, que é por que APIs de pagamento (Stripe, a maioria dos trilhos bancários) transacionam em unidades menores na comunicação. Duas coisas que isso não resolve de graça: nem toda moeda usa duas casas decimais (JPY tem zero, algumas moedas usam três), e divisão não distribui limpamente: `1099 / 3` não é um número inteiro de centavos, então o código ainda precisa decidir como alocar o resto (por exemplo, dar o centavo extra para a primeira ou última parcela).

### `NUMERIC`/`DECIMAL` no PostgreSQL, e `BigDecimal` no Java

`NUMERIC(precision, scale)` armazena um valor decimal exato, não uma aproximação binária:

```sql
create table invoice (
  id     bigserial primary key,
  total  numeric(10, 2) not null
);

insert into invoice (total) values (108.80);
select total = 108.80 from invoice; -- true, exactly
```

`FLOAT`/`DOUBLE PRECISION` na mesma tabela carregaria a mesma imprecisão binary64 descrita acima diretamente para comparações SQL.

O `double` do Java tem o problema idêntico, e `BigDecimal` é o conserto equivalente, mas só quando construído corretamente. `new BigDecimal(double)` converte a partir do *valor binário armazenado real* do `double`, reproduzindo a imprecisão em vez de curá-la:

```java
new BigDecimal(0.1);
// 0.1000000000000000055511151231257827021181583404541015625

new BigDecimal("0.1");     // exact — parses the decimal text directly
BigDecimal.valueOf(0.1);   // exact — routes through Double.toString() first
```

A regra prática: construa `BigDecimal` a partir de uma `String` ou uma unidade menor inteira, nunca a partir de um literal `double` que já perdeu precisão antes de o `BigDecimal` sequer vê-lo.

### A correção que importa: a matemática está certa, a representação é aproximada

"`19.90 × 100` não dá exatamente `1990`" é fácil de declarar descuidadamente. Matematicamente, `19.90 × 100 = 1990.00`, exatamente. O problema aparece só uma vez que `19.90` é representado como um `double`:

```text
19.90 (double) ≈ 19.899999999999998578914528479799628257751464843750
19.90 * 100    ≈ 1989.9999999999998
```

A multiplicação é aritmética correta sobre uma entrada já aproximada. A representação é o que é aproximado, não a matemática.

## Trade-offs

- **`float`/`double` são rápidos e compactos, mas nunca exatos para dinheiro**: a maioria das frações decimais não tem forma binária finita, então comparações de igualdade e totais correntes derivam silenciosamente.
  ```js
  0.1 + 0.2 === 0.3 // false
  ```
- **Strings são exatas de se olhar, mas não são um modelo numérico**: toda operação aritmética exige parsear de volta em um número, o que reintroduz o problema de float que se pretendia evitar.
- **Unidades menores inteiras são exatas e rápidas, mas empurram disciplina de unidade e arredondamento para todo pedaço de código que toca o valor**: uma moeda com um número diferente de casas decimais, ou uma divisão que não divide igualmente, ambas exigem uma decisão explícita que o próprio tipo inteiro não vai tomar por você.
- **`NUMERIC`/`DECIMAL` (e `BigDecimal` em código de aplicação) dão aritmética decimal exata de ponta a ponta, ao custo de velocidade e decisões de arredondamento explícitas**: `BigDecimal.divide` lança `ArithmeticException` em uma expansão decimal não terminante a menos que um `RoundingMode` (ou escala) seja fornecido, que é o tipo forçando você a tomar a mesma decisão de arredondamento que um `float` teria silenciosamente estragado por você.
  ```java
  new BigDecimal("10").divide(new BigDecimal("3")); // ArithmeticException: Non-terminating decimal expansion
  ```

## Documentation Links

- [PostgreSQL Documentation: Numeric Types (numeric, decimal, real, double precision)](https://www.postgresql.org/docs/current/datatype-numeric.html) - doc
- [Java SE 25 API: BigDecimal](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html) - doc
- [David Goldberg, "What Every Computer Scientist Should Know About Floating-Point Arithmetic" (hosted by Oracle)](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html) - doc
- [MDN: Number.prototype.toFixed()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/toFixed) - doc
