---
version: 1.0
updatedAt: 2026-09-06
title: Validação Cruzada
summary: Como extrair uma estimativa confiável do verdadeiro erro de generalização de um modelo a partir de um único conjunto de dados finito. A validação cruzada k-fold treina e valida em todas as divisões possíveis e depois tira a média, para que nenhuma divisão sortuda ou azarada decida sozinha qual modelo vence.
---
## Objetivos de Aprendizagem

- Explicar por que uma única divisão de validação pode dar uma estimativa ruidosa e pouco confiável do verdadeiro desempenho de um modelo, especialmente com poucos dados.
- Descrever com precisão o procedimento de validação cruzada k-fold, incluindo como a estimativa final de desempenho é calculada.
- Rastrear à mão uma execução concreta de validação cruzada com 5 folds num conjunto de dados pequeno.
- Explicar a validação cruzada leave-one-out como o caso extremo do k-fold e a troca que ela faz entre viés e custo computacional.

## Contexto e Motivação

`training-test-and-validation-splits`, antes nesta disciplina, apresentou a separação de um único conjunto de validação para comparar modelos candidatos ou hiperparâmetros (como a força de regularização `λ` do conceito anterior). Essa divisão única tem uma fraqueza real: com uma quantidade limitada de dados, quais exemplos específicos acabam caindo no conjunto de validação pode afetar de forma significativa qual modelo parece melhor. Uma divisão azarada pode fazer um modelo genuinamente bom parecer medíocre, ou vice-versa. A validação cruzada resolve isso usando cada exemplo para validação exatamente uma vez, em várias divisões diferentes, e tirando a média dos resultados numa única estimativa mais confiável.

Isso também é uma instância direta, estatística, de uma técnica já vista neste currículo: `sampling-and-sampling-distributions` de `foundations/probability-statistics` estabeleceu que qualquer estimativa baseada numa única amostra carrega variabilidade amostral, e a validação cruzada é exatamente a prática de tirar a média sobre várias amostras para reduzir essa variabilidade, aplicada especificamente à avaliação de modelos.

## Teoria Central

### O procedimento k-fold

A **validação cruzada k-fold** particiona os dados de treino em `k` folds disjuntos de tamanhos iguais. Para cada um dos `k` folds, por vez, o modelo é treinado nos outros `k−1` folds e avaliado no fold separado; isso produz `k` escores de desempenho separados, um por fold. A estimativa final da validação cruzada é a média desses `k` escores. Crucialmente, cada exemplo é usado para validação exatamente uma vez (no fold a que pertence) e para treino `k−1` vezes (em todos os folds exceto o seu), então a média final usa a informação de todos os pontos de dados, em vez de depender de uma única divisão fixa.

### Escolhendo k

Escolhas comuns são `k = 5` ou `k = 10`. Um `k` menor (como `k=5`) treina menos modelos e é computacionalmente mais barato, mas o conjunto de treino de cada fold é uma fração menor dos dados completos, o que dá um viés levemente pessimista à estimativa de erro. Um `k` maior usa mais dos dados para treino em cada fold (menos viés), ao custo de treinar mais modelos no total (mais computação), e com algum aumento de variância entre folds, já que os conjuntos de treino dos folds se sobrepõem cada vez mais.

### Validação cruzada leave-one-out, o caso extremo

A **validação cruzada leave-one-out (LOOCV)** é o `k`-fold com `k = N`, o número total de exemplos: cada fold separa exatamente um exemplo e treina em todo o resto. Isso dá a estimativa menos enviesada possível do desempenho fora da amostra (cada execução de treino usa quase o conjunto de dados inteiro), mas exige treinar `N` modelos separados, o que é computacionalmente proibitivo para conjuntos de dados grandes. E (por razões além do escopo desta disciplina) ela pode na verdade ter variância *maior* entre execuções do que um `k` moderado, apesar do viés menor, porque os `N` conjuntos de treino que ela produz são quase idênticos entre si e, portanto, altamente correlacionados.

## Exemplos Resolvidos

### Exemplo 1: uma execução concreta de validação cruzada com 5 folds

Suponha que 100 exemplos sejam divididos em 5 folds de 20 exemplos cada, e que a acurácia de um modelo seja medida em cada fold separado:

```text
Fold 1 separado: treina nos folds 2-5 (80 exemplos), testa no fold 1 → 82% de acurácia
Fold 2 separado: treina nos folds 1,3-5 (80 exemplos), testa no fold 2 → 79% de acurácia
Fold 3 separado: treina nos folds 1-2,4-5 (80 exemplos), testa no fold 3 → 85% de acurácia
Fold 4 separado: treina nos folds 1-3,5 (80 exemplos), testa no fold 4 → 81% de acurácia
Fold 5 separado: treina nos folds 1-4 (80 exemplos), testa no fold 5 → 83% de acurácia

Estimativa da validação cruzada = (82+79+85+81+83) / 5 = 410/5 = 82.0%
```

Repare que as acurácias de cada fold variam de 79% a 85%: uma única divisão de validação poderia ter reportado qualquer um desses números, dependendo da sorte; a média de 82.0% é uma estimativa mais estável e confiável do verdadeiro desempenho de generalização do modelo.

### Exemplo 2: usando validação cruzada para escolher um hiperparâmetro

Aplicando validação cruzada com 5 folds para comparar três forças de penalidade da regressão ridge (do conceito anterior) nos mesmos dados:

```text
λ = 0.1:  acurácia na validação cruzada = 79.5%
λ = 1.0:  acurácia na validação cruzada = 83.2%  ← melhor média entre os 5 folds
λ = 10:   acurácia na validação cruzada = 76.8%
```

`λ = 1.0` é escolhido porque tem o melhor desempenho *médio* entre os folds, uma base muito mais confiável para escolher um hiperparâmetro do que uma única divisão treino/validação, que é exatamente o cenário que o Exemplo 1 mostrou ser ruidoso.

## Equívocos Comuns e Armadilhas

- **"A validação cruzada elimina a necessidade de um conjunto de teste separado."** Não elimina. A validação cruzada continua sendo uma forma de seleção de modelo/hiperparâmetro feita usando só os dados de treino (divididos internamente em folds); o conjunto de teste final separado de `training-test-and-validation-splits`, tocado exatamente uma vez, continua sendo necessário para reportar um número final de desempenho honesto, não contaminado pelo processo de seleção.
- **"Um k maior é sempre melhor, já que é menos enviesado."** Um k maior significa mais computação (treinar k modelos separados) e, no caso extremo do leave-one-out, pode aumentar a variância entre execuções por causa da alta correlação entre conjuntos de treino quase idênticos. k=5 ou k=10 são os padrões justamente porque equilibram razoavelmente bem viés, variância e custo computacional.
- **"O escore de validação cruzada do hiperparâmetro vencedor é uma estimativa não enviesada do verdadeiro desempenho de teste desse modelo."** Não é, pelo mesmo motivo de muitas hipóteses apontado desde o conceito de viabilidade do aprendizado: muitos valores de hiperparâmetro foram comparados, e o que por acaso pontuou melhor agora é selecionado. Seu escore de validação cruzada carrega um pequeno viés otimista dessa seleção, e é exatamente por isso que o conjunto de teste intocado ainda importa para o número final reportado.

## Resumo

A validação cruzada k-fold treina e valida um modelo em `k` divisões diferentes dos mesmos dados, tirando a média dos escores resultantes numa única estimativa mais confiável que qualquer divisão treino/validação isolada, aplicando diretamente a mesma lógica de reduzir variabilidade tirando a média sobre amostras já estabelecida em `foundations/probability-statistics`. A validação cruzada leave-one-out é o caso extremo, com `k` igual ao tamanho da amostra, trocando viés menor por custo computacional maior e, contra a intuição, às vezes variância maior. A validação cruzada melhora a seleção de modelos e hiperparâmetros, mas não substitui o conjunto de teste final intocado visto antes nesta disciplina.

## Documentation Links

- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): o Capítulo 5 (Resampling Methods) cobre por completo a validação cruzada k-fold e leave-one-out, incluindo a troca entre viés e variância entre elas.
- [Caltech CS 156: Learning From Data, Lecture 13: Validation](https://work.caltech.edu/telecourse.html): estende a discussão de validação com divisão única para a validação cruzada.
