---
version: 1.0
updatedAt: 2026-08-17
title: "Algoritmos Online: Razão Competitiva, Move-to-Front e Caching"
description: "Como avaliar um algoritmo que precisa se comprometer com uma decisão antes de ver o resto da entrada — a razão competitiva, definida contra um algoritmo que conhece o futuro, aplicada à decisão elevador-versus-escada, à heurística de lista MOVE-TO-FRONT 4-competitiva, e ao caching online, onde LRU e FIFO são Θ(k), LIFO e LFU não têm limite, toda política determinística está presa a Ω(k), e RANDOMIZED-MARKING alcança O(lg k) contra um adversário oblivious."
---
## Objetivo

Aprenda a avaliar algoritmos que precisam se comprometer com uma decisão *antes* de ver o resto da entrada — despejo de cache, reordenação de lista, escolhas de esperar-ou-desistir — usando a **razão competitiva**, que mede um algoritmo online contra um algoritmo hipotético que conhece o futuro inteiro. Você vai trabalhar nos três problemas que Cormen et al. usam para construir a técnica: a decisão elevador-versus-escada (de onde vem a definição), a manutenção de lista MOVE-TO-FRONT (provadamente 4-competitiva), e o caching online (onde LRU e FIFO são Θ(k), LIFO e LFU são ilimitadamente ruins, *toda* política determinística está presa a Ω(k), e a randomização te leva a O(lg k)).

## Casos de Uso

- Escolher uma política de despejo para um cache limitado e conseguir defendê-la com um argumento de pior caso em vez de folclore — saber *por que* LRU e FIFO estão numa classe diferente de LIFO e LFU, não só que elas "parecem melhores".
- Reordenar a lista encadeada de um bucket numa hash table com encadeamento (a aplicação motivadora no livro, conectando de volta ao conceito de hash-tables-chaining-and-open-addressing) para que elementos quentes derivem para a frente, sem nenhum conhecimento prévio da distribuição de acessos e com um limite provado de quão ruim isso pode ficar.
- Reconhecer "espere pelo caminho rápido, mas recorra ao plano B depois de um tempo limitado" como uma estratégia de hedge deliberada com garantia provada, em vez de um timeout arbitrário — o problema do elevador é exatamente esse formato.
- Saber quando *parar* de ajustar uma heurística determinística: uma vez que você sabe que toda política determinística de caching tem razão competitiva Ω(k), uma regra de despejo determinística "mais esperta" proposta sempre pode ser derrotada por um adversário que conhece seu código, e a randomização é a única saída.

## Aprofundamento

### O que "online" significa, e a definição da razão competitiva

Um **algoritmo online** recebe sua entrada peça por peça e precisa agir em cada peça sem saber o que vem depois. O primeiro exemplo do livro é deliberadamente mundano: você entra num prédio e precisa chegar a um escritório `k` andares acima. Você sobe escadas a um andar por minuto, então as escadas sempre custam exatamente `k` minutos. O elevador sobe todos os `k` andares em apenas um minuto — mas você não sabe quanto tempo ele vai levar para chegar. Você sabe que ele chega em no máximo `B − 1` minutos (com `B` consideravelmente maior que `k`), e que o número de minutos que ele leva é um inteiro. Então esperar pelo elevador e subir nele custa de 1 minuto (ele já está aqui) a `(B − 1) + 1 = B` minutos no pior caso.

Compare-se com um **vidente** — um algoritmo que conhece o futuro. Sendo `m` o número de minutos até o elevador chegar, o vidente espera se e somente se esperar for mais barato, dando o custo:

```
t(m) = m + 1   se m ≤ k − 1
       k       se m ≥ k
```

Agora a definição da qual tudo mais depende. Seja `U` o conjunto (universo) de todas as entradas possíveis e considere alguma entrada `I ∈ U`. Para um problema de **minimização**, se um algoritmo online `A` produz uma solução com valor `A(I)` na entrada `I`, e um algoritmo `F` **que conhece o futuro** produz o valor `F(I)` na mesma entrada, então a razão competitiva de `A` é:

> **razão competitiva de `A` = max { A(I) / F(I) : I ∈ U }**

Se um algoritmo online tem razão competitiva `c`, dizemos que ele é **`c`-competitivo**. A razão competitiva é sempre pelo menos 1, e queremos que fique o mais próxima possível de 1.

Repare no que isso *não* é: não é uma média sobre entradas típicas, e não é um limite de custo absoluto. É a única pior razão, sobre toda entrada no universo, entre o que você paga e o que um vidente teria pago naquela mesma entrada.

Aqui a única entrada é `m`, o tempo de chegada do elevador. Três estratégias, em Java:

```java
// Todos os custos em minutos. k = andares a subir. O elevador leva m minutos para chegar
// (um inteiro com 0 <= m <= B - 1) e depois mais 1 minuto para te carregar por todos os k andares.

static int seer(int m, int k) {              // F: conhece m de antemão
    return (m <= k - 1) ? m + 1 : k;         // espera se e somente se esperar realmente vence as escadas
}

static int alwaysStairs(int m, int k)   { return k; }        // ignora o elevador completamente
static int alwaysElevator(int m, int k) { return m + 1; }    // espera o tempo que for necessário

// Razão competitiva = a PIOR razão sobre toda entrada m possível.
static double competitiveRatio(IntBinaryOperator online, int k, int B) {
    double worst = 0;
    for (int m = 0; m <= B - 1; m++) {
        worst = Math.max(worst, (double) online.applyAsInt(m, k) / seer(m, k));
    }
    return worst;
}
```

Enumerando `max { k / t(m) : 0 ≤ m ≤ B − 1 }` para "sempre pegar as escadas" dá as razões `k/1, k/2, k/3, …, k/(k−1), k/k, k/k, …`, cujo máximo é **`k`** — atingido quando o elevador chega imediatamente: você gasta `k` minutos nas escadas onde a solução ótima levou apenas 1.

Enumerando `max { (m + 1) / t(m) : 0 ≤ m ≤ B − 1 }` para "sempre pegar o elevador" dá `1/1, 2/2, …, k/k, (k+1)/k, (k+2)/k, …, B/k`, cujo máximo é **`B/k`** — atingido quando o elevador leva os `B − 1` minutos completos, contra a escolha do vidente de pegar as escadas a um custo de `k`.

Então com `k = 10` e `B = 300`, "sempre pegar as escadas" (razão 10) vence "sempre pegar o elevador" (razão 30). E o livro é cuidadoso quanto ao que isso *não* significa: pegar as escadas não é sempre melhor, nem sequer necessariamente melhor com mais frequência. Só se protege melhor contra o pior futuro possível.

### Hedge: uma razão que não depende dos parâmetros da entrada

Ambas são estratégias extremas. Você pode em vez disso **apostar dos dois lados**: espere pelo elevador por um tempo, e se ele não chegou, pegue as escadas. Seja "um tempo" igual a `k` minutos:

```java
static int hedge(int m, int k) {             // espera até k minutos, depois desiste e sobe
    return (m <= k) ? m + 1 : 2 * k;         // 2k = k minutos esperando + k minutos subindo
}

// Com k = 10, B = 300:
//   alwaysStairs   -> 10   ( = k,   pior em m = 0:     10 minutos vs. o 1 do vidente  )
//   alwaysElevator -> 30   ( = B/k, pior em m = B - 1: 300 minutos vs. o 10 do vidente )
//   hedge          ->  2   ( independente TANTO de k QUANTO de B )
```

Enumerando `max { h(m) / t(m) }` dá `1/1, 2/2, …, k/k, (k+1)/k, 2k/k, 2k/k, …, 2k/k`, cujo máximo é **2**. A razão competitiva agora é independente tanto de `k` quanto de `B` — uma garantia estritamente melhor que qualquer um dos extremos, e uma que não degrada conforme os parâmetros do problema crescem.

Isso ilustra a filosofia que percorre o capítulo inteiro: construa um algoritmo que se proteja contra *qualquer* pior caso possível. Esperar inicialmente pelo elevador se protege contra o caso em que ele chega rápido; trocar eventualmente para as escadas se protege contra o caso em que ele demora muito.

### Mantendo uma lista de busca: MOVE-TO-FRONT

O segundo problema é manter os elementos de uma lista encadeada numa boa ordem para busca. Isso aparece na prática em hash tables que resolvem colisões por encadeamento, já que cada slot contém uma lista encadeada — reordenar essa lista por slot pode aumentar mensuravelmente a performance de busca.

A configuração: uma lista duplamente encadeada `L` de `n` elementos, onde `r_L(x)` denota a posição do elemento `x` (com `1 ≤ r_L(x) ≤ n`), então uma busca por `x` leva tempo `Θ(r_L(x))`. Para facilitar a análise, o livro descarta a notação assintótica: **buscar o elemento na posição `i` custa exatamente `i`**, e o único jeito de reordenar é **trocando dois elementos adjacentes, a um custo de 1 por troca**. Então buscar o sexto elemento e depois movê-lo duas posições para frente custa `6 + 2 = 8`. O objetivo é minimizar o custo total de busca mais o número total de trocas.

Se você conhecesse a distribuição das requisições de busca de antemão, você só arrumaria a lista uma vez com os elementos buscados com frequência perto da frente. Se você não sabe nada, então não importa como você a arrume, toda busca poderia ser pelo elemento que está no final — tempo total `Θ(nm)` para `m` buscas. Mas algumas sequências são genuinamente "mais fáceis" que outras, então em vez de medir contra a pior sequência possível, meça contra o que um algoritmo *offline* ótimo faria conhecendo a sequência de antemão. Sequências difíceis são difíceis para o vidente também; sequências fáceis permitem que você se saia bem.

**MOVE-TO-FRONT(L, x)** busca por `x`, depois troca ele para frente uma posição de cada vez até chegar à frente. Chamar `MOVE-TO-FRONT(L, 8)` em `L = ⟨5, 3, 12, 4, 8, 9, 22⟩` produz `⟨8, 5, 3, 12, 4, 9, 22⟩`. Seu custo é `2·r_L(x) − 1`: `r_L(x)` para encontrar `x`, mais 1 para cada uma das `r_L(x) − 1` trocas que o levam até a frente.

```java
// Modelo de custo do livro: buscar o elemento na posição r (base 1) custa r,
// e toda troca de dois elementos ADJACENTES custa 1. Total: 2*r - 1.
static int moveToFront(List<Integer> list, int x) {
    int r = list.indexOf(x) + 1;              // posição base 1 = o custo de busca
    for (int i = r - 1; i > 0; i--) {         // exatamente r - 1 trocas adjacentes, custo 1 cada
        Collections.swap(list, i, i - 1);
    }
    return 2 * r - 1;
}
```

Aqui está o próprio exemplo resolvido do livro (Figura 27.1) traçado passo a passo — começando de `⟨1, 2, 3, 4, 5⟩` com buscas por 5, 3, 4 e 4. Todo passo abaixo é uma troca adjacente custando exatamente 1:

```viz
type: moves
mark 4 | Busca por 5: ele está na posição 5, então a busca sozinha custa 5.
swap 3 4 | Caminha "5" uma posição para frente (custo de troca 1).
swap 2 3 | Ainda caminhando "5" para frente.
swap 1 2 | Ainda caminhando "5" para frente.
swap 0 1 | "5" chega à frente. Custo da chamada = 2·5 − 1 = 9. A lista agora é ⟨5,1,2,3,4⟩.
mark 3 | Busca por 3: está na posição 4, então a busca custa 4.
swap 2 3 | Caminha "3" para frente (custo de troca 1).
swap 1 2 | Ainda caminhando "3" para frente.
swap 0 1 | "3" chega à frente. Custo da chamada = 2·4 − 1 = 7. Cumulativo 16. A lista é ⟨3,5,1,2,4⟩.
mark 4 | Busca por 4: ele foi empurrado para a posição 5, então a busca custa 5.
swap 3 4 | Caminha "4" para frente (custo de troca 1).
swap 2 3 | Ainda caminhando "4" para frente.
swap 1 2 | Ainda caminhando "4" para frente.
swap 0 1 | "4" chega à frente. Custo da chamada = 2·5 − 1 = 9. Cumulativo 25. A lista é ⟨4,3,5,1,2⟩.
mark 0 | Busca por 4 de novo: já está na frente. Custo 1, sem trocas. Cumulativo 26.
---
1
2
3
4
5
```

Contraste isso com **FORESEE**, o procedimento hipotético que conhece o futuro: ele também busca e reordena, mas depois de cada chamada ele rearranja otimamente sua lista para o que está por vir. Depois de buscar por 3, FORESEE move 4 para a frente, *pagando para mover um elemento antes de ele ser acessado* porque sabe que uma busca por 4 está prestes a acontecer. Ele paga um custo de troca de 3 nessa segunda chamada e depois nunca mais paga outro custo de troca:

| busca | lista de FORESEE antes | custo de busca + troca | cumulativo | lista de MOVE-TO-FRONT antes | custo de busca + troca | cumulativo |
|---|---|---|---|---|---|---|
| 5 | ⟨1,2,3,4,5⟩ | 5 + 0 = 5 | 5 | ⟨1,2,3,4,5⟩ | 5 + 4 = 9 | 9 |
| 3 | ⟨1,2,3,4,5⟩ | 3 + 3 = 6 | 11 | ⟨5,1,2,3,4⟩ | 4 + 3 = 7 | 16 |
| 4 | ⟨4,1,2,3,5⟩ | 1 + 0 = 1 | 12 | ⟨3,5,1,2,4⟩ | 5 + 4 = 9 | 25 |
| 4 | ⟨4,1,2,3,5⟩ | 1 + 0 = 1 | 13 | ⟨4,3,5,1,2⟩ | 1 + 0 = 1 | 26 |

Note que FORESEE e MOVE-TO-FRONT mantêm listas *diferentes* dos mesmos elementos, e pode haver mais de uma ordem ótima. Neste exemplo em particular MOVE-TO-FRONT custa mais a cada passo, mas isso não é necessariamente sempre o caso.

### Por que MOVE-TO-FRONT é 4-competitivo

A parte notável: podemos limitar o custo de MOVE-TO-FRONT em relação a FORESEE *sem saber quais trocas FORESEE executa*. A ferramenta é uma **inversão** — um par de elementos `a` e `b` onde `a` aparece antes de `b` numa lista mas `b` aparece antes de `a` na outra. Para duas listas `L` e `L'`, a **contagem de inversões** `I(L, L')` é o número de tais pares. Para `L = ⟨5, 3, 1, 4, 2⟩` e `L' = ⟨3, 1, 2, 4, 5⟩`, exatamente cinco dos dez pares — `(1,5)`, `(2,4)`, `(2,5)`, `(3,5)`, `(4,5)` — aparecem em ordens diferentes, então `I(L, L') = 5`.

O fato estrutural chave: se dois elementos *consecutivos* trocam de posição numa lista `L`, então para qualquer outra lista `L'`, o valor de `I(L, L')` aumenta 1 ou diminui 1 — porque o status de inversão do par trocado em relação a `L'` precisa se inverter, e nenhum outro par muda.

Sejam `L^M_i` e `L^F_i` as listas mantidas por MOVE-TO-FRONT e FORESEE imediatamente após a `i`-ésima busca, e `c^M_i`, `c^F_i` seus custos na `i`-ésima chamada. Não sabemos quantas trocas FORESEE executa; chame isso de `t_i`. Então para uma busca pelo elemento `x`:

```
c^M_i = 2 · r(L^M_{i−1}, x) − 1                (busca + todas as trocas até a frente)
c^F_i = r(L^F_{i−1}, x) + t_i                  (busca + quantas trocas FORESEE escolheu)
```

Agora particione os elementos por onde eles ficam em relação a `x` nas duas listas *antes* da `i`-ésima busca:

- `BB` = elementos antes de `x` em **ambas** `L^M_{i−1}` e `L^F_{i−1}`
- `BA` = elementos **a**ntes de `x` em `L^M_{i−1}` mas **a**pós `x` em `L^F_{i−1}`
- `AB` = elementos **a**pós `x` em `L^M_{i−1}` mas **a**ntes de `x` em `L^F_{i−1}`

o que dá imediatamente as duas posições em termos de tamanhos de conjunto:

```
r(L^M_{i−1}, x) = |BB| + |BA| + 1
r(L^F_{i−1}, x) = |BB| + |AB| + 1
```

MOVE-TO-FRONT executa `|BB| + |BA|` trocas (uma por elemento precedendo `x` em sua própria lista). Cada troca com um `y ∈ BB` coloca `x` antes de `y` em `L^M` enquanto `L^F` fica inalterada, *criando* uma inversão. Cada troca com um `z ∈ BA` coloca `x` antes de `z` em ambas as listas, *destruindo* uma. Então:

```
I(L^M_i, L^F_{i−1}) − I(L^M_{i−1}, L^F_{i−1}) = |BB| − |BA|
```

**Teorema 27.1: MOVE-TO-FRONT tem razão competitiva 4.** A prova é um argumento de função potencial, exatamente a técnica do conceito de amortized-analysis, com o potencial definido sobre a contagem de inversões:

```
Φ_i = 2 · I(L^M_i, L^F_i)
```

O fator de 2 codifica a intuição de que toda inversão representa um custo de 2 para MOVE-TO-FRONT em relação a FORESEE: 1 pela busca e 1 pela troca. Como a contagem de inversões é não negativa, `Φ_i ≥ 0` para todo `i`; e assumindo que ambos os algoritmos começam com a mesma lista, `Φ_0 = 0`, então `Φ_i ≥ Φ_0` para todo `i` — as duas condições que o método do potencial exige. O custo amortizado é `ĉ^M_i = c^M_i + Φ_i − Φ_{i−1}`, onde as próprias trocas de MOVE-TO-FRONT elevam o potencial por exatamente `2(|BB| − |BA|)` e as `t_i` trocas de FORESEE cada uma o move por ±2, então FORESEE contribui no máximo `2t_i`:

```
ĉ^M_i = c^M_i + Φ_i − Φ_{i−1}
      ≤ 2·r(L^M_{i−1}, x) − 1 + 2(|BB| − |BA| + t_i)
      = 2·r(L^M_{i−1}, x) − 1 + 2(|BB| − (r(L^M_{i−1}, x) − 1 − |BB|) + t_i)   [|BA| = r − 1 − |BB|]
      = 4|BB| + 1 + 2·t_i
      ≤ 4|BB| + 4|AB| + 4 + 4·t_i                                              [aumentando alguns termos]
      = 4(|BB| + |AB| + 1 + t_i)
      = 4(r(L^F_{i−1}, x) + t_i)
      = 4·c^F_i
```

Como `Φ_0 = 0` e `Φ` nunca fica negativo, o custo amortizado total limita superiormente o custo real total, então para qualquer sequência de `m` operações `Σ c^M_i ≤ Σ ĉ^M_i ≤ 4 · Σ c^F_i`. MOVE-TO-FRONT é 4-competitivo.

A técnica vale a pena internalizar além desse único resultado: relacionamos um algoritmo online a um ótimo capturando como uma propriedade em particular (aqui, trocas e as inversões que elas invertem) *precisa* evoluir em relação ao ótimo, sem nunca saber o que o ótimo de fato faz. Note também a semelhança de família que o livro aponta entre MOVE-TO-FRONT e a heurística de compressão de caminho por trás do conceito de union-find-disjoint-sets — embora compressão de caminho seja mais precisamente "move-to-next-to-front", e diferente de MOVE-TO-FRONT numa lista duplamente encadeada, ela pode realocar múltiplos elementos de uma vez.

### Caching online: as políticas determinísticas

O problema de caching: uma sequência de `n` requisições de memória para blocos `b_1, b_2, …, b_n` (não necessariamente distintos) chega, e um cache mantém até `k` blocos. Uma requisição por um bloco já em cache é um **cache hit** e deixa o cache inalterado; caso contrário é um **cache miss**, e se o cache já está cheio, algum bloco precisa ser **despejado** antes que o solicitado entre. Algoritmos de caching diferem *apenas* em qual bloco despejam num miss com o cache cheio. O objetivo é minimizar o total de misses. (Prefetching — trazer um bloco antes de sua requisição — está fora de escopo aqui.) Assuma `n > k`, que pelo menos `k` blocos distintos são requisitados, e que o cache começa vazio, então as primeiras `k` requisições são todas misses e nenhum despejo ocorre durante elas.

O livro lista quatro políticas online:

- **FIFO** — despeja o bloco que está no cache há mais tempo.
- **LIFO** — despeja o bloco que está no cache há menos tempo.
- **LRU (Least Recently Used)** — despeja o bloco cujo último uso está mais distante no passado.
- **LFU (Least Frequently Used)** — despeja o bloco acessado o menor número de vezes, quebrando empates escolhendo o bloco que está no cache há mais tempo.

Todas as quatro compartilham um único esqueleto e diferem num único comparador:

```java
final class BlockCache {
    private final int k;
    private final List<Integer> cached = new ArrayList<>();
    private final Map<Integer, Integer> enteredAt = new HashMap<>();  // quando o bloco entrou
    private final Map<Integer, Integer> lastUsed  = new HashMap<>();  // quando foi requisitado pela última vez
    private final Map<Integer, Integer> useCount  = new HashMap<>();  // quantas vezes foi requisitado
    private int clock = 0, misses = 0;

    BlockCache(int k) { this.k = k; }

    void request(int b) {
        clock++;
        if (cached.contains(b)) {                       // cache hit: cache fica inalterado
            lastUsed.put(b, clock);
            useCount.merge(b, 1, Integer::sum);
            return;
        }
        misses++;                                       // cache miss
        if (cached.size() == k) {                       // cheio: algo precisa sair
            int victim = chooseVictim();
            cached.remove(Integer.valueOf(victim));
            enteredAt.remove(victim); lastUsed.remove(victim); useCount.remove(victim);
        }
        cached.add(b);
        enteredAt.put(b, clock); lastUsed.put(b, clock); useCount.put(b, 1);
    }

    // A ÚNICA coisa que distingue as quatro políticas:
    //   FIFO -> Comparator.comparingInt(enteredAt::get)                      depois pega o min
    //   LIFO -> Comparator.comparingInt(enteredAt::get)                      depois pega o max
    //   LFU  -> comparingInt(useCount::get).thenComparingInt(enteredAt::get) depois pega o min
    //   LRU  -> Comparator.comparingInt(lastUsed::get)                       depois pega o min
    private int chooseVictim() {
        return Collections.min(cached, Comparator.comparingInt(lastUsed::get));   // LRU
    }

    int misses() { return misses; }
}
```

**Teorema 27.2: LIFO tem razão competitiva Θ(n/k).** Para o limite inferior, pegue `k + 1` blocos numerados `1..k+1` e a sequência de requisições `1, 2, 3, …, k, k+1, k, k+1, k, k+1, …` para `n` requisições no total. Depois das primeiras `k` requisições (todas misses) o cache contém `1..k`. A requisição por `k+1` despeja o bloco `k`, porque o bloco `k` está no cache há menos tempo. A requisição por `k` então despeja `k+1`, que acabou de ser colocado. Essa alternância continua, então **LIFO erra em toda uma das `n` requisições**. O algoritmo offline ótimo, na primeira requisição por `k+1`, despeja qualquer bloco *exceto* o bloco `k` e nunca mais despeja — total de misses `k + 1`. A razão é `n/(k+1)`, ou seja, `Ω(n/k)`. Para o limite superior: qualquer algoritmo incorre em no máximo `n` misses, e como pelo menos `k` blocos distintos são requisitados, *qualquer* algoritmo (incluindo o ótimo offline) incorre em pelo menos `k` misses — então a razão é `O(n/k)`.

Uma razão assim é chamada de **ilimitada**, porque cresce com o tamanho da entrada. O Exercício 27.3-2 pede para você mostrar que LFU também é ilimitada.

**Teorema 27.3: LRU tem razão competitiva O(k).** A prova divide a sequência de requisições em **épocas**: a época 1 começa com a primeira requisição, e a época `i` (para `i > 1`) começa ao encontrar a `(k+1)`-ésima requisição distinta desde o início da época `i − 1`. Para `k = 3` e a sequência

```
1, 2, 1, 5, 4, 4, 1, 2, 4, 2, 3, 4, 5, 2, 2, 1, 2, 2
```

as primeiras 3 requisições distintas são 1, 2 e 5, então a época 2 começa na primeira requisição por 4; dentro da época 2 as primeiras 3 requisições distintas são 4, 1 e 2, e a requisição por 3 abre a época 3. Resultam quatro épocas:

```
| 1, 2, 1, 5 | 4, 4, 1, 2, 4, 2 | 3, 4, 5 | 2, 2, 1, 2, 2 |
```

Dentro de uma época, a *primeira* requisição por um bloco pode dar miss, mas requisições subsequentes pelo mesmo bloco dentro da época não podem — o bloco agora está entre os `k` mais recentemente usados, então LRU não vai despejá-lo. Na época 2, a primeira requisição por 4 dá miss e as posteriores não; na época 3, os blocos 3 e 5 dão miss mas o bloco 4 não, porque foi acessado recentemente na época 2. Como só a primeira requisição de um bloco numa época pode dar miss e o cache mantém `k` blocos, **cada época incorre em no máximo `k` misses**. Enquanto isso, a primeira requisição de cada época precisa dar miss *mesmo para o algoritmo ótimo*, porque pela definição de uma época houve `k` outros blocos acessados desde o último acesso àquele bloco — então **o algoritmo ótimo incorre em pelo menos um miss por época**. Razão no máximo `k/1 = O(k)`. O Exercício 27.3-3 pede para você mostrar que FIFO também é `O(k)`.

A diferença entre `Θ(n/k)` e `Θ(k)` é exatamente a diferença que importa: `k` é fixado pelo seu hardware e não cresce conforme mais requisições chegam, enquanto uma razão que depende de `n` cresce sem limite conforme a sequência de requisições fica mais longa.

### A barreira Ω(k) da qual nenhuma política determinística escapa

Poderíamos provar limites inferiores `Ω(k)` especificamente para LRU e FIFO, mas uma afirmação muito mais forte vale: **qualquer** algoritmo de caching online determinístico tem razão competitiva `Ω(k)`. A prova usa um **adversário** que conhece o algoritmo online sendo usado e adapta requisições futuras contra ele.

Tamanho de cache `k`, blocos possíveis `{1, 2, …, k+1}`. As primeiras `k` requisições são por `1..k`, preenchendo ambos os caches. A próxima requisição é por `k+1`; para abrir espaço, o algoritmo online despeja algum bloco `b_1`. O adversário, sabendo disso, faz a próxima requisição ser `b_1`, forçando o despejo de algum `b_2`; a próxima requisição é `b_2`, forçando o despejo de `b_3`; e assim por diante. **O algoritmo online dá miss em toda requisição** — `n` misses em `n` requisições.

O algoritmo offline ótimo é o furthest-in-future: sempre despeje o bloco cuja próxima requisição está mais distante. Como só existem `k + 1` blocos distintos, sempre que furthest-in-future despeja um bloco, esse bloco não será acessado pelas próximas `k` requisições, no mínimo. Então depois dos `k` misses iniciais, ele erra no máximo uma vez a cada `k` requisições — no máximo `k + n/k` misses no total. A razão é, portanto, pelo menos

```
      n            n·k
 ───────────  =  ───────── ,   e para n ≥ k²:   n·k / (n + k²)  ≥  n·k / 2n  =  k/2
   k + n/k        n + k²
```

**Teorema 27.4: qualquer algoritmo online determinístico para caching com tamanho de cache `k` tem razão competitiva Ω(k).** Combinado com o Teorema 27.3, LRU e FIFO são `Θ(k)` — eles são ótimos *entre as políticas determinísticas*, e nenhuma esperteza determinística vai fazer melhor. Os resultados são, como o livro coloca, algo insatisfatórios: podemos separar políticas `Θ(k)` das ilimitadas, mas todas essas razões ainda são bastante altas. Determinismo é precisamente a propriedade que o adversário explora.

### Randomização e o adversário oblivious: RANDOMIZED-MARKING

Abandonar o determinismo muda o quadro. Mas primeiro: quando um algoritmo online faz escolhas aleatórias, o adversário sabe delas? Um adversário que **não** conhece as escolhas aleatórias é **oblivious**; um que conhece é **nonoblivious**. Preferiríamos garantir resultados contra um adversário nonoblivious já que é mais forte, mas um adversário nonoblivious anula quase todo o poder da aleatoriedade — conhecendo os resultados dos lances de moeda, ele pode agir como se o algoritmo fosse determinístico. Então o adversário oblivious é o tipicamente usado. A ilustração do livro: se você lança uma moeda honesta `n` vezes, um adversário nonoblivious sabe depois de cada lance se foi cara, e portanto sabe a contagem exata; um adversário oblivious sabe apenas que você está lançando uma moeda honesta `n` vezes, e pode raciocinar que o número de caras segue distribuição binomial com esperança `n/2` e variância `n/4` — mas não tem como saber quantas caras você de fato tirou.

O algoritmo é o **MARKING**, uma aproximação de LRU — pense nele como simplesmente "usado recentemente" em vez de "usado *menos* recentemente". Ele mantém uma marca `mark` de 1 bit por bloco em cache, todas inicialmente desmarcadas. Uma requisição por um bloco em cache o marca. Num miss, se todos os blocos em cache estão marcados eles são todos desmarcados; de qualquer forma pelo menos um bloco desmarcado agora existe, um bloco desmarcado arbitrário é despejado, e o bloco requisitado entra no cache marcado. **RANDOMIZED-MARKING** escolhe essa vítima uniformemente ao acaso entre os blocos desmarcados:

```java
// RANDOMIZED-MARKING(b), transcrito do pseudocódigo do livro.
// (A análise assume que o cache já encheu, então todo miss despeja algo.)
void randomizedMarking(int b) {
    if (cached.contains(b)) {                        // 1  o bloco b reside no cache
        mark.put(b, 1);                              // 2
        return;
    }
    if (cached.stream().allMatch(x -> mark.get(x) == 1)) {   // 4  todos os blocos marcados?
        cached.forEach(x -> mark.put(x, 0));                 // 5  desmarca todos — uma NOVA ÉPOCA começa aqui
    }
    List<Integer> unmarked = cached.stream().filter(x -> mark.get(x) == 0).toList();
    int u = unmarked.get(random.nextInt(unmarked.size()));    // 6  uniformemente ao acaso
    cached.remove(Integer.valueOf(u));                        // 7  despeja u
    cached.add(b);                                            // 8
    mark.put(b, 1);                                           // 9
}
```

Uma **época** começa imediatamente depois que a linha 5 executa, sem blocos marcados no cache. O número de blocos marcados aumenta em 1 na primeira requisição de um bloco na época e nunca diminui dentro dela, então uma época compreende requisições por `k` blocos distintos (possivelmente menos na época final), e a próxima época começa numa requisição por um bloco fora desses `k` — a mesma noção de época do Teorema 27.3.

Para um algoritmo randomizado medimos a **razão competitiva esperada**: o algoritmo `A` tem razão competitiva esperada `c` se para toda entrada `I`, `E[A(I)] ≤ c · F(I)`, onde a esperança é sobre as escolhas aleatórias de `A`. O algoritmo determinístico MARKING tem razão competitiva `Θ(k)` (o Teorema 27.4 fornece o limite inferior; o Exercício 27.3-4, o superior). A versão randomizada se sai muito melhor, porque um adversário oblivious não consegue requisitar de forma confiável um bloco que não está no cache — ele não sabe quais blocos estão lá.

**Teorema 27.5: RANDOMIZED-MARKING tem razão competitiva esperada O(lg k) contra um adversário oblivious.** A prova percorre época por época. Dentro de uma época, só a *primeira* requisição de um bloco pode dar miss (depois disso ele está em cache e marcado, então não pode ser despejado durante a época), então só as primeiras requisições são contadas; assuma que cada época tem exatamente `k` requisições por `k` blocos distintos (preencha a última época com requisições fictícias). Classifique cada uma como **antiga** (o bloco estava no cache no início da época — ou seja, foi requisitado na época anterior) ou **nova**. No exemplo anterior, colapsando cada época às suas primeiras requisições dá `|1,2,5| 4,1,2 | 3,4,5 | 2,1|`: toda a época 1 é nova; na época 2, os blocos 1 e 2 são antigos e 4 é novo; na época 3, o bloco 4 é antigo enquanto 3 e 5 são novos; ambas as requisições da época 4 são novas.

Uma requisição nova sempre dá miss, por definição. Uma requisição antiga pode ou não dar miss — o bloco estava em cache no início da época, mas uma requisição anterior na época pode tê-lo despejado, e cada requisição antiga sucessiva tem uma chance crescente de ele ter sido despejado. Limitar essa probabilidade exige um fato probabilístico:

> **Lema 27.6.** Uma sacola contém `x + y` bolas: `x − 1` azuis, `y` brancas e 1 vermelha. Você repetidamente escolhe uma bola ao acaso e a remove, deixando de lado cada bola branca, até ter escolhido `m` bolas que são azuis ou vermelhas, onde `m ≤ x`. Então uma das bolas escolhidas é a vermelha com probabilidade `m/x`.

(Bolas brancas não afetam quantas bolas azuis-ou-vermelhas são escolhidas, então podem ser ignoradas; as probabilidades condicionais restantes `(x−1)/x · (x−2)/(x−1) · … · (x−m)/(x−m+1)` telescopam para `(x−m)/x` para "vermelha nunca escolhida", deixando `m/x`.)

Seja a época `i` contendo `r_i ≥ 1` requisições novas e portanto `k − r_i` antigas, e considere a `j`-ésima requisição antiga, para o bloco `b_ij`. Sejam `n_ij` e `o_ij` os números de requisições novas e antigas ocorrendo na época `i` antes dela; como `j − 1` requisições antigas a precedem, `o_ij = j − 1`. Aplicando o Lema 27.6 com os `k` blocos em cache como bolas — `b_ij` como a bola vermelha, os blocos já excluídos por requisições antigas anteriores como bolas brancas, o resto como azuis — dá a probabilidade de miss para a `j`-ésima requisição antiga como

```
n_ij / (k − o_ij) = n_ij / (k − j + 1)  ≤  r_i / (k − j + 1)      (já que n_ij ≤ r_i)
```

Com variáveis aleatórias indicadoras `Y_ij` para "a `j`-ésima requisição antiga na época `i` dá miss" e `Z_ij` para a `j`-ésima requisição nova (sempre 1), o número esperado de misses `X_i` na época `i` é:

```
E[X_i] = Σ_{j=1}^{k−r_i} E[Y_ij] + Σ_{j=1}^{r_i} E[Z_ij]        (linearidade da esperança)
       ≤ Σ_{j=1}^{k−r_i} r_i/(k − j + 1) + r_i
       ≤ r_i · ( Σ_{j=1}^{k−1} 1/(k − j + 1) + 1 )
       = r_i · H_k
```

onde `H_k` é o `k`-ésimo número harmônico. Somando sobre todas as `p` épocas dá `E[X] ≤ H_k · Σ r_i`.

Agora o lado offline. Focar numa única época não vai bastar — o algoritmo offline pode começar uma época com exatamente os blocos que aquela época vai requisitar, e não sofrer nada. Mas considere duas épocas consecutivas `i − 1` e `i`: cada uma contém `k` requisições por `k` blocos diferentes, e a época `i` contém `r_i` requisições por blocos *não* requisitados na época `i − 1`, então as duas épocas juntas contêm exatamente `k + r_i` requisições distintas. Seja o que for que o cache continha no início da época `i − 1`, `k + r_i` requisições distintas forçam pelo menos `r_i` misses. Sendo `m_i` os misses do algoritmo offline na época `i`, isso dá `m_{i−1} + m_i ≥ r_i`, e emparelhando os termos:

```
Σ m_i = ½ · Σ 2m_i  =  ½ · ( m_1 + Σ_{i=2}^{p} (m_{i−1} + m_i) + m_p )
      ≥ ½ · ( m_1 + Σ_{i=2}^{p} (m_{i−1} + m_i) )
      ≥ ½ · ( m_1 + Σ_{i=2}^{p} r_i )
      = ½ · Σ_{i=1}^{p} r_i                          (porque m_1 = r_1)
```

A última igualdade vale porque o cache começa vazio, então toda primeira requisição na época 1 dá miss mesmo para o algoritmo offline ótimo. Dividindo o limite superior sobre o algoritmo randomizado pelo limite inferior sobre o offline:

```
   H_k · Σ r_i
  ───────────── = 2·H_k = 2 ln k + O(1) = O(lg k)
   ½  · Σ r_i
```

De `Θ(k)` para `Θ(lg k)` — para um `k` realista isso é uma melhora enorme, e a *única* coisa que comprou isso foi a incapacidade do adversário de ver os lances de moeda.

## Trade-offs

- **Uma razão competitiva é uma garantia de pior caso, não uma previsão de performance.** MOVE-TO-FRONT ser 4-competitivo significa que ele nunca custa mais que 4× o ótimo em *nenhuma* sequência — mas numa sequência em particular ele pode custar bem menos, talvez até igualar o ótimo exatamente. A mesma assimetria percorre o exemplo do elevador: "sempre pegar as escadas" vence na razão competitiva com `k = 10, B = 300`, mas o livro é explícito que isso não a torna melhor em média, nem sequer melhor com mais frequência. Ela se protege melhor contra o pior caso, e nada mais é afirmado.
- **Os limites só são tão significativos quanto o modelo de custo.** A 4-competitividade de MOVE-TO-FRONT é provada sob um modelo específico: custo `i` para buscar a posição `i`, custo 1 por troca adjacente. O Exercício 27.2-4 propõe um modelo alternativo em que, após acessar `x`, você pode movê-lo para qualquer posição anterior da lista de graça e só os acessos custam algo — e ali MOVE-TO-FRONT é 2-competitivo (para um número suficientemente grande de requisições). Antes de citar uma razão competitiva, verifique se a contabilidade do modelo bate com o que seu sistema realmente paga. A prova também assume que MOVE-TO-FRONT e FORESEE começam com a mesma lista, que é o que torna o potencial inicial `Φ_0 = 0`.
- **Caching determinístico tem um piso rígido, e não é um problema de ajuste fino.** Toda política determinística é `Ω(k)` (Teorema 27.4), então nenhuma quantidade de refinamento heurístico escapa disso — o adversário é assumido conhecer seu algoritmo e sempre pode requisitar exatamente o bloco que você acabou de despejar. O Exercício 27.3-5 leva isso mais longe: até um algoritmo determinístico com `l`-lookahead, autorizado a ver as próximas `l` requisições, ainda é `Ω(k)` para toda constante `l ≥ 0`. Escolher entre LRU/FIFO (`Θ(k)`) e LIFO/LFU (ilimitado, `Θ(n/k)`) é uma decisão real; espremer uma política determinística abaixo de `Θ(k)` não é.
- **A garantia O(lg k) da randomização se apoia inteiramente no adversário ser oblivious, e é uma esperança.** Contra um adversário nonoblivious que vê as escolhas aleatórias, o adversário pode agir como se o algoritmo fosse determinístico e a vantagem evapora. E `E[A(I)] ≤ c·F(I)` limita o número *esperado* de misses sobre os lances de moeda do algoritmo — uma execução individual pode ser pior, então isso não é uma garantia por execução, do mesmo jeito que um limite amortizado não é uma garantia de latência por operação.
- **Uma razão que depende de `n` é qualitativamente pior que uma que depende de `k`.** `k` é fixo e não cresce conforme requisições continuam chegando; `n` cresce sem limite, então uma razão "ilimitada" `Θ(n/k)` degrada ao longo da vida de um processo de execução longa. E até as boas razões aqui são, na própria avaliação do livro, bastante altas — a análise competitiva é afiada o suficiente para separar classes de políticas, mas não vai dizer qual de duas políticas `Θ(k)` vai realmente ser mais rápida no seu tráfego.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Chapter 27 "Online Algorithms", Sections 27.1-27.3, pp. 792-815](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Section 27.3 "Online caching" (deterministic bounds, RANDOMIZED-MARKING), pp. 802-814](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
