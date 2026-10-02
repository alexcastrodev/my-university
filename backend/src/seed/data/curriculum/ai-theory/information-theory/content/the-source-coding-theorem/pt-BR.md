---
version: 1.0
updatedAt: 2026-09-07
title: O Teorema da Codificação de Fonte
summary: O teorema da codificação de fonte de Shannon (nenhum código sem perdas consegue vencer um comprimento médio de H(X) bits por símbolo, e a entropia é assintoticamente alcançável por algum código) é enunciado e motivado com um esboço de prova real, no mesmo espírito de argumento de contagem já usado no limite inferior da ordenação por comparação de `algorithms`.
---
## Objetivos de Aprendizagem

- Enunciar com precisão o teorema da codificação de fonte de Shannon: a entropia é ao mesmo tempo um limite inferior e um alvo assintoticamente alcançável para o comprimento médio de um código sem perdas.
- Reproduzir a direção mais fácil do teorema (uma prova real de que nenhum código sem perdas consegue vencer a entropia em média) pela desigualdade de Gibbs.
- Explicar, em nível de intuição, por que a entropia é assintoticamente alcançável, sem toda a maquinaria formal das sequências típicas.
- Ligar o estilo de argumento de contagem desta prova ao limite inferior da ordenação por comparação já provado em `algorithms`.

## Contexto e Motivação

Todos os conceitos até aqui construíram em direção a um único número, a entropia, que mede a incerteza inerente de uma fonte. O teorema da codificação de fonte é onde esse número mostra seu valor: ele enuncia (e este conceito prova a metade mais fácil) exatamente por que a entropia não é só *uma* estatística-resumo útil, e sim *o* limite fundamental da compressão sem perdas. Nenhum código mais esperto, por mais engenhoso que seja, consegue vencê-la em média, e (um fato enunciado aqui, mas desenvolvido concretamente nos próximos conceitos) existem códigos que chegam arbitrariamente perto dela. É o teorema que transforma "os limites da compressão" (apresentados lá no início desta disciplina com um simples argumento de contagem) numa afirmação exata e quantitativa: o limite é precisamente `H(X)` bits por símbolo, e não apenas "existe algum limite".

## Teoria Central

### Enunciado do teorema

**Teorema da codificação de fonte de Shannon.** Para uma fonte que emite símbolos de forma independente segundo uma distribuição com entropia `H(X)`:

1. **(Recíproca / limite inferior.)** Nenhum código unicamente decodificável consegue atingir um comprimento médio de palavra-código estritamente menor que `H(X)` bits por símbolo.
2. **(Alcançabilidade.)** Para qualquer `ε > 0`, existe um código unicamente decodificável com comprimento médio menor que `H(X) + ε` bits por símbolo: a entropia pode ser aproximada arbitrariamente, e atingida exatamente no limite ao codificar blocos de símbolos longos o bastante de uma vez.

Juntas, essas duas partes determinam a entropia como *exatamente* o limite fundamental de compressão: não só um limite inferior com uma diferença desconhecida em relação ao que é alcançável, mas um limite que é ao mesmo tempo invencível e (assintoticamente) atingível.

### Provando a recíproca: nenhum código vence a entropia

**Afirmação.** Para qualquer código unicamente decodificável que atribua comprimento `l(x)` ao símbolo `x`, o comprimento médio `L = ∑ₓ p(x)·l(x)` satisfaz `L ≥ H(X)`.

**Esboço de prova, pela desigualdade de Gibbs.** Os comprimentos de qualquer código unicamente decodificável satisfazem a desigualdade de Kraft `∑ₓ 2^(−l(x)) ≤ 1` (provada por completo no próximo conceito, assumida aqui). Defina `q(x) = 2^(−l(x)) / K`, em que `K = ∑ₓ2^(−l(x)) ≤ 1`; esse `q` é uma distribuição de probabilidade válida (é não negativo e soma 1 por construção). A desigualdade de Gibbs (`kl-divergence-relative-entropy-and-cross-entropy`) dá `D(p‖q) ≥ 0`, ou seja, `∑ₓ p(x)log₂(p(x)/q(x)) ≥ 0`, que se rearranja como `∑ₓ p(x)log₂p(x) ≥ ∑ₓ p(x)log₂q(x)`. Substituindo `q(x) = 2^(−l(x))/K`:

```text
−H(X) ≥ ∑ₓ p(x)·[−l(x) − log₂K] = −L − log₂K
```

Como `K ≤ 1`, `log₂K ≤ 0`, então `−log₂K ≥ 0`, dando `−H(X) ≥ −L − log₂K ≥ −L`, ou seja, `H(X) ≤ L`. ∎

Estruturalmente, essa é exatamente a mesma técnica de prova dos limites de `entropy-the-expected-information-content` e de `mutual-information`: um argumento pela desigualdade de Gibbs/Jensen que compara a distribuição verdadeira com uma distribuição de comparação construída com engenho, aqui montada diretamente a partir dos próprios comprimentos do código.

### Por que a entropia é alcançável: a intuição (não a prova completa)

A prova completa da direção de alcançabilidade (por sequências típicas e, no caso geral, argumentos de codificação aleatória) é maquinaria genuinamente de pós-graduação, adequada a um curso como o MIT 6.441 ou aos capítulos avançados de Cover & Thomas, mas mais do que uma introdução voltada à computação precisa reproduzir por inteiro. A intuição central, porém, é simples e vale a pena ser enunciada com precisão: codificar não um símbolo por vez, mas blocos longos de `n` símbolos de uma vez. Conforme `n` cresce, a lei dos grandes números (já vista em `foundations/probability-statistics`) garante que a sequência de símbolos *efetivamente* observada fica esmagadoramente provável de ser uma de um conjunto relativamente pequeno de sequências "típicas" (aquelas cujas frequências empíricas de símbolos ficam perto das probabilidades verdadeiras), e existem só cerca de `2^(nH(X))` dessas sequências típicas, entre as muito mais numerosas `|alfabeto|ⁿ` sequências possíveis no total. Atribuir palavras-código curtas (cerca de `nH(X)` bits no total) apenas a esse conjunto típico, e aceitar uma probabilidade ínfima de falha nas raras sequências atípicas, leva a *média* de bits por símbolo para `H(X) + ε`, para qualquer `ε` desejado, conforme `n` fica grande o bastante. `huffman-coding-construction`, alguns conceitos adiante, vai mostrar uma construção concreta e totalmente rigorosa que chega perto desse limite (embora nem sempre o atinja exatamente) sem nada dessa maquinaria assintótica de comprimento de bloco. O esboço de alcançabilidade aqui trata de *por que* o limite é alcançável em princípio, e não do algoritmo que o alcança.

### O paralelo com o limite inferior da ordenação por comparação

`the-comparison-sort-lower-bound` de `algorithms` prova que qualquer ordenação baseada em comparações precisa de pelo menos `log₂(n!)` comparações, por um argumento de árvore de decisão: a execução de uma ordenação por comparação corresponde a um caminho descendo uma árvore de decisão binária, e uma árvore que distingue `n!` ordenações possíveis precisa ter profundidade de pelo menos `log₂(n!)`. A recíproca da codificação de fonte provada acima é parente próxima exatamente desse estilo de argumento: ambos são, no fundo, argumentos de contagem que mostram que uma estrutura fixa (uma árvore de decisão de comparações; um código unicamente decodificável) não consegue fazer melhor que um limite derivado de quanta incerteza genuína (o número de ordenações; a entropia da fonte) precisa ser resolvida.

## Exemplos Resolvidos

### Exemplo 1: conferindo a recíproca contra um código real de comprimento fixo

Para a fonte de 4 símbolos do Exemplo 3 de `entropy-the-expected-information-content` (`p(A)=0.5, p(B)=0.25, p(C)=p(D)=0.125`, `H(X) = 1.75` bits), um código ingênuo de comprimento fixo atribui a todo símbolo exatamente 2 bits (`00, 01, 10, 11`, o suficiente para distinguir 4 símbolos). Comprimento médio: `L = 2` bits, já que toda palavra-código tem o mesmo comprimento, qualquer que seja a probabilidade. Isso satisfaz a recíproca (`L = 2 ≥ H(X) = 1.75`), mas desperdiça `2 − 1.75 = 0.25` bits por símbolo em média em relação ao limite teórico, exatamente a diferença que o código de comprimento variável de `huffman-coding-construction` vai fechar.

### Exemplo 2: um código que supera o de comprimento fixo ingênuo, ainda respeitando o limite

Para a mesma fonte, considere o código de comprimento variável `A→0, B→10, C→110, D→111` (comprimentos 1, 2, 3, 3). Comprimento médio: `L = 0.5·1 + 0.25·2 + 0.125·3 + 0.125·3 = 0.5 + 0.5 + 0.375 + 0.375 = 1.75` bits, exatamente igual a `H(X) = 1.75`. Isso confirma que o limite da recíproca é justo para esta distribuição em particular (cujas probabilidades por acaso são potências exatas de 2); esse código específico vai reaparecer, construído de forma sistemática em vez de adivinhado, em `huffman-coding-construction`.

### Exemplo 3: por que uma distribuição com probabilidades que não são potências de 2 não atinge o limite exatamente com códigos de um símbolo

Para uma fonte de 3 símbolos com `p(A)=0.5, p(B)=0.3, p(C)=0.2`: `H(X) = −(0.5log₂0.5 + 0.3log₂0.3 + 0.2log₂0.2) ≈ −(−0.5 − 0.521 − 0.464) = 1.485` bits. Como comprimentos de palavras-código precisam ser inteiros positivos, nenhum código de um símbolo por vez consegue atingir um comprimento médio fracionário exatamente igual a `1.485`: o melhor alcançável com códigos de um símbolo será estritamente maior que `H(X)`. Essa diferença é exatamente o que a intuição de codificação em blocos da direção de alcançabilidade fecha: codificar pares, trincas ou blocos mais longos de símbolos juntos permite que a média de bits por símbolo se aproxime arbitrariamente de `1.485`, mesmo que nenhuma atribuição de um símbolo por vez consiga atingi-la exatamente.

## Equívocos Comuns e Armadilhas

- **"O teorema da codificação de fonte diz que entropia bits por símbolo sempre é alcançável com um código simples."** A recíproca (nenhum código vence a entropia) é provada concretamente aqui; a direção de alcançabilidade é genuinamente assintótica: exige codificar blocos longos de símbolos, ou aceitar uma pequena diferença, como o Exemplo 3 mostra concretamente para uma distribuição cujas probabilidades não são potências exatas de 2.
- **"Este teorema só se aplica a distribuições especialmente construídas e 'bem-comportadas'."** A prova da recíproca na Teoria Central não impõe nenhuma restrição a `p(x)` além de ser uma distribuição de probabilidade válida: ela vale para toda fonte discreta, e é exatamente por isso que funciona como um limite fundamental universal, e não como um resultado de caso especial.
- **"Atingir o limite da entropia exige saber algo engenhoso sobre os símbolos específicos, e não só suas probabilidades."** O limite e o argumento de alcançabilidade dependem só da distribuição de probabilidade `p(x)`, nunca do que os símbolos representam, exatamente a mesma postura em relação à semântica já estabelecida desde `information-content-and-self-information`.

## Resumo

O teorema da codificação de fonte de Shannon estabelece a entropia como o limite fundamental exato da compressão sem perdas: nenhum código unicamente decodificável consegue vencer `H(X)` bits por símbolo em média (provado aqui pela desigualdade de Gibbs aplicada a uma distribuição de comparação construída a partir dos próprios comprimentos do código, a mesma técnica de prova usada ao longo desta disciplina), e a entropia pode ser aproximada arbitrariamente codificando blocos de símbolos suficientemente longos juntos (enunciado aqui no nível de intuição das sequências típicas, com a prova assintótica completa deixada para tratamentos mais avançados). A técnica de prova é parente próxima do argumento de contagem por árvore de decisão que `algorithms` já usou para o limite inferior da ordenação por comparação. Os próximos conceitos transformam esse limite abstrato em códigos concretos e construíveis, começando por exatamente quais conjuntos de comprimentos de palavras-código são sequer alcançáveis.

## Documentation Links

- [Shannon: A Mathematical Theory of Communication (1948)](https://people.math.harvard.edu/~ctm/home/text/others/shannon/entropy/entropy.pdf): doc
- [Stanford EE276: Course Outline](https://web.stanford.edu/class/ee276/outline.html): doc
- [MIT 6.441: Information Theory, Syllabus](https://ocw.mit.edu/courses/6-441-information-theory-spring-2016/pages/syllabus/): doc
