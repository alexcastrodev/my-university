---
version: 1.0
updatedAt: 2026-08-18
title: "Set Covering, Randomização & LP Rounding"
description: "GREEDY-SET-COVER escolhe repetidamente o conjunto que cobre mais elementos ainda descobertos, dando uma razão de aproximação logarítmica em vez de constante; a Seção 35.4 então acrescenta mais duas técnicas — uma 8/7-aproximação randomizada para MAX-3-CNF que é puro cara-ou-coroa, e uma 2-aproximação para vertex cover ponderado obtida relaxando um programa inteiro 0-1 para um programa linear e arredondando a resposta fracionária em 1/2."
---
## Objetivo

Continuando de onde o concept irmão `approximation-algorithms-vertex-cover` parou — cobrindo as Seções 35.1-35.2, que estabelecem o que *é* uma razão de aproximação e por que NP-completude obriga a se contentar com uma — este concept retoma o mesmo capítulo na Seção 35.3 e cobre as duas próximas técnicas de projeto apresentadas por Cormen et al. Primeiro, `GREEDY-SET-COVER` para o **problema de cobertura de conjuntos (set-covering)**: um loop simples de "pegue o conjunto que cobre mais elementos ainda não cobertos" que *não* é uma aproximação de fator constante como os dois algoritmos anteriores, mas uma `O(lg |X|)`-aproximação — uma razão que cresce com a instância, mas cresce devagar o suficiente para continuar útil. Segundo, as duas técnicas da Seção 35.4: **randomização**, onde a razão de aproximação é definida sobre o custo *esperado* de um algoritmo randomizado (ilustrada por uma 8/7-aproximação para satisfatibilidade MAX-3-CNF que é literalmente cara-ou-coroa), e **programação linear**, onde você relaxa um programa inteiro 0-1 para um programa linear de valores reais que pode de fato resolver em tempo polinomial, e depois *arredonda* a resposta fracionária de volta para uma solução válida. A terceira técnica restante do capítulo — o esquema de aproximação totalmente polinomial construído a partir do trimming de listas — é um animal genuinamente diferente e vive no concept irmão `subset-sum-approximation-scheme`.

## Casos de Uso

- Modelar qualquer problema de alocação do tipo "cubra todos os requisitos com o menor número possível de recursos" como set covering. O próprio exemplo da fonte: `X` é um conjunto de habilidades necessárias para resolver um problema, cada pessoa disponível é o subconjunto de habilidades que possui, e você quer o menor comitê tal que toda habilidade exigida seja detida por pelo menos um membro.
- Aceitar uma razão de aproximação logarítmica em vez de constante quando nenhum algoritmo de fator constante está disponível. A fonte é explícita que o algoritmo de vertex cover da Seção 35.1 *não* se transfere para set covering, mesmo que a versão de decisão de set covering generalize vertex cover — então a heurística gulosa com sua razão `O(lg |X|)` é o que se obtém.
- Raciocinar sobre algoritmos randomizados que retornam respostas *aproximadas*, não apenas exatas: um algoritmo `ρ(n)`-aproximado randomizado limita a razão entre o custo **esperado** de sua saída e o custo ótimo, então é a mesma definição do caso determinístico com uma esperança envolvendo o custo.
- Aproximar vertex cover de **peso mínimo**, onde cada vértice carrega um peso positivo e o objetivo é o peso total mínimo. O `APPROX-VERTEX-COVER` não ponderado do concept irmão é explicitamente inadequado aqui — a fonte observa que sua saída "poderia estar longe do ótimo para o problema ponderado" — então relaxação LP mais arredondamento é a ferramenta que recupera uma 2-aproximação.
- Recorrer à relaxação LP sempre que você conseguir escrever seu problema como um programa inteiro 0-1: descartar a restrição de integralidade dá um limite inferior do ótimo que é *computável* em tempo polinomial — exatamente o ingrediente de "limite inferior barato" que a metodologia de prova do capítulo precisa.

## Aprofundamento

### GREEDY-SET-COVER: pegue repetidamente o conjunto que cobre mais elementos descobertos

Uma instância `(X, F)` do problema de set covering é um conjunto finito `X` mais uma família `F` de subconjuntos de `X` tal que todo elemento de `X` pertence a pelo menos um subconjunto em `F` (ou seja, `X` é a união de todos os conjuntos em `F`). Uma subfamília `C ⊆ F` **cobre** um conjunto `U` quando `U` está contido na união dos conjuntos em `C`; o problema é encontrar uma subfamília `C ⊆ F` de tamanho mínimo cuja união seja todo `X`. "Tamanho" aqui significa o **número de conjuntos** em `C`, não o número de elementos individuais — contar elementos seria inútil, já que qualquer subfamília de cobertura necessariamente contém todos os `|X|` deles.

```java
// Tradução fiel de GREEDY-SET-COVER(X, F) (CLRS, Seção 35.3).
// Retorna uma subfamília de F cuja união é X.
List<Set<Integer>> greedySetCover(Set<Integer> x, List<Set<Integer>> f) {
    Set<Integer> u = new HashSet<>(x);          // linha 1: U0 = X (elementos descobertos)
    List<Set<Integer>> c = new ArrayList<>();   // linha 2: C = {}

    while (!u.isEmpty()) {                      // linha 4
        Set<Integer> best = null;               // linha 5: selecione S em F maximizando |S ∩ Ui|
        int bestGain = -1;
        for (Set<Integer> s : f) {
            int gain = 0;
            for (int e : s) if (u.contains(e)) gain++;
            if (gain > bestGain) { bestGain = gain; best = s; }  // empates quebrados arbitrariamente
        }

        u.removeAll(best);                      // linha 6: U(i+1) = Ui - S
        c.add(best);                            // linha 7: C = C ∪ {S}
    }
    return c;                                   // linha 9
}
```

O contador de laço `i` no pseudocódigo do livro existe só para que a análise possa nomear os sucessivos conjuntos descobertos `U0, U1, U2, ...`; o algoritmo em si apenas encolhe um único conjunto de trabalho. `U0` começa como todo `X`, a linha 5 é a decisão gulosa (escolher um subconjunto que cubra o máximo possível de elementos *ainda descobertos*, quebrando empates arbitrariamente), e a linha 6 apaga esses elementos recém-cobertos do conjunto descoberto.

O trace abaixo executa `GREEDY-SET-COVER` na instância do próprio Exercício 35.3-1 da fonte: cada uma das dez palavras `arid, dash, drain, heard, lost, nose, shun, slate, snare, thread` é tratada como seu conjunto de letras, então `X` são as 12 letras distintas `{a, r, i, d, s, h, n, e, l, o, t, u}`. Empates na linha 5 são quebrados em favor da palavra que aparece primeiro no dicionário. Cada token é um elemento de `X`, e um elemento é removido da linha no momento em que a linha 6 o descarta do conjunto descoberto:

```viz
type: moves
remove t | Iteração 1, linha 5: "thread" = {t,h,r,e,a,d} cobre 6 das 12 letras descobertas, mais que qualquer outra palavra ("drain", "heard", "slate", "snare" cobrem 5). C = {thread}.
remove h | A linha 6 remove as seis letras de thread de U0: t, h, ...
remove r | ... r, ...
remove e | ... e, ...
remove a | ... a, ...
remove d | ... e d. U1 = {i, s, n, l, o, u}, seis letras ainda descobertas.
remove l | Iteração 2, linha 5: "lost", "nose" e "shun" cobrem 3 elementos de U1 cada; o empate vai para "lost" (primeira no dicionário), cobrindo {l, o, s}. C = {thread, lost}.
remove o | A linha 6 remove o ...
remove s | ... e s. U2 = {i, n, u}.
remove i | Iteração 3, linha 5: "drain" e "shun" cobrem 2 elementos de U2 cada; o empate vai para "drain", cobrindo {i, n}. C = {thread, lost, drain}. A linha 6 remove i ...
remove n | ... e n. U3 = {u}.
remove u | Iteração 4, linha 5: só "shun" contém u, então é a maximizadora. C = {thread, lost, drain, shun}. U4 fica vazio, então o laço while da linha 4 termina.
---
a
r
i
d
s
h
n
e
l
o
t
u
```

A cobertura gulosa aqui tem tamanho 4. Ela acaba sendo ótima nesta instância — `u` só ocorre em `shun`, então toda cobertura precisa conter `shun`, e nenhuma dupla de palavras restantes cobre juntas as letras remanescentes `{a, r, i, d, e, l, o, t}` — mas isso é uma propriedade desta instância, não uma garantia. A própria Figura 35.3 da fonte mostra uma instância de 12 pontos e seis conjuntos onde a cobertura mínima tem tamanho 3 enquanto `GREEDY-SET-COVER` retorna tamanho 4: ele escolhe `S1`, `S4`, `S5` e então `S3` ou `S6`, enquanto a cobertura ótima é `{S3, S4, S5}`.

### Por que a razão gulosa é O(lg |X|)

**Teorema 35.4**: `GREEDY-SET-COVER` é um algoritmo `O(lg |X|)`-aproximado em tempo polinomial.

A metade sobre tempo de execução é rápida: o laço roda no máximo `min(|X|, |F|)` vezes e cada corpo custa `O(|X|·|F|)`, dando `O(|X|·|F|·(|X| + |F|))` no total — polinomial no tamanho da entrada. (O Exercício 35.3-3 pede uma implementação rodando em tempo proporcional ao tamanho total de todos os conjuntos.)

A metade sobre a razão é a parte interessante, e segue a mesma metodologia "limite o algoritmo contra um limite inferior barato" descrita pelo concept irmão:

- Seja `C*` uma cobertura ótima e `k = |C*|`. Todo conjunto descoberto intermediário `Ui` é um subconjunto de `X`, então `C*` também o cobre — significando que a instância `(Ui, F)` tem uma cobertura ótima de tamanho no máximo `k`.
- Se `k` conjuntos bastam para cobrir `Ui`, então por princípio da casa dos pombos pelo menos um deles cobre pelo menos `|Ui| / k` de seus elementos. A linha 5 escolhe o conjunto que cobre o *máximo* de elementos descobertos, então ele cobre pelo menos essa quantidade, dando a recorrência de encolhimento `|U(i+1)| ≤ |Ui| − |Ui| / k = |Ui|·(1 − 1/k)`.
- Iterando essa recorrência a partir de `|U0| = |X|` dá `|Ui| ≤ |X|·(1 − 1/k)^i`.
- O algoritmo para quando `|Ui| < 1`. Usando `1 + x ≤ e^x` com `x = −1/k`, obtemos `(1 − 1/k)^k ≤ 1/e`, então depois de `i = ck` iterações o limite se torna `|X|·e^(−c)`. Exigir `|X|·e^(−c) < 1` dá `c > ln |X|`, então `c = ⌈ln |X|⌉` é suficiente.
- O número de iterações é igual a `|C|`, então `|C| ≤ ck = |C*|·⌈ln |X|⌉`.

A razão, portanto, *cresce* com a instância em vez de permanecer constante — mas só logaritmicamente, razão pela qual a fonte chama o resultado de "ainda assim útil". O Exercício 35.3-4 nota um limite muito mais fraco, mas trivialmente verdadeiro, para comparação: `|C| ≤ |C*|·max{|S| : S ∈ F}`.

### Randomização: uma 8/7-aproximação para MAX-3-CNF que é puro cara-ou-coroa

Um algoritmo randomizado é um **algoritmo `ρ(n)`-aproximado randomizado** quando, para qualquer entrada de tamanho `n`, o custo *esperado* `C` da solução que ele produz está dentro de um fator `ρ(n)` do custo ótimo `C*` — isto é, `max(C/C*, C*/C) ≤ ρ(n)`. É a mesma definição da razão determinística, com o custo do algoritmo substituído por uma esperança.

Satisfatibilidade MAX-3-CNF é a versão de otimização da satisfatibilidade 3-CNF: dada uma fórmula em que toda cláusula tem exatamente três literais distintos, em vez de perguntar se *todas* as cláusulas podem ser satisfeitas, retorne uma atribuição que satisfaça **o máximo de cláusulas possível**. Suponha adicionalmente que nenhuma cláusula contém uma variável e sua negação ao mesmo tempo (o Exercício 35.4-1 remove essa suposição).

```java
// O algoritmo inteiro por trás do Teorema 35.5 (CLRS, Seção 35.4).
boolean[] maxThreeCnfAssignment(int n, Random rnd) {
    boolean[] x = new boolean[n];
    for (int i = 0; i < n; i++) {
        x[i] = rnd.nextBoolean();   // cada variável definida como 1 com probabilidade 1/2
    }
    return x;
}
```

**Teorema 35.5**: definir independentemente cada variável como 1 com probabilidade 1/2 e como 0 com probabilidade 1/2 é um algoritmo 8/7-aproximado randomizado para satisfatibilidade MAX-3-CNF. A prova é um argumento de linearidade de esperança com três linhas:

- Defina o indicador `Yi = I{cláusula i é satisfeita}`. Como nenhum literal se repete dentro de uma cláusula e nenhuma variável aparece junto de sua negação, os três literais de uma cláusula são definidos independentemente.
- Uma cláusula falha apenas se todos os seus três literais caírem em 0, o que acontece com probabilidade `(1/2)³ = 1/8`. Então `Pr{cláusula i é satisfeita} = 7/8` e `E[Yi] = 7/8`.
- Seja `Y = Y1 + Y2 + ... + Ym` o número de cláusulas satisfeitas. Por linearidade de esperança, `E[Y] = 7m/8` — sem precisar de nenhuma suposição de independência *entre* cláusulas, o que é o que faz o argumento funcionar.
- Como `m` (todas as cláusulas) é um limite superior do ótimo, a razão é no máximo `m / (7m/8) = 8/7`.

### Programação linear: relaxe o programa inteiro, depois arredonde em 1/2

O problema de vertex cover de peso mínimo toma um grafo não direcionado `G = (V, E)` com um peso positivo `w(v)` em cada vértice; o peso de uma cobertura é a soma dos pesos de seus vértices, e o objetivo é uma cobertura de peso mínimo. Codifique como um **programa inteiro 0-1**: dê a cada vértice `v` uma variável `x(v) ∈ {0, 1}` significando "v está na cobertura", minimize a soma de `w(v)·x(v)` sobre todos os vértices, sujeito a `x(u) + x(v) ≥ 1` para toda aresta `(u, v)` — a restrição que diz que pelo menos um extremo de toda aresta é escolhido. Com todos os pesos iguais a 1 isso é exatamente o problema NP-difícil de otimização de vertex cover, então o próprio programa inteiro não é mais fácil do que o que codifica.

Agora descarte a restrição de integralidade `x(v) ∈ {0, 1}` e substitua por `0 ≤ x(v) ≤ 1`. O resultado é a **relaxação de programação linear**, e ela é solúvel em tempo polinomial. Toda solução viável do programa inteiro é viável para a relaxação, então o ótimo da relaxação é um **limite inferior** do peso mínimo verdadeiro — o limite inferior barato de que a prova precisa. O problema é que sua solução `x̄` é fracionária e não nomeia uma cobertura, então o algoritmo a arredonda:

```java
// Tradução fiel de APPROX-MIN-WEIGHT-VC(G, w) (CLRS, Seção 35.4).
Set<Integer> approxMinWeightVC(Graph g, Map<Integer, Double> w) {
    Set<Integer> c = new HashSet<>();                    // linha 1: C = {}

    // linha 2: resolva a relaxação LP -- minimize a soma de w(v)*x(v)
    // sujeito a x(u) + x(v) >= 1 para cada aresta (u,v), e 0 <= x(v) <= 1.
    Map<Integer, Double> xBar = solveLpRelaxation(g, w);

    for (int v : g.vertices()) {                         // linha 3
        if (xBar.get(v) >= 0.5) {                        // linha 4: arredonde para cima em 1/2
            c.add(v);                                    // linha 5
        }
    }
    return c;                                            // linha 6
}
```

**Teorema 35.6**: `APPROX-MIN-WEIGHT-VC` é um algoritmo 2-aproximado em tempo polinomial para vertex cover de peso mínimo. As duas metades da prova decorrem do limiar de arredondamento:

- **A saída realmente é uma cobertura.** Para qualquer aresta `(u, v)`, a restrição LP força `x̄(u) + x̄(v) ≥ 1`, então pelo menos um dos dois valores é pelo menos 1/2 e, portanto, pelo menos um extremo é arredondado para dentro. Toda aresta é coberta.
- **O peso é no máximo o dobro do ótimo.** Seja `z*` o valor ótimo do LP e `C*` uma cobertura ótima; como uma cobertura ótima é viável para a relaxação, `z* ≤ w(C*)`. Restringir a soma que define `z*` apenas aos vértices com `x̄(v) ≥ 1/2` só pode encolhê-la, e nesses vértices `x̄(v) ≥ 1/2`, então `z*` é pelo menos `(1/2)·w(C)`. Encadeando as duas dá `w(C) ≤ 2z* ≤ 2w(C*)`.

As restrições `x(v) ≤ 1` acabam sendo redundantes — o Exercício 35.4-4 pede para mostrar que removê-las produz um LP cujas soluções ótimas satisfazem `x(v) ≤ 1` de qualquer forma.

## Trade-offs

- **Uma razão logarítmica não é uma razão constante** — diferente das 2-aproximações do concept irmão, a garantia de `GREEDY-SET-COVER` degrada conforme a instância cresce: a cobertura retornada pode ser até `⌈ln |X|⌉` vezes o ótimo. A defesa da fonte é simplesmente que o logaritmo cresce devagar o suficiente para o resultado continuar útil, não que a razão seja justa para qualquer tamanho fixo.
- **O desempate guloso não é restrito, e isso importa** — a linha 5 escolhe *qualquer* maximizador, então o algoritmo é genuinamente não determinístico em sua saída. O Exercício 35.3-5 pede uma família de instâncias de `n` elementos nas quais o número de soluções distintas que `GREEDY-SET-COVER` pode retornar, puramente por diferentes desempates, é **exponencial** em `n`. Todas satisfazem o limite da razão; não têm todas o mesmo tamanho.
- **A razão randomizada limita uma esperança, não uma execução** — uma 8/7-aproximação randomizada não diz nada sobre o que uma única atribuição de cara-ou-coroa produz; diz que o número *esperado* de cláusulas satisfeitas é `7m/8`. Ainda assim é notável o quanto se ganha de graça aqui: o algoritmo nem sequer olha para a fórmula.
- **A relaxação LP compra um limite inferior solúvel, mas apenas fracionário** — resolver a relaxação é tempo polinomial, mas sua resposta não é uma cobertura de forma alguma até ser arredondada, e é no arredondamento que se gasta o fator 2. O limiar de 1/2 é o que simultaneamente garante viabilidade (da restrição de aresta) e limita a perda (cada variável arredondada para cima já estava pelo menos meio-paga no objetivo do LP).
- **O algoritmo não ponderado não se transfere** — a fonte é direta sobre isso: `APPROX-VERTEX-COVER` da Seção 35.1, que simplesmente pega ambos os extremos de uma aresta arbitrária, pode retornar uma cobertura longe do ótimo quando os vértices carregam pesos, já que um par barato-e-barato e um par barato-e-caro parecem idênticos para ele.
- **A Seção 35.4 é uma introdução, não um panorama completo** — a própria fonte diz que "só arranha a superfície" de randomização e programação linear como técnicas de projeto de aproximação, e deixa o aprofundamento para as notas do capítulo.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4ª Edição, Capítulo 35 "Approximation Algorithms", Seção 35.3 "The set-covering problem" e Seção 35.4 "Randomization and linear programming", pp. 1115-1124](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
