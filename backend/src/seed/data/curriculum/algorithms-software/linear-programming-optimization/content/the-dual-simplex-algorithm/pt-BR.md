---
version: 1.0
updatedAt: 2026-09-13
title: O Algoritmo Simplex Dual
summary: O simplex dual parte de um tableau dual-factível mas primal-infactível (linha objetivo sem coeficientes negativos, mas algum lado direito negativo) e restaura factibilidade primal sem nunca perder factibilidade dual, o espelho estrutural exato do simplex comum, ideal para reotimizar depois de adicionar uma restrição nova.
---
## Objetivos de Aprendizagem

- Reconhecer um tableau dual-factível e primal-infactível: todo coeficiente na linha objetivo é não negativo, mas pelo menos um lado direito é negativo.
- Enunciar as regras de variável de entrada e saída do algoritmo simplex dual, e explicar por que são, estruturalmente, uma imagem espelhada das regras do simplex comum (primal).
- Executar o algoritmo simplex dual em um tableau concreto, restaurando factibilidade primal sem nunca perder factibilidade dual pelo caminho.
- Explicar o uso prático mais comum do algoritmo: reotimizar um programa linear já resolvido depois que uma nova restrição é adicionada, sem reiniciar a busca do zero.
- Verificar, em um exemplo resolvido, que o simplex dual alcança o valor ótimo idêntico que o simplex comum alcançaria recomeçando do início.

## Contexto e Motivação

O simplex comum, como construído vários conceitos atrás nesta trilha, começa de um tableau primal-factível (todo lado direito não negativo) que tipicamente está longe do ótimo (a linha objetivo tem coeficientes negativos), e trabalha em direção à otimalidade um pivô de cada vez sem nunca sacrificar factibilidade. Este conceito constrói a imagem espelhada desse processo: o **algoritmo simplex dual** parte de um tableau que já é **dual factível** (a linha objetivo já não tem coeficientes negativos, a condição de otimalidade em direção à qual o simplex comum trabalha) mas é **primal infactível** (algum lado direito é negativo, violando a não-negatividade de uma variável básica), e trabalha em direção à factibilidade primal um pivô de cada vez sem nunca sacrificar factibilidade dual. Essa situação exata, dual-factível mas primal-infactível, surge naturalmente e frequentemente na prática: adicionar uma nova restrição a um programa linear já resolvido tipicamente deixa a linha objetivo do antigo tableau ótimo intocada (ainda dual factível) enquanto introduz uma nova linha que a antiga solução viola (primal infactível), e reotimizar a partir desse ponto de partida diretamente é dramaticamente mais barato que resolver o problema aumentado novamente a partir da origem.

## Teoria Central

### O algoritmo espelhado

Onde o simplex comum escolhe uma variável de **entrada** primeiro (coeficiente mais negativo na linha objetivo) e depois uma variável de **saída** via um teste da razão na coluna de entrada, o simplex dual inverte a ordem inteiramente:

1. **Variável de saída primeiro.** Escolha a linha cujo lado direito é mais negativo (a variável básica mais infactível); a variável básica dessa linha sai.
2. **Variável de entrada em segundo, via um teste da razão invertido.** Entre as colunas com coeficiente *negativo* na linha de saída (uma coluna com coeficiente não negativo ali não consegue restaurar factibilidade sem quebrar factibilidade dual em outro lugar, e é excluída da consideração inteiramente), escolha aquela que minimiza a razão (coeficiente da linha objetivo) dividido por (o valor absoluto do coeficiente daquela coluna na linha de saída). Essa razão, calculada só sobre colunas de coeficiente negativo, é o espelho estrutural exato do teste da razão do simplex comum sobre colunas de coeficiente positivo.
3. **Pivoteie exatamente como antes**, eliminação de Gauss-Jordan em torno da entrada escolhida, e repita até que todo lado direito seja não negativo (factibilidade primal restaurada), ponto no qual, já que factibilidade dual foi mantida em todo passo pelo caminho, o tableau atual é imediatamente ótimo para o problema aumentado, sem nenhum trabalho adicional necessário.

### Por que esta é a ferramenta natural para reotimização

O cenário prático mais comum para o simplex dual é exatamente o que o exemplo resolvido deste conceito constrói: um programa linear já foi resolvido até a otimalidade pelo simplex comum, e então uma nova restrição é adicionada (um limite de recurso apertado descoberto depois do fato, uma nova restrição regulatória, um cenário de "e se também exigíssemos..."). A linha objetivo do tableau ótimo anterior, expressa em termos das *mesmas* variáveis básicas, é completamente não afetada por adicionar uma nova linha, ela ainda é dual factível. Mas a nova linha, expressa em termos dessa mesma base, pode muito bem ter um lado direito negativo (exatamente quando a antiga solução ótima viola a nova restrição), tornando o tableau aumentado primal infactível. Reiniciar o simplex comum completamente da origem jogaria fora tudo que já foi calculado; o simplex dual em vez disso repara *só* a nova infactibilidade diretamente, tipicamente em muito menos pivôs do que um reinício completo precisaria.

## Exemplos Resolvidos

### Exemplo 1: reotimizando o PL da marcenaria depois de adicionar uma nova restrição `x₁ ≤ 2`

**Problema:** Os conceitos anteriores desta trilha resolveram `maximizar 70x₁ + 90x₂` sujeito a `x₁+x₂≤10`, `x₁+3x₂≤24`, alcançando o tableau ótimo `x₁ + 1,5s₁ - 0,5s₂ = 3` (linha 1), `x₂ - 0,5s₁ + 0,5s₂ = 7` (linha 2), `z + 60s₁ + 10s₂ = 840` (objetivo), com `x₁=3, x₂=7`. Suponha que uma nova restrição, `x₁ ≤ 2`, seja adicionada. Reotimize usando o simplex dual, partindo desse tableau existente em vez do zero.

**Construindo a nova linha, em termos da base atual.** Substituindo `x₁ = 3 - 1,5s₁ + 0,5s₂` (da linha 1) na nova restrição `x₁ ≤ 2` dá `3 - 1,5s₁ + 0,5s₂ ≤ 2`, ou seja, `-1,5s₁ + 0,5s₂ ≤ -1`, e adicionando uma folga `s₃`: **linha 3:** `-1,5s₁ + 0,5s₂ + s₃ = -1`. A variável básica dessa linha é `s₃ = -1`, primal infactível (viola `s₃ ≥ 0`), enquanto a linha objetivo `z+60s₁+10s₂=840` permanece inteiramente inalterada, ainda dual factível (nenhum coeficiente negativo).

**Simplex dual, variável de saída:** Só a linha 3 tem um lado direito negativo (`-1`), então `s₃` sai.

**Simplex dual, variável de entrada:** Na linha 3, os coeficientes são `s₁: -1,5`, `s₂: +0,5` (o próprio coeficiente de `s₃`, `+1`, é excluído por ser a própria coluna da variável de saída). Só `s₁` tem coeficiente negativo, então é a única candidata e entra diretamente (com só uma coluna elegível, o teste da razão não tem nada para comparar).

**Pivoteando no coeficiente de `s₁` da linha 3 (`-1,5`):** Dividindo a linha 3 por `-1,5` dá `s₁ - (1/3)s₂ - (2/3)s₃ = 2/3`. Eliminando `s₁` da linha 1 (`linha1 - 1,5×linha3nova`) dá `x₁ + s₃ = 2`. Eliminando `s₁` da linha 2 (`linha2 + 0,5×linha3nova`) dá `x₂ + (1/3)s₂ - (1/3)s₃ = 22/3`. Eliminando `s₁` da linha objetivo (`obj - 60×linha3nova`) dá `z + 30s₂ + 40s₃ = 800`.

**Resultado:** Todo lado direito (`2`, `22/3`, `2/3`) agora é não negativo, factibilidade primal restaurada, e a linha objetivo (`z+30s₂+40s₃=800`) ainda não tem coeficientes negativos, então isso é imediatamente ótimo: `x₁=2`, `x₂=22/3`, valor `800`, alcançado em exatamente **um** pivô do simplex dual partindo do antigo tableau ótimo.

**Verificação independente:** Com `x₁` limitado a `2`, as restrições restantes sobre `x₂` são `x₂ ≤ 10-2=8` (da primeira) e `3x₂ ≤ 24-2=22`, ou seja, `x₂ ≤ 22/3≈7,33` (da segunda, a vinculante). Objetivo em `x₁=2, x₂=22/3`: `70(2)+90(22/3) = 140+660=800`, correspondendo exatamente ao resultado do simplex dual, confirmando a resposta independentemente sem precisar rodar o simplex comum no problema aumentado a partir da origem de forma alguma.

## Equívocos Comuns e Armadilhas

- **"O simplex dual resolve o programa linear dual."** Ele resolve o problema *primal* (as mesmas variáveis, `x₁` e `x₂`, aparecem na resposta final), é chamado de simplex "dual" porque mantém factibilidade dual como seu invariante ao longo de toda a execução, espelhando exatamente como o simplex comum ("primal") mantém factibilidade primal como seu próprio invariante; nenhum dos nomes se refere a qual problema, primal ou dual, está de fato sendo resolvido.
- **"Qualquer coluna com coeficiente negativo na linha de saída é uma escolha de variável de entrada igualmente válida."** O teste da razão da Teoria Central (minimizando o coeficiente da linha objetivo dividido pelo valor absoluto do coeficiente da linha de saída, só entre colunas de coeficiente negativo) não é arbitrário, escolher incorretamente entre múltiplas candidatas de coeficiente negativo pode reintroduzir um coeficiente negativo na linha objetivo, quebrando a factibilidade dual que o algoritmo é especificamente construído para preservar em todo passo.
- **"Resolver do zero e usar o simplex dual para reotimizar depois de uma nova restrição sempre dão respostas diferentes, já que partem de pontos diferentes."** O resultado do Exemplo 1 (`x₁=2, x₂=22/3`, valor `800`) é verificado independentemente por substituição direta, confirmando que é o ótimo real do problema aumentado; o simplex dual alcança a resposta correta idêntica que o simplex comum eventualmente alcançaria reiniciando da origem, simplesmente em muito menos passos reaproveitando o trabalho da solução anterior.
- **"O simplex dual é só uma curiosidade teórica, já que o simplex comum sempre poderia simplesmente ser rerrodado do zero."** O Exemplo 1 precisou de exatamente um pivô para reotimizar depois de uma nova restrição; rerrodar o simplex comum no problema aumentado a partir da origem não seria necessariamente nem de longe tão rápido, essa capacidade eficiente de reotimização é precisamente por que o simplex dual é maquinário padrão em solvers reais lidando com análise de sensibilidade e refinamento iterativo de modelo, não meramente um exercício de imagem espelhada.

## Resumo

O simplex dual parte de um tableau que é dual factível (nenhum coeficiente negativo na linha objetivo) mas primal infactível (algum lado direito negativo), e restaura factibilidade primal um pivô de cada vez sem nunca quebrar factibilidade dual, o espelho estrutural exato do próprio processo do simplex comum. Sua variável de saída é a linha mais infactível (lado direito mais negativo); sua variável de entrada é escolhida, só entre as colunas de coeficiente negativo dessa linha, por um teste da razão invertido. Essa situação, dual factível mas primal infactível, surge naturalmente sempre que uma nova restrição é adicionada a um programa linear já ótimo, exatamente o cenário que o Exemplo 1 trabalha por completo: adicionar `x₁≤2` ao tableau ótimo do PL da marcenaria precisou de exatamente um pivô do simplex dual para alcançar o novo ótimo, `x₁=2, x₂=22/3` no valor `800`, verificado independentemente por substituição direta, sem nunca reiniciar a busca a partir da origem. O próximo conceito se volta para um tipo de extensão inteiramente diferente: programas lineares cujas variáveis são exigidas a assumir valores inteiros, e o método branch-and-bound construído para lidar com eles.

## Documentation Links

- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
- [Dantzig, G. B. (1963). Linear Programming and Extensions. Princeton University Press.](https://press.princeton.edu/books/paperback/9780691059136/linear-programming-and-extensions): book
