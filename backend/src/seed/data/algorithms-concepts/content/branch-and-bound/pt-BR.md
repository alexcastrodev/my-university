---
version: 1.0
updatedAt: 2026-08-18
title: "Branch and Bound: Podando a Árvore de Busca para Otimização Inteira e Combinatória"
description: "Branch and Bound resolve problemas de otimização inteira e combinatória de forma exata organizando o espaço de busca como uma árvore de subproblemas, usando o valor da relaxação LP de cada subproblema como limite superior para podar ramos inteiros que não podem superar a melhor solução inteira já encontrada. Traçado à mão num programa inteiro real de 2 variáveis (relaxação da raiz, um ramo inviável, uma solução inteira podada por limite, e o ramo que vira o incumbente final) para tornar a poda concreta em vez de abstrata."
---
## Objetivo

Entenda Branch and Bound como a técnica exata padrão para problemas de otimização inteira e combinatória onde a estrutura de subproblemas sobrepostos da programação dinâmica não se aplica, mas a enumeração exaustiva é lenta demais: em vez de checar cada solução candidata uma de cada vez, Branch and Bound organiza o espaço de soluções inteiro como uma árvore de subproblemas, e usa um *limite* barato de calcular sobre cada subárvore para descartar — podar — ramos inteiros sem nunca inspecionar uma única solução dentro deles.

## Casos de Uso

- Resolver Programas Lineares Inteiros (PLI/ILP) de forma exata, onde todas ou algumas variáveis de decisão precisam assumir valores inteiros — seleção de projetos, localização de instalações, escalonamento de tarefas, e qualquer problema de alocação onde uma resposta fracionária (`2.25` caminhões, `3.75` máquinas) não tem sentido no mundo real.
- Programação inteira 0-1 (binária) especificamente — problemas de seleção estilo knapsack onde cada item é totalmente pego ou não, e a tabela `O(nW)` da DP se torna impraticável quando a capacidade `W` é grande (a DP pseudopolinomial do concept irmão `knapsack-01-vs-fractional` é uma alternativa; Branch and Bound é a outra, e a que generaliza para restrições que a tabela da DP não consegue expressar facilmente).
- Problemas de otimização combinatória em geral (bin packing, o problema do caixeiro viajante, set covering) onde nenhum algoritmo exato de tempo polinomial é conhecido, mas uma boa função de limite ainda permite que um solver pule a esmagadora maioria do espaço de busca na prática.
- Qualquer situação em que você precise de uma *prova* de otimalidade, não só de uma boa resposta — Branch and Bound termina tendo de fato verificado que não existe solução melhor em nenhum lugar do espaço, algo que uma busca heurística ou metaheurística não pode alegar.

## Aprofundamento

### Por que busca exaustiva não é uma opção

Um problema de Branch and Bound começa a vida como um Programa Linear Inteiro:

```
max   c^T x
s.t.  A x <= b
      x in Z^n   (algumas ou todas as variáveis restritas a inteiros)
```

A primeira ideia tentadora — enumerar todo ponto inteiro na região viável, avaliar o objetivo em cada um, guardar o melhor — falha puramente na aritmética da contagem. Suponha que todas as `n` variáveis de decisão sejam binárias (0 ou 1): o número de atribuições candidatas é `2^n`. Para `n = 50`, isso já é mais de `10^15` combinações — muito além do que qualquer checagem exaustiva consegue percorrer, mesmo que 50 variáveis de decisão binárias seja um tamanho de problema perfeitamente comum na prática, não um extremo. A dificuldade real não é o número de restrições ou variáveis diretamente; é que a região viável de um programa inteiro é uma malha discreta de pontos em vez do politopo contínuo e convexo que um programa linear simples desfruta, e a convexidade é exatamente o que permite que um LP simples seja resolvido em tempo polinomial. Programação inteira em geral é NP-difícil: um algoritmo eficiente (tempo polinomial) para o caso geral implicaria P = NP. O objetivo, então, não é encolher o espaço de busca de antemão — é evitar visitar explicitamente as partes dele que provadamente não podem conter o ótimo. Essa ideia se chama **enumeração implícita**, e Branch and Bound é sua forma mais usada.

### A relaxação LP: um limite de graça

A ferramenta chave que torna a enumeração implícita possível é a **relaxação LP** — pegue o programa inteiro e simplesmente descarte a restrição de integralidade, deixando um programa linear comum sobre o mesmo objetivo e restrições:

```
max   c^T x
s.t.  A x <= b
      x in R^n     (relaxado: agora de valor real, não inteiro)
```

Essa relaxação tem uma propriedade que faz todo o trabalho: toda solução inteira-viável do problema original é automaticamente viável para a relaxação também (é simplesmente o caso especial em que a solução de valor real por acaso é inteira), então o valor ótimo da relaxação nunca pode ser *pior* que o valor ótimo do programa inteiro. Para um problema de maximização:

```
Z*_ILP <= Z*_LP
```

O ótimo da relaxação é, portanto, um **limite superior** válido sobre a melhor solução inteira alcançável — e é um limite obtido "de graça", já que a relaxação é um LP comum, solúvel eficientemente (veja o concept irmão `simplex-tabular-method` para como). Se esse limite superior algum dia cair no nível ou abaixo de um valor que você já consegue alcançar com uma solução inteira conhecida, não há necessidade de olhar mais naquela parte da árvore — nada ali pode superar o que você já tem.

### Os três mecanismos: ramificação, limitação, poda

Branch and Bound combina exatamente três operações, repetidas até que não sobre trabalho:

1. **Ramificação (branching)** — escolha um subproblema cuja relaxação LP deu um valor *fracionário* para alguma variável restrita a inteiro `x_i = v` (não um número inteiro), e divida-o em dois novos subproblemas adicionando uma restrição que força `x_i` para um lado ou outro desse valor fracionário: `x_i <= floor(v)` num ramo, `x_i >= ceil(v)` no outro. Todo ponto inteiro que era viável para o subproblema pai satisfaz exatamente uma dessas duas novas restrições, então a ramificação nunca descarta uma solução candidata legítima — só particiona o espaço de busca em duas peças menores e disjuntas.
2. **Limitação (bounding)** — resolva a própria relaxação LP de cada novo subproblema para obter seu próprio limite superior.
3. **Poda (pruning)** — compare esse limite contra `Z*`, o valor da melhor solução inteira-viável encontrada em qualquer lugar da busca *até agora* (o **incumbente**). Se o limite superior do subproblema não é melhor que o incumbente, descarte o subproblema inteiro — toda solução inteira dentro dele é garantidamente não melhor que o que já está em mãos, então não há nada a ganhar explorando mais.

A exploração de um subproblema também termina, sem nenhuma poda necessária, sempre que sua própria relaxação acaba sendo já de valor inteiro (é uma candidata legítima — compare contra o incumbente e possivelmente substitua) ou inviável (nada ali para encontrar de qualquer forma, descarte diretamente). Só um subproblema cuja relaxação seja fracionária *e* cujo limite ainda supere o incumbente precisa ser ramificado mais.

### Um exemplo completo resolvido, traçado à mão

Considere maximizar `Z = 5x1 + 8x2` sujeito a `x1 + x2 <= 6`, `5x1 + 9x2 <= 45`, com `x1, x2` restritos a inteiros não negativos.

**Raiz.** A relaxação LP (descartando integralidade) tem seu ótimo na interseção das duas restrições: `x1 = 2.25`, `x2 = 3.75`, `Z = 41.25`. Ambas as variáveis são fracionárias; ramifique em `x2` (a escolha aqui é arbitrária quando mais de uma variável é fracionária — qualquer uma serviria): `x2 <= 3` (subproblema S1) ou `x2 >= 4` (subproblema S2). Todo ponto inteiro que era viável na raiz satisfaz um desses dois, então nada se perde ao dividir.

- **S1** (`x2 <= 3`): o ótimo da relaxação é `x1 = 3, x2 = 3`, `Z = 39` — já inteiro. Essa é a primeira solução inteira-viável encontrada em toda a busca, então se torna imediatamente o **incumbente**: `Z* = 39`. Nenhuma ramificação adicional é necessária em S1 — sua própria relaxação já é o melhor que qualquer coisa lá dentro poderia ser.
- **S2** (`x2 >= 4`): o ótimo da relaxação é `x1 = 1.8, x2 = 4`, `Z = 41`. Fracionário, e `41 > 39` — ainda promissor, então S2 precisa de mais ramificação, em `x1`: `x1 <= 1` (S3) ou `x1 >= 2` (S4).
  - **S4** (`x1 >= 2`, herdando `x2 >= 4`): combinar `x1 >= 2` e `x2 >= 4` com a restrição `x1 + x2 <= 6` força `x1 + x2 >= 6`, então o único ponto candidato é `(2, 4)` — mas `5(2) + 9(4) = 46 > 45` viola a segunda restrição. **Inviável.** Descartado diretamente — nunca houve nada aqui para encontrar.
  - **S3** (`x1 <= 1`, herdando `x2 >= 4`): o ótimo da relaxação é `x1 = 1, x2 = 40/9 ≈ 4.44`, `Z ≈ 40.56`. Ainda fracionário (`x2`), e `40.56 > 39` — ainda vale explorar, ramifique de novo em `x2`: `x2 <= 4` (S5) ou `x2 >= 5` (S6).
    - **S5** (`x2 <= 4`, herdando `x1 <= 1`): o ótimo da relaxação é `x1 = 1, x2 = 4`, `Z = 37` — inteiro, então é uma candidata legítima. Mas `37 < Z* = 39` — não consegue superar o incumbente. **Podado por limite**, mesmo com sua própria solução sendo inteira: uma resposta inteira pior que o que você já tem ainda é descartada.
    - **S6** (`x2 >= 5`, herdando `x1 <= 1`): combinado com `x1 + x2 <= 6` e `x1 <= 1`, o único candidato inteiro viável é `x1 = 0, x2 = 5` (checando `5(0) + 9(5) = 45 <= 45` confirma viabilidade) — o ótimo da relaxação aqui **é** `(0, 5)`, `Z = 40`. Inteiro, e `40 > 39` — este se torna o **novo incumbente**, `Z* = 40`, substituindo S1.

Nenhum subproblema aberto resta: S1 foi fechado (solução inteira, embora depois substituída), S4 foi fechado (inviável), S5 foi fechado (podado por limite), S6 foi fechado (inteiro, e o novo incumbente). Como nada resta a explorar, o incumbente é provadamente ótimo:

```
x1* = 0,   x2* = 5,   Z* = 40
```

Branch and Bound não apenas encontrou isso — *provou* isso, contabilizando todo ponto da região viável original como pertencente a algum subproblema que foi ou resolvido diretamente ou mostrado incapaz de superar 40.

### Veja acontecendo: a árvore de busca, podada ao vivo

```viz
type: tree
insert root R | Relaxação LP da raiz: x1=2.25, x2=3.75, Z=41.25 -- fracionário, ramifique em x2.
insert S1 S1 parent=root side=left | Ramo: x2<=3.
insert S2 S2 parent=root side=right | Ramo: x2>=4.
mark S1 | Relaxação de S1: x1=3, x2=3, Z=39 -- já inteiro!
recolor S1 best | Primeiro incumbente encontrado: Z*=39.
mark S2 | Relaxação de S2: x1=1.8, x2=4, Z=41 -- fracionário, mas 41 > 39, ainda promissor. Ramifique em x1.
insert S3 S3 parent=S2 side=left | Ramo: x1<=1.
insert S4 S4 parent=S2 side=right | Ramo: x1>=2.
mark S4 | x1>=2 e x2>=4 forçam 5(2)+9(4)=46 > 45 -- inviável.
recolor S4 pruned | Descartado: não existe ponto viável nesta subárvore.
mark S3 | Relaxação de S3: x1=1, x2≈4.44, Z≈40.56 -- fracionário, 40.56 > 39, ainda promissor. Ramifique em x2.
insert S5 S5 parent=S3 side=left | Ramo: x2<=4.
insert S6 S6 parent=S3 side=right | Ramo: x2>=5.
mark S5 | Relaxação de S5: x1=1, x2=4, Z=37 -- inteiro, mas 37 < incumbente atual 39.
recolor S5 pruned | Descartado por limite: não consegue superar o incumbente, mesmo com sua própria solução sendo inteira.
mark S6 | Relaxação de S6: x1=0, x2=5, Z=40 -- inteiro, e 40 > 39.
recolor S6 best | Novo incumbente: Z*=40, substituindo S1.
recolor S1 pruned | Não é mais o incumbente -- encerrado, substituído por S6.
```

Só `root`, `S2` e `S3` nunca recebem uma cor persistente: foram ramificados, não resolvidos diretamente, então seu papel na prova final é "dividido nas subárvores que de fato resolveram a questão", não "produziu ou descartou uma candidata".

### Estratégia de busca: qual subproblema aberto explorar em seguida

O algoritmo acima nunca especificou uma ordem para visitar subproblemas abertos, porque a corretude de Branch and Bound não depende disso — só sua velocidade depende. Duas estratégias padrão:

- **Busca em profundidade (LIFO / baseada em pilha).** Sempre ramifique no subproblema criado mais recentemente primeiro, mergulhando fundo antes de retroceder. Isso encontra *algum* incumbente inteiro-viável rapidamente (útil, já que um incumbente mais apertado poda mais do resto da árvore mais cedo), e usa memória proporcional à profundidade da árvore em vez de sua largura.
- **Melhor-limite-primeiro (baseada em fila de prioridade).** Sempre ramifique em qualquer subproblema aberto que atualmente tenha o melhor limite de relaxação (o menos podado), independente de onde ele esteja na árvore. Isso tende a encontrar o verdadeiro ótimo com menos subproblemas totais explorados, já que persegue a região mais promissora primeiro — mas pode manter muito mais subproblemas abertos em memória ao mesmo tempo do que uma pilha de busca em profundidade.

Nenhuma estratégia muda qual é a resposta final; ambas eventualmente resolvem ou podam todo subproblema da mesma forma que o exemplo resolvido acima fez. Elas só mudam a velocidade com que um incumbente apertado aparece, e, portanto, quantos ramos são podados antes de serem totalmente explorados.

### Especializando para programação inteira 0-1 (binária)

Quando toda variável de decisão é restrita a `{0, 1}` em vez de inteiros gerais, os mesmos três mecanismos se aplicam com uma simplificação: um valor fracionário de relaxação `x_i = v` (com `0 < v < 1`) ramifica em exatamente `x_i = 0` e `x_i = 1` — não há a ambiguidade de "para qual inteiro arredondar" que existe para uma variável inteira geral, já que 0 e 1 são os únicos dois inteiros na faixa. Esse é o tratamento por branch-and-bound do problema da mochila 0-1 e outros problemas de seleção binária: a relaxação LP (permitindo cada `x_i` ser qualquer valor em `[0, 1]`, não só 0 ou 1) dá o limite, e arredondar um `x_i` fracionário para 0 ou 1 é exatamente o ponto de divisão para os dois ramos daquela variável.

### Pseudocódigo genérico

```java
class Subproblem {
    // restrições adicionais em cima do problema original
    List<Constraint> extraConstraints;
}

double bestZ = Double.NEGATIVE_INFINITY;   // Z*: valor do incumbente, -infinito até um ser encontrado
int[] bestSolution = null;

Deque<Subproblem> open = new ArrayDeque<>();  // pilha (DFS) ou PriorityQueue (melhor-limite) -- mesmo algoritmo de qualquer forma
open.push(new Subproblem(/* o problema original, sem restrições extras ainda */));

while (!open.isEmpty()) {
    Subproblem sub = open.pop();
    LPResult relaxed = solveLPRelaxation(sub);          // ex.: via simplex -- veja simplex-tabular-method

    if (!relaxed.feasible) continue;                     // podado: inviável, nada aqui
    if (relaxed.objectiveValue <= bestZ) continue;        // podado: limite não consegue superar o incumbente

    if (relaxed.isInteger()) {
        bestZ = relaxed.objectiveValue;                   // resolvido: uma candidata legítima e melhor
        bestSolution = relaxed.solution;
        continue;
    }

    int branchVar = relaxed.pickFractionalVariable();     // ainda fracionário -- precisa ramificar mais
    double v = relaxed.valueOf(branchVar);
    open.push(sub.withExtraConstraint(branchVar, "<=", Math.floor(v)));
    open.push(sub.withExtraConstraint(branchVar, ">=", Math.ceil(v)));
}
// bestSolution / bestZ agora é provadamente ótimo -- todo subproblema foi resolvido ou podado.
```

## Trade-offs

- **Exato, e autocertificável — ao custo de explosão exponencial no pior caso.** Diferente de uma heurística, Branch and Bound termina tendo provado que não existe solução melhor; mas a árvore de busca ainda pode crescer exponencialmente no pior caso, já que a poda só é tão eficaz quanto a função de limite for apertada. Uma relaxação LP frouxa (cujo ótimo fica longe do ponto inteiro mais próximo) poda quase nada, e o algoritmo degenera rumo à enumeração exaustiva que foi projetado para evitar.
- **A ordem em que subproblemas são explorados muda o desempenho, nunca a corretude.** Busca em profundidade encontra um incumbente rápido e usa pouca memória; melhor-limite-primeiro tende a precisar de menos subproblemas totais, mas pode manter muito mais deles abertos em memória simultaneamente. Nenhuma das estratégias pula o passo de prova que a outra realiza — ambas terminam com toda região do espaço viável original contabilizada.
- **Um subproblema pode ser podado por três razões inteiramente diferentes, e confundi-las é um erro comum**: inviabilidade (nada ali de forma alguma), uma solução inteira que simplesmente é pior que o incumbente atual (uma candidata legítima, só não a melhor — S5 no exemplo resolvido acima), e um limite fracionário que já não é melhor que o incumbente (podado sem nunca sequer saber se existe uma solução inteira ali dentro). Só o terceiro caso é "poda" no sentido de pular trabalho que de outra forma poderia ter sido necessário; os outros dois são só condições normais de terminação.
- **Arredondar a resposta da relaxação LP não é substituto para Branch and Bound.** A relaxação da raiz acima dá `x1 = 2.25, x2 = 3.75`; arredondar ingenuamente para `(2, 4)` é exatamente o subproblema S4 — inviável. O verdadeiro ótimo, `(0, 5)`, nem sequer está perto do palpite arredondado em nenhuma das duas coordenadas, o que é precisamente por que ramificação sistemática (não arredondamento ad hoc) é exigida quando integralidade realmente importa.

## Documentation Links

- [Hamdy A. Taha, *Operations Research: An Introduction*, 10ª Edição (Pearson, 2017) — Capítulo sobre Programação Linear Inteira (Branch and Bound e enumeração implícita 0-1)](https://www.pearson.com/en-us/subject-catalog/p/operations-research-an-introduction/P200000003528/9780137526567) — book
- [Branch and bound — Wikipedia](https://en.wikipedia.org/wiki/Branch_and_bound) — doc
