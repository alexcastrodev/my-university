---
version: 1.0
updatedAt: 2026-08-13
title: "Mochila 0-1 vs. Fracionária: Por Que a Mesma Estrutura Precisa de Técnicas Diferentes"
description: "Contrasta o problema da mochila fracionária, que tem a propriedade da escolha gulosa e é resolvido por uma única passada gulosa de ordenar-e-pegar em O(n log n), com o problema da mochila 0-1, onde a mesma regra gulosa, aparentemente idêntica, falha comprovadamente (reproduzindo o próprio contraexemplo de $220-vs-$160 de CLRS) apesar de os dois problemas compartilharem subestrutura ótima — então desenvolve a recorrência de PD do 0-1, uma tabela verificada à mão, e o tempo de execução pseudo-polinomial O(nW) que CLRS deixa como exercício em vez de resolver no texto principal."
---
## Objetivo

Entenda por que dois problemas de mochila que parecem quase idênticos — mesmos itens, mesma capacidade, mesma propriedade de subestrutura ótima — precisam de técnicas algorítmicas inteiramente diferentes: o problema da mochila fracionária tem a propriedade da escolha gulosa e é resolvido por uma única passada gulosa em O(n log n), enquanto o problema da mochila 0-1 não tem, exige programação dinâmica em vez disso, e só roda em tempo O(nW), que é pseudo-polinomial, não verdadeiramente polinomial no tamanho da entrada.

## Casos de Uso

- Reconhecer, dado um problema de alocação de recursos, se os itens podem ser divididos (fracionário — guloso se aplica) ou precisam ser levados inteiros (0-1 — guloso pode silenciosamente dar uma resposta errada, e PD é necessária).
- Sinal de alerta em entrevista e revisão de design: um candidato propõe "ordenar por valor-por-peso e pegar gulosamente" para um problema no formato de mochila — a primeira pergunta é se os itens são de fato divisíveis, porque a mesma regra, com aparência idêntica, é comprovadamente correta para uma variante e comprovadamente errada para a outra.
- Alocação de orçamento/capacidade onde os itens são unidades indivisíveis (slots de anúncio, contêineres de frete, investimentos discretos até um orçamento) — a tabela de PD do 0-1 (ou sua forma otimizada em espaço com array rolante) é a ferramenta padrão uma vez que guloso é descartado.

## Aprofundamento

### Dois problemas, uma mesma propriedade de subestrutura ótima compartilhada

Ambos os problemas compartilham a mesma configuração, segundo CLRS: um ladrão assaltando uma loja pode carregar no máximo `W` libras, e enfrenta `n` itens, onde o item `i` vale `v_i` dólares e pesa `w_i` libras (inteiros). No **problema da mochila 0-1**, o ladrão precisa levar cada item inteiro ou não levar nada dele — "0-1" porque essa é a única escolha por item, sem frações, sem duplicatas. No **problema da mochila fracionária**, a configuração é idêntica, exceto que o ladrão pode levar qualquer fração de um item — a própria analogia de CLRS é que um item 0-1 é como um lingote de ouro (tudo ou nada), enquanto um item fracionário é como pó de ouro (pegue exatamente a quantidade que quiser).

CLRS enuncia a subestrutura ótima com precisão para cada um, e as duas afirmações diferem exatamente onde se esperaria — o que sobra depois de remover o item `j`:

- **0-1:** se a carga mais valiosa pesando no máximo `W` libras inclui o item `j`, então a carga restante precisa ser a carga mais valiosa pesando no máximo `W - w_j` libras que o ladrão consegue tirar dos outros `n - 1` itens (excluindo o item `j` por completo — ele já está totalmente comprometido).
- **Fracionário:** se a carga mais valiosa pesando no máximo `W` libras inclui um peso `w` do item `j`, então a carga restante precisa ser a carga mais valiosa pesando no máximo `W - w` libras que o ladrão consegue tirar dos outros `n - 1` itens *mais* as `w_j - w` libras restantes do próprio item `j` — o item `j` ainda pode contribuir mais, porque não está necessariamente esgotado.

Ambos são argumentos legítimos de subestrutura ótima — uma solução do problema inteiro é construída a partir de uma solução de uma instância estritamente menor do mesmo problema. Essa é a propriedade da qual tanto programação dinâmica quanto algoritmos gulosos dependem, o que é exatamente por que é tentador assumir que os dois problemas admitem o mesmo tipo de algoritmo. Não admitem.

### O algoritmo guloso da mochila fracionária — e por que é comprovadamente ótimo

Para resolver o problema fracionário, primeiro calcule o valor por libra de cada item, `v_i / w_i`. A regra gulosa: ordene os itens por essa razão em ordem decrescente, depois pegue o máximo possível do item de melhor razão, depois o próximo melhor, e assim por diante até a capacidade se esgotar.

```java
record Item(String name, int weight, int value) {
    double ratio() {
        return (double) value / weight;
    }
}

static double fractionalKnapsack(List<Item> items, int capacity) {
    List<Item> sorted = new ArrayList<>(items);
    sorted.sort(Comparator.comparingDouble(Item::ratio).reversed()); // melhor razão primeiro — o único sort que faz o guloso funcionar

    double totalValue = 0;
    int remaining = capacity;
    for (Item item : sorted) {
        if (remaining <= 0) break;
        if (item.weight() <= remaining) {
            totalValue += item.value();          // pega o item inteiro
            remaining -= item.weight();
        } else {
            totalValue += item.ratio() * remaining; // pega só a fração que ainda cabe
            remaining = 0;
        }
    }
    return totalValue;
}
```

Como o algoritmo inteiro é um sort seguido de uma única passada linear, ele roda em O(n log n), dominado inteiramente pelo sort.

CLRS propõe provar essa regra correta como o Exercício 15.2-1, em vez de desenvolver a prova no texto principal — mas a prova tem o mesmo formato do argumento de troca que o concept irmão de seleção de atividades percorre por completo para o Teorema 15.1: pegue qualquer solução ótima, e se ela ainda não começar exaurindo completamente o item de melhor razão, mostre que trocar o máximo possível desse item que a capacidade da própria solução ótima permite só pode igualar ou superar ela, porque nada mais na mochila consegue transformar uma libra de capacidade em mais valor do que a melhor razão disponível. Essa é a propriedade da escolha gulosa — uma primeira escolha, comprovadamente parte de *alguma* solução ótima, que nunca precisa ser revisitada.

### O próprio contraexemplo de CLRS: guloso falha na mochila 0-1

A mesma regra gulosa — ordene por razão, pegue gulosamente — parece igualmente razoável para o problema 0-1, e CLRS dá um contraexemplo específico e pequeno (Figura 15.3) provando que não é. Três itens, capacidade da mochila 50:

| Item | Peso | Valor | Valor/peso |
|---|---|---|---|
| 1 | 10 | $60 | 6 |
| 2 | 20 | $100 | 5 |
| 3 | 30 | $120 | 4 |

Guloso-por-razão pega o item 1 primeiro (razão 6, a melhor). Com 40 libras de capacidade restantes, pega o item 2 em seguida (razão 5, a segunda melhor) — agora 30 das 50 libras estão usadas, valor $160. O item 3 (peso 30) não cabe mais nas 20 libras restantes, então o guloso 0-1 para aí, tendo usado apenas 30 das 50 libras disponíveis.

Checando à mão todo subconjunto viável, confirma-se que a resposta do guloso está errada:

| Subconjunto | Peso | Valor |
|---|---|---|
| {1} | 10 | $60 |
| {2} | 20 | $100 |
| {3} | 30 | $120 |
| {1, 2} | 30 | $160 ← resposta do guloso |
| {1, 3} | 40 | $180 |
| {2, 3} | 50 | **$220 ← ótimo verdadeiro** |
| {1, 2, 3} | 60 | inviável (excede a capacidade 50) |

A solução 0-1 ótima é itens 2 e 3, por $220, usando os 50 libras completas de capacidade da mochila — e deixa de fora o item 1, justamente o item com a melhor razão individual. Toda solução que inclui o item 1 é pior do que $220 (a melhor dessas é {1, 3}, com $180).

A própria explicação de CLRS para *por que* o guloso falha aqui: pegar o item 1 primeiro "não funciona no problema 0-1, porque o ladrão é incapaz de preencher a mochila até a capacidade, e o espaço vazio reduz o valor efetivo por libra da carga." No caso fracionário isso nunca acontece: qualquer capacidade sobrando é completada com uma fração do próximo melhor item, então nenhuma capacidade jamais é desperdiçada. No caso 0-1, uma vez que o item de melhor razão está travado, a capacidade *restante* pode não se dividir de forma exata entre o que sobra, e 10 libras de espaço não usado (como acontece aqui) é valor que o guloso jamais consegue recuperar. Decidir se inclui um item agora exige comparar o subproblema que o inclui com o subproblema que o exclui — e ambos esses subproblemas recorrem por toda a busca, o que é exatamente a assinatura de subproblemas sobrepostos que pede programação dinâmica em vez de guloso.

### A solução de PD da mochila 0-1: recorrência, tabela e tempo O(nW)

CLRS prova a subestrutura ótima do problema 0-1 e seus subproblemas sobrepostos no texto principal, depois propõe a própria solução de programação dinâmica como o Exercício 15.2-2, em vez de derivar a recorrência e a tabela por conta própria. O que segue é essa técnica de PD aplicada ao problema exato de CLRS e ao seu exato exemplo de três itens, construído e verificado à mão aqui, e não transcrito do texto principal de CLRS (que não o traz).

Defina `OPT(i, w)` como o valor máximo alcançável usando apenas os itens `1..i` com capacidade `w`. O item `i` ou simplesmente não cabe, ou pode ser pulado ou pego — combinando com a afirmação de subestrutura ótima acima:

```
OPT(i, w) = OPT(i-1, w)                                      se w_i > w   (item i não cabe)
OPT(i, w) = max( OPT(i-1, w), OPT(i-1, w - w_i) + v_i )       caso contrário    (pula ele, ou pega ele)
```

```java
static int knapsack01(int[] weight, int[] value, int capacity) {
    int n = weight.length;
    int[][] opt = new int[n + 1][capacity + 1]; // opt[0][*] fica 0 (caso base: nenhum item)

    for (int i = 1; i <= n; i++) {
        for (int w = 0; w <= capacity; w++) {
            opt[i][w] = opt[i - 1][w];                         // sempre uma escolha válida: pular o item i
            if (weight[i - 1] <= w) {
                opt[i][w] = Math.max(opt[i][w], opt[i - 1][w - weight[i - 1]] + value[i - 1]);
            }
        }
    }
    return opt[n][capacity]; // reconstruir quais itens foram levados exige uma volta (traceback) por essa tabela
}
```

Preenchendo `OPT(i, w)` para o próprio exemplo de três itens de CLRS (item 1: peso 10, valor 60; item 2: peso 20, valor 100; item 3: peso 30, valor 120; capacidade 50) — todo valor listado abaixo é verificado à mão contra a recorrência. Como os três pesos de item são múltiplos de 10, `OPT(i, w)` só muda em múltiplos de 10, então a tabela abaixo mostra a capacidade em passos de 10, em vez das 51 colunas completas:

| `OPT(i, w)` | w=0 | w=10 | w=20 | w=30 | w=40 | w=50 |
|---|---|---|---|---|---|---|
| i=0 (nenhum item) | 0 | 0 | 0 | 0 | 0 | 0 |
| i=1 (+ item 1: w10, v60) | 0 | 60 | 60 | 60 | 60 | 60 |
| i=2 (+ item 2: w20, v100) | 0 | 60 | 100 | 160 | 160 | 160 |
| i=3 (+ item 3: w30, v120) | 0 | 60 | 100 | 160 | 180 | **220** |

`OPT(3, 50) = 220` bate com o verdadeiro ótimo encontrado pela enumeração exaustiva acima. Traçando a escolha de trás para frente a partir do canto inferior direito confirma *quais* itens a produziram: em `(3, 50)`, `OPT(2, 50) = 160` é superado por `OPT(2, 20) + 120 = 100 + 120 = 220`, então o item 3 é levado e o traço se move para `(2, 20)`; lá, `OPT(1, 20) = 60` é superado por `OPT(1, 0) + 100 = 0 + 100 = 100`, então o item 2 é levado e o traço se move para `(1, 0)`; lá, `OPT(1, 0) = 0` porque o item 1 (peso 10) não cabe em 0 libras de capacidade restante, então o item 1 é excluído. O conjunto recuperado é `{2, 3}` — a mesma resposta que a checagem de força bruta de subconjuntos encontrou.

A tabela tem `(n + 1) * (W + 1)` células, cada uma fazendo trabalho O(1), então preenchê-la custa tempo e espaço O(nW). Isso parece polinomial, e para `W` fixo e razoavelmente pequeno se comporta assim na prática — mas é **pseudo-polinomial**, não polinomial no sentido estrito da teoria da complexidade: o tempo de execução é polinomial no *valor numérico* de `W`, não no número de bits necessários para representar `W`. Dobrar `W` dobra a tabela (e o tempo de execução), mesmo que representar o `W` maior custe apenas um bit a mais. É exatamente por isso que a mochila 0-1 continua classificada como NP-difícil no caso geral — um algoritmo eficiente para "capacidade até alguns milhões" ainda pode explodir quando a capacidade é especificada como um número de 64 bits na casa dos bilhões, mesmo que `n` continue pequeno.

## Trade-offs

- **Mesma subestrutura ótima, veredito diferente sobre guloso — essa é a lição inteira.** Ambos os problemas se reduzem a uma instância menor de si mesmos, o que é necessário tanto para PD quanto para guloso, mas não suficiente para guloso. Só a variante fracionária adicionalmente tem a propriedade da escolha gulosa (demonstrável via um argumento de troca, pelo Exercício 15.2-1); o contraexemplo da Figura 15.3 da variante 0-1 é a prova padrão de que uma regra gulosa com aparência plausível pode falhar mesmo quando a propriedade estrutural subjacente que costuma habilitá-la (subestrutura ótima) está presente.
- **O(n log n) guloso vs. O(nW) programação dinâmica é uma diferença de custo real, não só uma formalidade.** Para a mochila fracionária, o sort domina e `W` nunca entra no tempo de execução. Para a mochila 0-1, `W` entra diretamente — uma capacidade de 10.000 com 20 itens significa uma tabela de 20 x 10.001, o que é tranquilo, mas uma capacidade na casa dos bilhões (entrada perfeitamente razoável, ex: moeda em centavos) torna a tabela O(nW) inviável mesmo com `n` minúsculo; essa é a sutileza pseudo-polinomial acima, não um bug do algoritmo.
- **A tabela só de valor não é a resposta para "quais itens"** — o `knapsack01` acima retorna `opt[n][capacity]`, um número. Recuperar o subconjunto real (como o traceback resolvido faz) significa percorrer a tabela de trás para frente, comparando `OPT(i, w)` contra `OPT(i-1, w)` a cada passo, o mesmo padrão que os concepts irmãos `dynamic-programming-fundamentals` e `longest-common-subsequence` usam para pontos de corte e subsequências reconstruídas — fácil de adicionar, fácil de esquecer se o enunciado do problema só parecer pedir um total.
- **O espaço pode ser reduzido se apenas o valor for necessário.** Como a linha `i` da tabela só lê a linha `i - 1`, `knapsack01` pode ser reescrito com um único array 1D de comprimento `W + 1`, atualizado da direita para a esquerda dentro da passada de cada item (da direita para a esquerda especificamente para evitar reaproveitar um item já contado antes, na mesma linha) — derrubando o espaço de O(nW) para O(W), ao custo de perder a capacidade de rastrear quais itens foram escolhidos.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, "Introduction to Algorithms", 4th Edition (MIT Press, 2022) — Chapter 15 "Greedy Algorithms", Section 15.2 "Elements of the greedy strategy" (knapsack problem setup, optimal-substructure argument for both variants, and Figure 15.3's counterexample), pp. 428-431 — book
- [Comparator — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Comparator.html) — doc
