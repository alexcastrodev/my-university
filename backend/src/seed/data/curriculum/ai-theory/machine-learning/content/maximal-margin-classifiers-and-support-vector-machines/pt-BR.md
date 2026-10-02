---
version: 1.0
updatedAt: 2026-09-06
title: Classificadores de Margem Máxima e Máquinas de Vetores de Suporte
summary: Escolher não uma reta qualquer que separe duas classes, mas aquela com a maior margem possível dos dois lados. O punhado de pontos que essa margem de fato toca, os vetores de suporte, são os únicos dados dos quais o classificador final depende.
---
## Objetivos de Aprendizagem

- Definir a margem de um classificador linear e explicar por que maximizá-la (em vez de apenas atingir erro de treino zero) é uma escolha fundamentada.
- Enunciar o problema de otimização da máquina de vetores de suporte e definir quais pontos de treino são "vetores de suporte".
- Explicar por que a fronteira de decisão da SVM depende só dos vetores de suporte, e não de todos os pontos de treino.
- Calcular a margem e identificar os vetores de suporte num pequeno exemplo resolvido linearmente separável.

## Contexto e Motivação

A regressão logística, vista antes nesta disciplina, encontra *uma* fronteira de decisão linear que separa duas classes, mas entre a família (normalmente infinita) de fronteiras que separam os dados de treino com erro zero, ela não tem preferência explícita por uma ou outra além do que sua perda probabilística acaba produzindo. As máquinas de vetores de suporte fazem uma pergunta geométrica mais afiada: entre todos os hiperplanos separadores, qual deixa a maior margem possível, a zona de folga vazia mais larga, entre as duas classes? É um princípio de projeto genuinamente diferente, motivado pelas mesmas preocupações de generalização (viés-variância, dimensão VC) já vistas antes: intuitivamente, uma fronteira com mais espaço de respiro dos dois lados tem menos chance de classificar errado um ponto novo que caia perto da fronteira dos dados de treino, mas do lado correto.

## Teoria Central

### A margem e o classificador de margem máxima

Para um conjunto de dados linearmente separável, a **margem** de um hiperplano separador é a distância do hiperplano até o ponto de treino mais próximo de qualquer uma das classes. O **classificador de margem máxima** é o hiperplano específico que maximiza essa distância; geometricamente, a "rua" mais larga possível que pode ser traçada entre as duas classes sem tocar nenhum ponto de treino.

### Vetores de suporte

Os pontos de treino que ficam exatamente na borda da margem (os pontos de cada classe mais próximos do hiperplano de decisão) são chamados de **vetores de suporte**. Uma propriedade marcante e nada óbvia da solução de margem máxima: ela é determinada *inteiramente* por esses vetores de suporte. Qualquer outro ponto de treino poderia ser movido para qualquer lugar mais longe da fronteira (desde que continue classificado corretamente) sem mudar em nada o hiperplano ajustado, um contraste nítido com a regressão logística, cujos parâmetros ajustados são influenciados, ao menos um pouco, por cada ponto de treino.

### Margens suaves para dados não perfeitamente separáveis

Dados reais raramente são perfeitamente separáveis por uma reta. A **SVM de margem suave** relaxa a exigência rígida de "todo ponto fora da margem", permitindo que alguns pontos violem a margem (ou até sejam classificados errado), controlada por um parâmetro de penalidade `C` que equilibra a largura da margem contra o número e a gravidade das violações. Um `C` grande penaliza fortemente as violações (favorecendo uma margem mais estreita que classifica corretamente mais pontos de treino), enquanto um `C` pequeno tolera mais violações em troca de uma margem mais larga e mais robusta. É um análogo direto da força de regularização `λ` vista antes no bloco de complexidade de modelos desta disciplina, agora controlando a troca entre margem e violações em vez do tamanho dos coeficientes diretamente.

## Exemplos Resolvidos

### Exemplo 1: identificando vetores de suporte à mão

Considere um conjunto de dados 1D simples: classe +1 nas posições `{3, 4, 5}`, classe −1 nas posições `{−5, −4, −2}`. O hiperplano de margem máxima (aqui, um único ponto de limiar) fica exatamente no meio entre os pontos mais próximos de cada classe: o ponto +1 mais próximo está em 3, o ponto −1 mais próximo está em −2, então a fronteira fica em `(3 + (−2))/2 = 0.5`, com largura de margem `(3 − (−2))/2 = 2.5` de cada lado. Os vetores de suporte são exatamente os pontos em 3 e −2 (o ponto mais próximo de cada classe), enquanto os pontos em 4, 5, −5 e −4 não têm papel algum na determinação dessa fronteira; mover o ponto em 5 para 500 não deslocaria a fronteira ajustada nem uma fração.

### Exemplo 2: uma troca de margem suave

Suponha que apareça mais um ponto +1 na posição `−1` (dentro do que seria o território da classe −1), tornando os dados não mais perfeitamente separáveis por nenhum limiar único. Com um `C` grande (penalidade pesada para violações de margem), a SVM de margem suave pode colocar a fronteira muito perto desse outlier para classificá-lo corretamente, ao custo de uma margem bem mais estreita no geral. Com um `C` pequeno, a SVM pode, em vez disso, aceitar esse único ponto como uma violação de margem (ou até uma classificação errada), mantendo praticamente intacta a margem larga de 2.5 do Exemplo 1. É uma ilustração real e direta de `C` equilibrando o mesmo "custo de acertar essa única exceção" contra o "risco de uma fronteira frágil e estreita" que a força de regularização equilibrou para o tamanho dos coeficientes antes nesta disciplina.

## Equívocos Comuns e Armadilhas

- **"As SVMs encontram a fronteira que melhor separa as classes em média, como o ajuste baseado em verossimilhança da regressão logística."** As SVMs otimizam um objetivo fundamentalmente diferente e puramente geométrico (margem máxima), e não um critério de verossimilhança ou de erro médio; os dois métodos podem produzir fronteiras visivelmente diferentes mesmo nos mesmos dados linearmente separáveis.
- **"Todo ponto de treino importa igualmente para a fronteira ajustada de uma SVM."** É o oposto da verdade: como mostra o Exemplo 1, só os vetores de suporte (os pontos mais próximos da fronteira) determinam o hiperplano ajustado. Essa esparsidade é uma propriedade prática genuinamente útil, já que o modelo final pode ser descrito usando só os vetores de suporte, e não o conjunto de treino inteiro.
- **"Uma margem grande sempre significa melhor generalização, sem desvantagem."** Uma margem maior em geral se correlaciona com melhor generalização em dados separáveis, mas, para dados não separáveis, o parâmetro de margem suave `C` precisa ser ajustado (por validação cruzada, vista antes nesta disciplina). Um `C` pequeno demais pode forçar uma margem tão larga que erros reais de classificação demais são tolerados, causando underfitting.

## Resumo

As máquinas de vetores de suporte escolhem, entre todos os hiperplanos que separam duas classes, aquele com a margem máxima: a folga mais larga possível entre os pontos mais próximos de cada classe. Essa fronteira ajustada depende só dos vetores de suporte, o punhado de pontos mais próximos, o que torna as SVMs ao mesmo tempo geometricamente distintas e esparsas na prática em comparação com os classificadores anteriores desta disciplina. A variante de margem suave, controlada por um parâmetro de penalidade `C`, estende essa ideia a dados realisticamente não separáveis, equilibrando a largura da margem contra erros de classificação de forma diretamente análoga à troca de força de regularização já vista.

## Documentation Links

- [Caltech CS 156: Learning From Data, Lecture 14: Support Vector Machines](https://work.caltech.edu/telecourse.html): a aula real que deriva o problema de otimização de margem máxima e os vetores de suporte.
- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): o Capítulo 9 (Support Vector Machines) cobre o classificador de margem suave e a troca de `C` no mesmo enquadramento usado aqui.
