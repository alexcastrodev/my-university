---
version: 1.0
updatedAt: 2026-08-13
title: "GCD, Aritmética Modular e Exponenciação Modular Rápida"
description: "O algoritmo de Euclides para o GCD e sua forma estendida para calcular coeficientes de Bezout e inversos multiplicativos modulares, as propriedades de congruência que mantêm a aritmética modular limitada, e exponenciação modular via quadrados sucessivos — a recursão O(β), contra um O(2^β) ingênuo, que tanto RSA quanto Diffie-Hellman usam para elevar números grandes a potências grandes mod um primo grande."
---
## Objetivo

Entenda os três algoritmos teórico-numéricos que rodam silenciosamente por baixo de toda troca de chave RSA e handshake TLS: o algoritmo de Euclides para o máximo divisor comum, sua variante "estendida" para calcular inversos multiplicativos modulares, e exponenciação modular por quadrados sucessivos — mais as regras de aritmética modular que tornam os três práticos em números com centenas de dígitos.

## Casos de Uso

- Implementar ou revisar qualquer passo de geração de chave estilo RSA, onde o expoente privado é calculado como o inverso modular do expoente público — via o algoritmo de Euclides estendido — e entender por que esse passo é rápido em vez de uma busca por força bruta.
- Reconhecer `a.modPow(b, n)` (o método `BigInteger` do Java) ou qualquer helper de "exponenciação rápida" / "exponenciação binária" em um código como uma implementação da mesma recursão de quadrados sucessivos, para que um `for` ingênuo de `b` multiplicações não seja proposto como uma substituição "mais simples".
- Explicar por que código criptográfico e de hashing reduz valores intermediários `mod n` a cada passo em vez de calcular primeiro um resultado exato enorme — as propriedades de congruência da aritmética modular garantem que isso é seguro, e é a única forma de impedir que os números estourem durante um cálculo que, de outra forma, produziria um resultado de milhares de bits.

## Aprofundamento

### O algoritmo de Euclides: gcd via `gcd(a, b) = gcd(b, a mod b)`

O algoritmo de Euclides (o `EUCLID` de Cormen, remontando aos *Elementos* de Euclides, por volta de 300 a.C.) calcula o máximo divisor comum com uma recursão de duas linhas:

```java
static long gcd(long a, long b) {
    return b == 0 ? a : gcd(b, a % b);
}
```

Ele funciona por causa de um fato não óbvio — o teorema de recursão de GCD de Cormen:

> Para qualquer inteiro não negativo `a` e qualquer inteiro positivo `b`, `gcd(a, b) = gcd(b, a mod b)`.

A justificativa é curta: escreva `a mod b = a - q·b` onde `q = ⌊a/b⌋`. Como `a mod b` é uma combinação linear de `a` e `b`, qualquer divisor comum de `a` e `b` também divide `a mod b` — então é um divisor comum de `b` e `a mod b` também. Simetricamente, como `a = q·b + (a mod b)`, qualquer divisor comum de `b` e `a mod b` também divide `a`. Os dois pares `{a, b}` e `{b, a mod b}` têm, portanto, *exatamente o mesmo conjunto de divisores comuns*, então seus máximos divisores comuns são iguais. O caso base `gcd(a, 0) = a` é imediato. Como o segundo argumento diminui estritamente (e permanece não negativo) a cada chamada, a recursão sempre termina com a resposta correta.

Por exemplo, `gcd(30, 21)` se desenrola como `gcd(30,21) = gcd(21,9) = gcd(9,3) = gcd(3,0) = 3` — três chamadas recursivas.

Isso é dramaticamente mais rápido que a abordagem ingênua de testar todo inteiro até `min(a, b)` como candidato a divisor, que é `O(min(a, b))`. Cormen prova (teorema de Lamé, Teorema 31.11) que o número de chamadas recursivas de `EUCLID(a, b)` é `O(log b)`, e por extensão `O(log(min(a, b)))` — uma chamada em dois números de β bits realiza `O(β)` operações aritméticas. A prova passa pelos números de Fibonacci: Cormen mostra que se `EUCLID(a, b)` faz `k` chamadas recursivas, então `a ≥ F_{k+2}` e `b ≥ F_{k+1}`, e — crucialmente — que esse limite é *justo*: a chamada `EUCLID(F_{k+1}, F_k)` sobre dois **números de Fibonacci consecutivos** faz exatamente `k - 1` chamadas recursivas, batendo exatamente com o limite superior. Números de Fibonacci consecutivos são, portanto, o pior caso genuíno de entrada para o algoritmo de Euclides para seu tamanho — não só um folclore, mas o caso que a própria prova de justeza de Cormen constrói.

### O algoritmo de Euclides estendido e inversos modulares

Reescrever o algoritmo de Euclides para também rastrear dois coeficientes inteiros dá mais que o gcd — dá a **identidade de Bezout**:

> Para quaisquer inteiros não negativos `a` e `b`, existem inteiros `x` e `y` tais que `d = gcd(a, b) = a·x + b·y`.

O `EXTENDED-EUCLID` de Cormen calcula a tripla `(d, x, y)` diretamente, desenrolando a recursão um nível e reescrevendo a solução interna em termos das entradas externas:

```java
record Bezout(long d, long x, long y) {}

static Bezout extendedGcd(long a, long b) {
    if (b == 0) {
        return new Bezout(a, 1, 0);
    }
    Bezout inner = extendedGcd(b, a % b);          // d = b*x' + (a mod b)*y'
    long q = a / b;
    return new Bezout(inner.d(), inner.y(), inner.x() - q * inner.y());
}
```

Traçando `extendedGcd(99, 78)` (o próprio exemplo trabalhado de Cormen) nível por nível:

| a | b | ⌊a/b⌋ | d | x | y |
|---|---|-------|---|-----|-----|
| 99 | 78 | 1 | 3 | -11 | 14 |
| 78 | 21 | 3 | 3 | 3 | -11 |
| 21 | 15 | 1 | 3 | -2 | 3 |
| 15 | 6 | 2 | 3 | 1 | -2 |
| 6 | 3 | 2 | 3 | 0 | 1 |
| 3 | 0 | — | 3 | 1 | 0 |

A linha do topo é a resposta final: `extendedGcd(99, 78) = (3, -11, 14)`, e de fato `99×(-11) + 78×14 = -1089 + 1092 = 3`. Como `EXTENDED-EUCLID` faz exatamente tantas chamadas recursivas quanto o `EUCLID` simples, tem o mesmo tempo de execução `O(log(min(a,b)))` — os coeficientes de Bezout vêm essencialmente de graça.

Essa é a ferramenta que torna computáveis os **inversos multiplicativos modulares**. Se `gcd(a, n) = 1`, a identidade de Bezout dá `a·x + n·y = 1`, que lida módulo `n` é `a·x ≡ 1 (mod n)` — exatamente a definição de `x` ser o inverso multiplicativo de `a` mod `n`. Por exemplo, `extendedGcd(5, 11)` retorna `(1, -2, 1)`, então `5×(-2) + 11×1 = 1`, e reduzindo `-2` para `[0, n)` dá `5⁻¹ mod 11 = 9` (confira: `5×9 = 45 = 4×11 + 1`). Esse é *o* uso real e praticamente importante do algoritmo estendido: a **geração de chave RSA** calcula o expoente privado como o inverso modular do expoente público, mod `φ(n)`, usando exatamente esse algoritmo — não uma busca.

```java
static long modInverse(long a, long n) {
    Bezout b = extendedGcd(a, n);
    if (b.d() != 1) {
        throw new ArithmeticException(a + " has no inverse mod " + n);
    }
    return ((b.x() % n) + n) % n; // normaliza para [0, n)
}
```

### Aritmética modular e exponenciação rápida por quadrados sucessivos

Aritmética modular se comporta como aritmética "de relógio" comum sobre o conjunto finito `Z_n = {0, 1, ..., n-1}`: todo resultado é substituído por seu representante nesse intervalo. A razão pela qual cálculos criptográficos e de hashing conseguem trabalhar inteiramente dentro desse universo finito — em vez de deixar valores intermediários crescerem a milhares de dígitos — é que a congruência é preservada sob adição e multiplicação:

> Se `a ≡ b (mod n)` e `c ≡ d (mod n)`, então `a + c ≡ b + d (mod n)` e `a·c ≡ b·d (mod n)`.

Esse único fato licencia reduzir `mod n` depois de *cada* passo intermediário de um cálculo, em vez de só no final — a resposta final é idêntica de qualquer forma, mas os números envolvidos nunca crescem além de `n²` em tamanho. É isso que mantém aritmética `long`/`BigInteger` tratável para números com centenas de dígitos.

A **exponenciação modular** — calcular `aᵇ mod n` — é onde isso compensa mais. O `MODULAR-EXPONENTIATION` de Cormen explora a própria estrutura recursiva da exponenciação:

```
aᵇ = 1                se b == 0
aᵇ = (a^(b/2))²        se b > 0 e b é par
aᵇ = a · a^(b-1)       se b > 0 e b é ímpar
```

traduzida diretamente para Java, reduzindo mod `n` a cada passo:

```java
static long modPow(long a, long b, long n) {
    if (b == 0) {
        return 1;
    } else if (b % 2 == 0) {
        long d = modPow(a, b / 2, n);
        return (d * d) % n;
    } else {
        long d = modPow(a, b - 1, n);
        return (a * d) % n;
    }
}
```

O contraste de complexidade é o ponto inteiro. Para um expoente `b` de β bits, há entre `β` e `2β - 1` chamadas recursivas, então isso roda em `O(β)` operações aritméticas (`O(β³)` operações de bit, já que multiplicar dois números de β bits custa `O(β²)` operações de bit). A alternativa ingênua — `b - 1` multiplicações sucessivas por `a` — é `O(b)` operações aritméticas, e como `b` é um número de β bits, `b` em si pode ser tão grande quanto `2^β - 1`. Isso é `O(2^β)`: **exponencial** no comprimento em bits, contra o `O(β)` linear dos quadrados sucessivos. Para um expoente RSA de 2048 bits, isso é a diferença entre aproximadamente 2.048 multiplicações e aproximadamente 2²⁰⁴⁸ delas — a abordagem ingênua não é só mais lenta, é fisicamente incomputável.

Cormen traça `MODULAR-EXPONENTIATION(7, 560, 561)` à mão; a recursão se desenrola assim (`d` é o valor retornado pela subchamada recursiva um nível mais fundo; "retornado" é o que a linha daquele nível devolve para quem a chamou):

| b (esta chamada) | d (resultado da subchamada) | retornado |
|---|---|---|
| 560 | 67 | 1 |
| 280 | 166 | 67 |
| 140 | 298 | 166 |
| 70 | 241 | 298 |
| 35 | 355 | 241 |
| 34 | 160 | 355 |
| 17 | 103 | 160 |
| 16 | 526 | 103 |
| 8 | 157 | 526 |
| 4 | 49 | 157 |
| 2 | 7 | 49 |
| 1 | 1 | 7 |
| 0 | — | 1 |

Lendo de baixo para cima (a ordem real de execução — chamada mais funda primeiro): `modPow(7, 0, 561) = 1`, depois elevando ao quadrado/multiplicando de volta subindo por cada nível, até a chamada mais externa `modPow(7, 560, 561)` retornar `1`. Treze chamadas recursivas no total para um expoente de 10 bits — consistente com o limite `O(β)` — contra 559 multiplicações para a abordagem ingênua.

### O ganho prático: RSA e Diffie-Hellman

Nada disso é acadêmico. **RSA**, tanto na criptografia quanto na decriptografia, *é*, computacionalmente, uma única chamada a exponenciação modular — encriptar uma mensagem `m` sob a chave pública `(e, n)` calcula `mᵉ mod n`, e decriptar calcula `c^d mod n`; ambos são exatamente a recursão `MODULAR-EXPONENTIATION` acima, com `e`, `d` e `n` com centenas ou milhares de bits de comprimento. A **troca de chave Diffie-Hellman** calcula segredos compartilhados da mesma forma — cada parte eleva uma base pública grande ao seu próprio expoente secreto, mod um primo grande, e os quadrados sucessivos são o que torna isso instantâneo em vez de astronomicamente lento. No lado da geração de chave, RSA calcula o expoente privado `d` como o inverso modular do expoente público `e` mod `φ(n)` — precisamente o trabalho do algoritmo de Euclides estendido. Esses três algoritmos, não alguma maquinaria mais exótica, são o verdadeiro motor aritmético por trás dos dois protocolos.

## Trade-offs

- **`long` estoura muito antes de alcançar tamanhos criptográficos reais** — módulos RSA têm 2048+ bits, bem além dos 64 bits do `long`. O Java recursivo acima é correto e pedagogicamente exato, mas código de produção usa `java.math.BigInteger`, cujo próprio método `modPow` implementa esse mesmo algoritmo de quadrados sucessivos (com otimizações adicionais como redução de Montgomery) sobre inteiros de precisão arbitrária.
- **O `(x, y)` do Euclides estendido é *uma* solução para a identidade de Bezout, não *a* canônica** — podem ser negativos, e não são únicos (qualquer par `x + k·(n/d)`, `y - k·(a/d)` também funciona). Sempre normalize um inverso calculado para `[0, n)` com `((x % n) + n) % n` antes de usá-lo — passar adiante um "inverso" negativo cru é um bug comum e silencioso.
- **A tradução recursiva limpa do `MODULAR-EXPONENTIATION` ainda custa um stack frame por nível** — assintoticamente ótimo em `O(β)` multiplicações, mas implementações reais (incluindo `BigInteger.modPow` e OpenSSL) usam uma varredura de bit iterativa, da esquerda para a direita ou da direita para a esquerda, em vez de recursão, evitando overhead de chamada para expoentes que podem ter milhares de bits.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, "Introduction to Algorithms", 4ª Edição (MIT Press, 2022) — Capítulo 31 "Number-Theoretic Algorithms", Seções 31.2 "Greatest common divisor", 31.3 "Modular arithmetic", e a parte de exponenciação por quadrados sucessivos da 31.6 "Powers of an element", pp. 911-924, 932-936 — book
- [Java Platform SE — `BigInteger.modPow(BigInteger, BigInteger)`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigInteger.html#modPow(java.math.BigInteger,java.math.BigInteger)) — doc
