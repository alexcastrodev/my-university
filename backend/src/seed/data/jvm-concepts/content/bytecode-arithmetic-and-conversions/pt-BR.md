---
version: 1.0
updatedAt: 2026-08-19
title: "Bytecode: Operand Stack, Aritmética e Conversões de Tipo"
summary: "Como funciona a aritmética em stack machine do bytecode — os prefixos i/l/f/d, por que comparações de float e double precisam de dois opcodes para tratar NaN corretamente, e por que conversões de estreitamento como d2i e i2b perdem dados silenciosamente em vez de lançar exceção."
---
## Objective

Entender como o JVM realmente executa uma expressão como `a + b`: bytecode é um conjunto de instruções de **stack machine**, não de register machine — toda instrução de aritmética, comparação ou conversão desempilha (pop) seus operandos do topo da `operand stack` e empilha (push) o resultado de volta. Reconhecer o que cada mnemônico de instrução opera a partir da letra de prefixo (`i`, `l`, `f`, `d`, ...), e saber onde a aritmética do JVM diverge silenciosamente do que o source Java prometeu — truncamento silencioso em conversões de estreitamento, e dois opcodes de comparação diferentes só para tratar `NaN` corretamente.

## Use Cases

- Ler a saída de `javap -c` linha por linha para ver exatamente quais operações de stack uma linha de código Java virou.
- Explicar por que um cast de estreitamento como `(int) someHugeDouble` nunca lança exceção, mas silenciosamente retorna um valor clampado ou "wrappado".
- Entender por que o compilador emite `dcmpg` para um operador de comparação e `dcmpl` para outro nos mesmos dois `double`s — não é arbitrário, é assim que `NaN` é feito para comparar como "não maior" e "não menor" simultaneamente.
- Reconhecer que `boolean` não tem nenhuma instrução de bytecode dedicada — `&&`, `||` e aritmética de `Boolean` compilam para opcodes simples de `int`.

## Deep Dive

### A operand stack e a convenção de nomenclatura dos mnemônicos

O JVM não tem registradores de propósito geral para aritmética. Toda instrução que computa algo pega seus inputs da **operand stack** — uma stack por frame para a qual o atributo `Code` declara uma profundidade máxima (`stack=2` no exemplo abaixo) — e empilha o resultado de volta nela.

Os mnemônicos de bytecode codificam o tipo em que operam como uma letra de prefixo:

| prefixo | tipo | exemplo |
|---|---|---|
| `i` | `int` (também `boolean`, `byte`, `short`, `char` em runtime) | `iadd`, `iload` |
| `l` | `long` | `ladd`, `lload` |
| `f` | `float` | `fadd`, `fload` |
| `d` | `double` | `dadd`, `dload` |
| `a` | referência a objeto | `aload`, `areturn` |

Dado:

```java
public class Arith {
    public static void main(String[] args) {
        int a = 5;
        int b = 7;
        int result = a + b;
        System.out.println("Result: " + result);
    }
}
```

`javap -c Arith.class` mostra a soma como três operações de stack, não uma:

```
5: iload_1        // push local variable 'a' onto the stack
6: iload_2        // push local variable 'b' onto the stack
7: iadd            // pop both, push their sum
8: istore_3        // pop the sum, store it into local variable 'result'
```

`iadd` nunca enxerga `a` ou `b` como variáveis nomeadas — ele só enxerga "os dois valores no topo da stack", que é exatamente o que torna o instruction set compacto: um único opcode `iadd` trata qualquer par possível de inputs `int`.

### Instruções aritméticas: add, sub, mul, div, rem, neg

Cada operação aritmética existe uma vez por tipo numérico, seguindo a mesma convenção de prefixo — não há uma única instrução genérica de "add" que o JVM type-checa em runtime:

```
iadd / ladd / fadd / dadd    →  addition
isub / lsub / fsub / dsub    →  subtraction (second value subtracted from first)
imul / lmul / fmul / dmul    →  multiplication
idiv / ldiv / fdiv / ddiv    →  division (first divided by second)
irem / lrem / frem / drem    →  remainder of division
ineg / lneg / fneg / dneg    →  negation (sign flip)
```

`idiv` e `irem` são as únicas instruções aritméticas que podem lançar exceção em runtime — dividir por zero com tipos inteiros levanta `ArithmeticException`, enquanto a mesma operação com `fdiv`/`ddiv` produz `Infinity` ou `NaN` em vez disso, conforme IEEE 754.

### Bitwise, shift e boolean-como-int

Instruções bitwise (`iand`, `ior`, `ixor` e suas contrapartes `l`-prefixadas para long) e de shift (`ishl`, `ishr`, `iushr`, `lshl`, `lshr`, `lushr`) só existem para tipos inteiros — não há `fand` ou `dshl`, já que manipulação bitwise de padrões de bits de ponto flutuante não é uma operação existente no nível do source.

`boolean` **não tem nenhuma instrução de bytecode dedicada**. O JVM representa `true`/`false` como `int` `1`/`0`, então os operadores lógicos do Java reaproveitam o instruction set inteiro:

```java
boolean flag = x && y;   // compiles using iand-family logic, not a distinct "boolean and"
```

É por isso que bytecode decompilado ou escrito à mão não consegue distinguir "um `int` contendo `1`" de "um `boolean` contendo `true`" — a distinção existe só nos descriptors de method/field do constant pool (`Z` para `boolean` vs `I` para `int`), não na aritmética em si.

### Instruções de comparação e NaN

`lcmp` (long), `fcmpg`/`fcmpl` (float) e `dcmpg`/`dcmpl` (double) todos reduzem uma comparação a um único `int` na stack: `1`, `0` ou `-1` para maior, igual ou menor. `long` só precisa de uma variante porque inteiros não têm `NaN`. Tipos de ponto flutuante precisam de **duas**, porque `NaN` não compara como maior, menor nem igual a nada — nem a si mesmo — e o sufixo *g*/*l* decide o que um operando `NaN` avalia:

```java
public static boolean isGreater(double x, double y) { return x > y; }  // uses dcmpl
public static boolean isLess(double x, double y)    { return x < y; }  // uses dcmpg
```

```
public static boolean isGreater(double, double);
    dload_0
    dload_2
    dcmpl          // NaN → -1, so the following ifle branches to "false"
    ifle          10
    ...

public static boolean isLess(double, double);
    dload_0
    dload_2
    dcmpg          // NaN → 1, so the following ifge branches to "false"
    ifge          10
    ...
```

O compilador sempre pareia `>`/`>=` com `cmpl` e `<`/`<=` com `cmpg`, especificamente para que qualquer comparação envolvendo `NaN` avalie como `false`, batendo com a semântica IEEE 754 em vez de "maior ou menor por padrão".

### Conversões de valor e perda de precisão

Conversões de widening (`i2l`, `i2f`, `i2d`, `l2f`, `l2d`, `f2d`) nunca perdem informação e nunca lançam exceção. Conversões de narrowing (`l2i`, `f2i`, `f2l`, `d2i`, `d2l`, `d2f`, e o trio de inteiros pequenos `i2b`, `i2s`, `i2c`) podem perder informação — e o fazem **silenciosamente**, sem nenhuma exceção:

```java
double big = 1e20;
int truncated = (int) big;        // d2i
byte narrowed = (byte) 200;       // i2b
```

```
ldc2_w   #7      // double 1.0E20d
dstore_1
dload_1
d2i               // out of int range → clamps to Integer.MAX_VALUE, not an exception
istore_3
...
sipush  200
istore  4
iload   4
i2b               // 200 doesn't fit in a signed byte → wraps to -56
istore  5
```

`truncated` imprime `2147483647` (`d2i` num valor fora do range clampa para o `int` representável mais próximo, conforme a spec do JVM — nunca dá wrap nem lança exceção), enquanto `narrowed` imprime `-56` (`i2b` trunca para os 8 bits menos significativos e reinterpreta o bit de sinal, então `200` dá wrap para um `byte` negativo). Ambos são resultados legais de um cast legal — o sistema de tipos permitiu o narrowing, então nada a jusante é notificado de que dados foram perdidos.

## Trade-offs

- **Instruções stack-based vs. uma register machine** — todo operando precisa ser explicitamente empilhado antes de uma operação e o resultado explicitamente armazenado depois (quatro instruções para uma única soma, como mostrado acima), trocando uma contagem maior de instruções por um instruction set menor e mais simples, trivial de verificar e que não precisa de informação de alocação de registradores embutida no class file.
- **Conversões de narrowing nunca lançam exceção** — `d2i`, `i2b` e afins sempre produzem *algum* valor em vez de falhar, o que significa que um cast ruim é um bug silencioso de corretude em vez de um stack trace apontando para o local do cast.

```java
byte b = (byte) 200;   // -56, no exception — verify ranges before narrowing, don't rely on a cast to catch it
```

- **Corretude de `NaN` custa um opcode extra por tipo de comparação** — `fcmpg`/`fcmpl` e `dcmpg`/`dcmpl` existem em pares puramente para que o compilador possa fazer cada operador de comparação se comportar corretamente quando um operando é `NaN`, ao custo de o compilador ter que escolher o certo para cada operador em vez de reaproveitar uma única instrução `cmp`.
- **`boolean` é `int` por baixo dos panos, sem distinção em runtime** — isso mantém o instruction set pequeno (sem uma família separada de aritmética booleana para especificar e verificar), mas também significa que as garantias do bytecode verifier sobre valores `boolean` dependem inteiramente de type checking no nível do descriptor (o descriptor `Z`), não de nenhuma tag no nível do bytecode que o distinga de `int`.

## Documentation Links

- [Chapter 6: The Java Virtual Machine Instruction Set — Java Virtual Machine Specification, SE 25](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-6.html) — doc
- [javap — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/javap.html) — doc
- [Mastering the Java Virtual Machine — Chapter 3 source code (Packt Publishing)](https://github.com/PacktPublishing/Mastering-the-Java-Virtual-Machine/tree/main/chapter-03) — doc
