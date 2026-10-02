---
version: 1.0
updatedAt: 2026-09-06
title: "A Taxonomia: Supervisionado, Não Supervisionado e por Reforço"
summary: A divisão em três que organiza todo o campo do machine learning (supervisionado, que aprende com exemplos rotulados; não supervisionado, que encontra estrutura sem rótulo algum; e por reforço, que aprende com recompensas por meio de interação) e por que esta disciplina cobre os dois primeiros em profundidade, apontando para material já publicado no caso do terceiro.
---
## Objetivos de Aprendizagem

- Enunciar a taxonomia em três que organiza o machine learning (aprendizado supervisionado, não supervisionado e por reforço) e classificar uma dada tarefa na categoria correta só a partir dos seus dados.
- Distinguir as duas subtarefas do aprendizado supervisionado, regressão (prever um número) e classificação (prever uma categoria), a partir de uma única descrição da variável-alvo.
- Explicar o que torna o aprendizado não supervisionado fundamentalmente mais difícil de avaliar que o supervisionado: não há verdade de referência contra a qual conferir uma previsão.
- Explicar por que esta disciplina cobre o aprendizado supervisionado e o não supervisionado em profundidade, mas trata o aprendizado por reforço como material já visto, e não como conteúdo novo.

## Contexto e Motivação

Machine learning não é um algoritmo nem um tipo de problema: é uma família de problemas distinguidos por uma pergunta, que tipo de retorno (feedback) o aprendiz recebe? O CS229 de Stanford organiza toda a sua ementa em torno dessa divisão, e ela é a primeira coisa que vale a pena fixar com clareza antes de apresentar qualquer algoritmo, porque a taxonomia determina qual família de técnicas sequer se aplica.

O **aprendizado supervisionado** parte de um conjunto de exemplos rotulados (cada entrada `x` emparelhada com sua saída correta `y`), e o objetivo é aprender uma função que preveja `y` para um `x` novo que ela nunca viu. Quando `y` é um número real (preço de uma casa, temperatura, o valor de uma ação amanhã), isso se chama **regressão**; quando `y` é uma categoria de um conjunto finito (spam ou não spam, dígito de 0 a 9, subtipo de câncer), isso se chama **classificação**. A maior parte desta disciplina se organiza em torno desse par.

O **aprendizado não supervisionado** parte de um conjunto de dados sem rótulo algum (só uma coleção de `x`'s), e o objetivo é encontrar estrutura nele mesmo assim: agrupar pontos parecidos (clusterização) ou encontrar um resumo de dimensão menor que capture a maior parte do que varia nos dados (redução de dimensionalidade). Como não há `y` contra o qual conferir uma previsão, avaliar um resultado não supervisionado é intrinsecamente mais difícil, e muitas vezes mais subjetivo, que avaliar um supervisionado.

O **aprendizado por reforço** é um terceiro cenário, distinto: um agente toma ações num ambiente ao longo do tempo, recebe um sinal de recompensa escalar e precisa aprender uma política que maximize a recompensa acumulada. É um retorno atrasado, esparso e que depende das próprias ações passadas do agente, ao contrário do conjunto de dados fixo que o aprendizado supervisionado e o não supervisionado supõem. A disciplina `ai-theory/artificial-intelligence` deste currículo já cobre por completo o núcleo matemático desse cenário (processos de decisão de Markov, a equação de Bellman e iteração de valor/política) como a formalização padrão da tomada de decisão sequencial sob incerteza. Esta disciplina não repete esse material; ele aparece aqui na taxonomia só para ser nomeado e corretamente localizado, e não derivado de novo.

## Teoria Central

### Por que a taxonomia trata de retorno, e não de algoritmos

As três categorias não são definidas por qual fórmula ou modelo um aprendiz usa: a mesma ideia subjacente (uma rede neural, por exemplo) pode aparecer em cenários supervisionados, não supervisionados ou por reforço. A taxonomia é definida inteiramente pela informação a que o processo de aprendizado tem acesso: pares rotulados completos (supervisionado), dados brutos não rotulados (não supervisionado) ou um sinal de recompensa recebido por meio de interação ao longo do tempo (por reforço). É por isso que a primeira decisão de projeto num problema real de ML não é "qual algoritmo", e sim "que tipo de retorno eu de fato tenho".

### Regressão versus classificação: lendo a variável-alvo

Dentro do aprendizado supervisionado, a divisão regressão/classificação é determinada inteiramente pelo tipo de `y`. Se `y` percorre os números reais (ou um intervalo contínuo), é regressão; se `y` assume um entre finitos rótulos discretos, é classificação. Essa distinção determina quais funções de perda e métricas de avaliação se aplicam mais adiante nesta disciplina: o erro quadrático é uma perda natural para um alvo numérico, mas não tem sentido para uma categoria sem ordenação.

### Onde esta disciplina fica em relação ao resto do currículo

`ai-theory/artificial-intelligence` cobre busca, lógica e teoria da decisão (incluindo o formalismo de MDP/equação de Bellman, vizinho do aprendizado por reforço) como raciocínio sob um modelo do mundo conhecido ou parcialmente conhecido. Esta disciplina, em vez disso, supõe que nenhum modelo é conhecido de antemão e pergunta como construir um a partir de dados: regressão linear e logística, classificadores generativos, árvores de decisão, SVMs, clusterização e uma primeira ponte para as redes neurais. A maquinaria de gradientes e mínimos quadrados de `foundations/mathematics-for-computing` e a maquinaria de probabilidade e estimação de `foundations/probability-statistics` são os dois kits matemáticos dos quais toda esta disciplina se vale diretamente, em vez de derivá-los de novo.

## Exemplos Resolvidos

### Exemplo 1: classificando cinco tarefas reais

```text
Tarefa                                                Categoria
----------------------------------------------------  ----------------------------------
Prever a temperatura máxima de amanhã (°F)            Supervisionado: regressão
Prever se um e-mail é spam                            Supervisionado: classificação
Agrupar clientes em segmentos sem rótulos             Não supervisionado: clusterização
Comprimir dados de 1000 dimensões para 2 dimensões    Não supervisionado: red. de dimensão
Treinar um robô a andar por tentativa e recompensa    Aprendizado por reforço
```

A pista em cada caso: existe um `y` rotulado (supervisionado), nenhum `y` (não supervisionado) ou uma recompensa recebida por meio de interação ao longo do tempo (por reforço)?

### Exemplo 2: por que a avaliação não supervisionada é genuinamente mais difícil

Dadas as previsões de um classificador supervisionado, conferir a correção é mecânico: compara-se cada previsão com seu rótulo verdadeiro conhecido. Dada a saída de um algoritmo de clusterização (digamos, três grupos de clientes), não existe um agrupamento "verdadeiro" para conferir, a menos que um humano defina um de forma independente. Duas clusterizações diferentes e razoáveis dos mesmos dados podem ambas estar "corretas" em sentidos diferentes (agrupadas por valor gasto vs. agrupadas por categoria de compra), e é por isso que as métricas de avaliação do aprendizado não supervisionado são bem menos padronizadas que as do caso supervisionado (vistas mais adiante nesta disciplina).

## Equívocos Comuns e Armadilhas

- **"Aprendizado não supervisionado significa que o algoritmo aprende sem nenhuma intervenção humana."** O algoritmo não usa rótulos, mas um humano ainda escolhe o número de clusters, a métrica de distância, o número de dimensões para o qual reduzir; não supervisionado não significa livre de escolhas de projeto.
- **"Aprendizado por reforço é só aprendizado supervisionado com outra função de perda."** Não é: o aprendizado supervisionado supõe exemplos rotulados i.i.d. fixados de antemão; os dados do aprendizado por reforço são gerados pelas próprias ações do agente, não são i.i.d., e o "rótulo" (recompensa) é atrasado e depende de toda uma sequência de decisões passadas. É um cenário matemático genuinamente diferente, e é exatamente por isso que `artificial-intelligence` o trata com seu próprio formalismo (MDPs), em vez de encaixá-lo no kit desta disciplina.
- **"Regressão só significa regressão linear."** Regressão nomeia o tipo de saída (um número), e não um modelo específico: árvores de decisão, SVMs e redes neurais podem ser usadas para regressão tão bem quanto para classificação.

## Resumo

O machine learning se divide em três conforme o tipo de retorno disponível: aprendizado supervisionado a partir de pares rotulados (subdividido em regressão para alvos numéricos e classificação para categóricos), aprendizado não supervisionado só a partir de dados não rotulados e aprendizado por reforço a partir de um sinal de recompensa recebido por meio de interação ao longo do tempo. Esta disciplina desenvolve o aprendizado supervisionado e o não supervisionado em profundidade, sobre a álgebra linear e a probabilidade já vistas em outras partes deste currículo; o núcleo matemático do aprendizado por reforço (MDPs e a equação de Bellman) já é coberto por completo em `artificial-intelligence` e não é repetido aqui.

## Documentation Links

- [Stanford CS229: Course Syllabus](https://cs229.stanford.edu/syllabus-autumn2018.html): o cronograma real do curso que a estrutura desta disciplina segue, confirmando a ordem supervisionado → não supervisionado → por reforço.
- [Caltech CS 156: Learning From Data](https://work.caltech.edu/telecourse.html): um segundo curso real, que começa com a pergunta da viabilidade do aprendizado que o próximo conceito desta disciplina retoma diretamente.
