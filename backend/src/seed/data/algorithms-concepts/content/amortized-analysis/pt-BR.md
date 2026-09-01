---
version: 1.0
updatedAt: 2026-08-13
title: "Análise Amortizada: Métodos Agregado, Contábil e Potencial"
description: "Aprenda a provar um limite rigoroso de pior caso para o custo médio de uma operação ao longo de qualquer sequência de operações, mesmo quando uma única operação é cara — os métodos agregado, contábil e potencial usados para justificar afirmações como ArrayList.add ser O(1) amortizado, e por que amortizado é uma garantia mais forte e diferente de caso médio."
---
## Objetivo

Aprenda a provar um limite *de pior caso* rigoroso sobre o custo médio de uma operação ao longo de qualquer sequência de operações, mesmo quando uma única operação na sequência pode ser cara — a técnica que explica por que "resize dobra o array, então inserção às vezes não é O(N)?" ainda deixa `ArrayList.add` corretamente descrito como O(1) amortizado, e dá a você três métodos formais (agregado, contábil, potencial) para provar limites como esse você mesmo, em vez de apenas afirmá-los sem justificar.

## Casos de Uso

- Justificar a afirmação "`ArrayList.add` é O(1) amortizado" com precisão, em vez de citá-la sem conseguir defendê-la contra "mas e quanto ao resize?"
- Provar que a performance *da sequência* de uma estrutura de dados é boa mesmo quando operações individuais têm custos muito diferentes — arrays dinâmicos, hashing incremental, splay trees, union-find com compressão de caminho.
- Reconhecer, em uma code review ou discussão de design, quando alguém confundiu "amortizado" com "caso médio" — soam parecidos mas são garantias diferentes, e só uma delas sobrevive a entrada adversária.

## Aprofundamento

### Amortizado vs. caso médio: uma garantia de pior caso, não uma probabilidade

Esses dois termos são confundidos constantemente, e Cormen et al. têm o cuidado de separá-los porque a diferença é estrutural:

- **Análise de caso médio** assume uma distribuição de probabilidade sobre *entradas* (ex.: "assuma que chaves são inseridas em ordem aleatória") e limita o custo *esperado*. Ela não diz nada sobre o que acontece com uma entrada escolhida adversariamente — uma entrada patológica ainda pode estourar o limite.
- **Análise amortizada** não assume nenhuma distribuição de entrada. Ela limita o custo *total* de qualquer sequência de `N` operações — escolhidas por um adversário, em qualquer ordem — e divide por `N`. O resultado é uma garantia de pior caso sobre o custo médio por operação, sobre *toda* sequência possível, não só as típicas.

Então "O(1) amortizado" é estritamente mais forte que "O(1) em caso médio assumindo entrada aleatória": vale mesmo que toda operação da sequência seja deliberadamente escolhida para ser o pior possível, porque o *objetivo* da prova é mostrar que operações caras não podem acontecer com frequência suficiente, nem podem ser posicionadas de forma densa o bastante, para quebrar o limite — não importa como a sequência seja escolhida.

### Exemplo motivador: um array dinâmico que dobra

O exemplo canônico — e o usado ao longo deste concept — é um array dinâmico (o `ArrayList` do Java, conceitualmente) que começa vazio e dobra sua capacidade sempre que uma inserção transbordaria:

```java
// Modelo simplificado da estratégia de crescimento do ArrayList (o ArrayList real
// cresce ~1,5x; o argumento amortizado vale para qualquer fator de crescimento constante > 1).
class DynamicArray {
    private Object[] table = new Object[0];
    private int size = 0;

    void insert(Object x) {
        if (size == table.length) {
            int newCapacity = (table.length == 0) ? 1 : table.length * 2;
            table = Arrays.copyOf(table, newCapacity); // O(tamanho atual) — copia cada elemento
        }
        table[size++] = x;
    }
}
```

Uma única chamada a `insert` que dispara um resize custa `Θ(size)` — todo elemento existente é copiado. Isolada, essa chamada parece deixar `insert` em `O(N)` no pior caso. Mas essa operação cara só pode acontecer quando o array *exatamente* encheu, e como a capacidade acabou de dobrar da última vez que encheu, pelo menos metade da capacidade atual em inserções baratas `O(1)` precisou acontecer desde o resize anterior. A operação cara é rara precisamente *porque* foi cara da última vez — essa relação autolimitante é o que a análise amortizada torna precisa.

Traçando `insert` em um array inicialmente vazio, capacidade começando em 0 e dobrando (1, 2, 4, 8, …), o custo real do `i`-ésimo insert é `i` quando `i − 1` é uma potência exata de 2 (um resize copia `i − 1` elementos antigos mais insere o novo), e `1` caso contrário:

| insert # (i) | capacidade antes | resize? | custo real cᵢ |
|---|---|---|---|
| 1 | 0 → 1 | sim (bootstrap) | 1 |
| 2 | 1 → 2 | sim | 2 |
| 3 | 2 → 4 | sim | 3 |
| 4 | 4 | não | 1 |
| 5 | 4 → 8 | sim | 5 |
| 6 | 8 | não | 1 |
| 7 | 8 | não | 1 |
| 8 | 8 | não | 1 |

Custo real total para 8 inserts: `1+2+3+1+5+1+1+1 = 15`, para uma média bruta de `15/8 ≈ 1,9` — já perto de constante, e a razão só melhora conforme a sequência cresce, porque os custos de resize formam uma fração cada vez menor de uma série geométrica. O resto deste Aprofundamento prova essa convergência para `O(1)` rigorosamente, de três formas diferentes, usando essa mesma tabela.

### O método agregado

A técnica mais direta: calcule um limite superior `T(N)` para o custo *total* de **qualquer** sequência de `N` operações, depois divida por `N`. Esse quociente é o custo amortizado atribuído a *toda* operação da sequência — o método agregado não distingue entre tipos de operação.

Para o array que dobra, some os custos reais diretamente. Todo insert custa pelo menos `1` (o elemento em si), contribuindo `N` no total. Além disso, resizes acontecem só quando o tamanho do array passa uma potência de 2, então os custos de resize formam a série geométrica `1 + 2 + 4 + ... + N/2 < N`. Então:

```
T(N) = N (uma unidade por insert) + (1 + 2 + 4 + ... + N/2)   [custos de resize]
     < N + N
     = 3N
```

Dividindo por `N` dá um custo amortizado por insert de `T(N)/N < 3 = O(1)`. Note que isso bate quase exatamente com a tabela trabalhada acima — `15 < 3 × 8 = 24` — o limite é deliberadamente frouxo (um limite superior), não uma igualdade exata.

O método agregado é o mais fácil de aplicar mas o menos flexível: ele só consegue dizer que o *mesmo* custo amortizado se aplica a toda operação da sequência, o que é ótimo aqui (toda chamada `insert` parece idêntica de fora) mas não funciona para estruturas de dados com vários tipos de operação que plausivelmente têm custos amortizados diferentes (o outro exemplo recorrente de Cormen, uma pilha com `PUSH`/`POP`/`MULTIPOP`, é exatamente esse caso).

### O método contábil

O método contábil atribui a cada operação uma **cobrança amortizada** — um preço fixo que você decide, que pode ser maior que o custo real da operação — e prova que, se toda operação for cobrada esse preço, os pagamentos sempre cobrem os custos reais. O excedente das operações sobrecobradas (baratas) se acumula como **crédito** guardado em objetos específicos da estrutura; operações subcobradas (caras) gastam esse crédito guardado em vez de exigi-lo do nada. O único invariante que você precisa manter: o saldo de crédito corrente nunca pode ficar negativo — se ficasse, algum prefixo da sequência teria custado mais do que foi cobrado, e o limite seria falso para esse prefixo.

Para o array que dobra, cobre de cada `insert` um valor fixo de **3 unidades**, dividido conceitualmente assim: `1` unidade paga a inserção deste elemento agora, `1` unidade é guardada como crédito *neste elemento* para prepagar sua própria cópia no próximo resize, e `1` unidade é guardada como crédito *em algum elemento existente* para prepagar *sua* cópia no próximo resize. Como um resize copia exatamente os elementos presentes naquele momento, e cada um deles foi creditado em `1` unidade por um insert posterior antes do resize acontecer, o resize é totalmente pago com o banco — nunca precisa cobrar nada extra do chamador.

Rodando a regra de cobrança-3 contra a tabela trabalhada (`saldoᵢ = saldoᵢ₋₁ + 3 − cᵢ`, `saldo₀ = 0`):

| i | custo real cᵢ | cobrança | saldo depois |
|---|---|---|---|
| 1 | 1 | 3 | 2 |
| 2 | 2 | 3 | 3 |
| 3 | 3 | 3 | 3 |
| 4 | 1 | 3 | 5 |
| 5 | 5 | 3 | 3 |
| 6 | 1 | 3 | 5 |
| 7 | 1 | 3 | 7 |
| 8 | 1 | 3 | 9 |

O saldo nunca cai abaixo de zero — inclusive em `i = 5`, o resize, onde o custo real (`5`) excede a cobrança (`3`) e o déficit é coberto inteiramente pelas `2` unidades já guardadas no banco. Essa é a prova: o total cobrado (`3 × 8 = 24`) é um limite superior válido para o custo real total (`15`), então o custo amortizado por operação é `3 = O(1)`.

### O método potencial

O método potencial é o mais geral dos três, e o mais usado na prática para estruturas mais complexas que uma pilha ou um contador. Em vez de rastrear crédito em objetos individuais, defina uma única **função de potencial** `Φ` que mapeia o estado *inteiro* atual da estrutura de dados para um número real — "energia armazenada" disponível para pagar operações caras futuras. O custo amortizado da `i`-ésima operação é definido como:

```
ĉᵢ = cᵢ + Φ(Dᵢ) − Φ(Dᵢ₋₁)        (custo real, mais a mudança de potencial que ele causou)
```

Somando ao longo de uma sequência inteira, os termos `Φ(Dᵢ)` telescopam:

```
Σ ĉᵢ = Σ cᵢ + Φ(Dₙ) − Φ(D₀)
```

Então, se `Φ(D₀) = 0` e `Φ(Dᵢ) ≥ 0` para todo `i` (o potencial nunca fica negativo), então `Σ ĉᵢ ≥ Σ cᵢ` — a soma dos custos amortizados é um limite superior válido para a soma dos custos reais, para *qualquer* sequência, que é exatamente o que a definição exige.

Para o array que dobra, a função de potencial de Cormen é `Φ(T) = 2 × num − capacidade`, onde `num` é a contagem de elementos e `capacidade` é o comprimento atual do array. Intuitivamente: ela é `0` logo depois de um resize (quando o array está exatamente meio cheio), e cresce `2` a cada insert barato subsequente, chegando exatamente a `capacidade` — o suficiente para prepagar totalmente a próxima cópia — justo quando o array enche de novo.

Aplicando `Φ` à tabela trabalhada (`num`, `capacidade` medidos *depois* de cada insert):

| i | num | capacidade | Φ = 2·num − capacidade |
|---|---|---|---|
| 0 | 0 | 0 | 0 |
| 1 | 1 | 1 | 1 |
| 2 | 2 | 2 | 2 |
| 3 | 3 | 4 | 2 |
| 4 | 4 | 4 | 4 |
| 5 | 5 | 8 | 2 |
| 6 | 6 | 8 | 4 |
| 7 | 7 | 8 | 6 |
| 8 | 8 | 8 | 8 |

Agora aplique `ĉᵢ = cᵢ + Φᵢ − Φᵢ₋₁` a uma operação barata e uma operação cara (de resize):

- **Insert barato, `i = 4`** (sem resize): custo real `c₄ = 1`, mudança de potencial `Φ₄ − Φ₃ = 4 − 2 = 2`. Custo amortizado `= 1 + 2 = 3`.
- **Insert caro, `i = 5`** (dispara o resize de capacidade 4 para 8): custo real `c₅ = 5`, mudança de potencial `Φ₅ − Φ₄ = 2 − 4 = −2`. Custo amortizado `= 5 + (−2) = 3`.

Ambos caem no mesmo custo amortizado de `3` — a *queda* de potencial na operação cara absorve exatamente o custo real extra, o mesmo papel que o crédito guardado teve no método contábil. (O primeiríssimo insert, `i = 1`, é um caso de borda menor — custo amortizado `2`, não `3`, porque cresce o array a partir da capacidade `0` em vez de dobrar um array existente — mas ainda é `O(1)` e não afeta o resultado assintótico.) Como `Φ` nunca fica negativo, o custo amortizado total ao longo de qualquer sequência limita superiormente o custo real total, dando o mesmo limite `O(1)` amortizado que os outros dois métodos — por uma técnica geral o suficiente para se estender a estruturas onde "guardar um crédito neste objeto" não é obviamente natural, que é exatamente por que é a mais usada na literatura.

### Onde isso importa na prática

Qualquer estrutura com um perfil de operação "ocasionalmente cara, geralmente barata" é candidata a análise amortizada, e várias aparecem constantemente na engenharia do dia a dia:

- **Arrays dinâmicos** — `java.util.ArrayList`, `std::vector` do C++, `list` do Python, slices do Go — todos dependem exatamente desse argumento de crescimento por dobramento (ou estilo 1,5x) para o `O(1)` amortizado documentado de `add`/`append`.
- **Resizing de hash table** — o concept irmão sobre hash tables (chaining e open addressing) deixa sua discussão de resizing dinâmico para este concept exatamente por isso: crescer o array de buckets de uma hash table é estruturalmente o mesmo problema de dobrar-e-copiar do array dinâmico acima, e os mesmos três métodos se aplicam diretamente.
- **Estruturas amortizadas em geral** — splay trees (método potencial, crédito atrelado a tamanhos de subárvore) e union-find com compressão de caminho (um argumento potencial mais elaborado) dependem de análise amortizada para limites que seriam falsos, ou muito mais difíceis de enunciar, como afirmações simples de pior-caso-por-operação.

## Trade-offs

- **Um limite amortizado não é uma garantia de latência por chamada** — "O(1) amortizado" significa que a *média* ao longo de uma longa sequência é constante, mas qualquer chamada individual ainda pode ser a cara. Um sistema sensível a latência (um callback de áudio em tempo real, um handler de requisição com um SLA rígido) pode ser quebrado exatamente pelo resize que o limite amortizado está ocupado provando ser "raro" — raro não é o mesmo que "nunca acontece no seu caminho crítico."
- **Os três métodos trocam rigor-por-esforço por flexibilidade** — o agregado é o mais rápido de aplicar mas força o mesmo custo amortizado sobre todo tipo de operação; o contábil é intuitivo (uma história de conta bancária) mas as cobranças são escolhidas de forma ad hoc e não dão orientação para estruturas mais complexas que uma pilha ou contador; o potencial é o que mais dá trabalho para montar (você precisa inventar um `Φ` correto) mas é o mais geral e composável, e é para onde você vai assim que "atribuir crédito a objetos individuais" deixa de ser um encaixe natural.
- **Escolher a função de potencial errada não dá só um limite pior, pode produzir uma prova falsa** — `Φ` nunca pode ficar negativo e precisa genuinamente capturar "capacidade armazenada para pagar o próximo passo caro," ou o argumento de soma telescópica silenciosamente deixa de ser válido; verificar `Φ(D₀) = 0` e `Φ(Dᵢ) ≥ 0` para todo `i` não é bookkeeping opcional, é a parte estrutural da prova.
- **Amortizado ≠ caso médio, e tratá-los como intercambiáveis é um bug real de raciocínio** — um limite amortizado vale para *toda* sequência adversária; um limite de caso médio só vale se a entrada de fato bater com a distribuição assumida. Código que é rápido "em média" sob uma suposição de entrada aleatória pode ser trivialmente quebrado por uma sequência de pior caso construída de propósito, de um jeito que código com limite amortizado não pode.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 16 "Amortized Analysis," Seções 16.1–16.3, pp. 447–459 — book
- [Oracle Java SE Documentation — ArrayList](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayList.html) — doc
