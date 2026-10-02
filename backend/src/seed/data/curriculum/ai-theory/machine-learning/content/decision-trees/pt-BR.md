---
version: 1.0
updatedAt: 2026-09-06
title: Árvores de Decisão
summary: Um classificador construído com nada mais exótico que a árvore binária já vista como estrutura de dados. Aqui, cada divisão é escolhida pela feature e pelo limiar que mais reduzem a impureza, produzindo um modelo que um humano consegue ler direto da página.
---
## Objetivos de Aprendizagem

- Descrever como uma árvore de decisão faz uma previsão seguindo uma sequência de testes de feature contra limiar, da raiz até a folha.
- Definir a impureza de Gini e explicar como um algoritmo guloso de crescimento de árvore escolhe cada divisão para minimizá-la.
- Rastrear à mão um passo completo de escolha de divisão num conjunto de dados pequeno.
- Explicar por que uma árvore de decisão sem poda é um modelo de alta variância, ligando diretamente aos conceitos de viés-variância e overfitting desta disciplina.

## Contexto e Motivação

Todos os modelos vistos até agora no bloco de classificação desta disciplina (regressão logística, GDA, Naive Bayes) se comprometem com uma forma matemática específica (uma fronteira de decisão linear, ou uma distribuição de probabilidade específica) escolhida de antemão. As árvores de decisão adotam uma abordagem estruturalmente diferente, construída diretamente sobre uma estrutura de dados já vista na primeira disciplina deste currículo: a árvore binária de `foundations/data-structures-i`. Aqui, cada nó interno faz uma pergunta simples sobre uma feature (`x₁ > 5`?), cada ramo segue a resposta e cada folha faz uma previsão final. É um modelo cuja estrutura é descoberta a partir dos próprios dados, e não fixada de antemão, e cuja lógica um humano consegue ler diretamente na árvore.

## Teoria Central

### A estrutura da árvore e a regra de previsão

Uma árvore de decisão é exatamente a árvore binária já vista em `foundations/data-structures-i`, especializada para previsão: cada nó interno guarda uma feature e um limiar (`xⱼ > t`?), cada nó tem dois filhos (seguindo a resposta "não"/"sim") e cada folha guarda uma classe prevista (para classificação) ou um valor previsto (para regressão). Prever para um exemplo novo significa começar na raiz e seguir, em cada nó, o ramo que corresponde aos valores reais das features do exemplo, até chegar a uma folha; a previsão guardada nela é a saída da árvore.

### Crescendo uma árvore: divisão gulosa por impureza

Uma árvore é construída de cima para baixo, de forma gulosa: em cada nó, o algoritmo considera toda divisão possível (feature, limiar) e escolhe a que mais reduz a **impureza** nos dois nós filhos resultantes. Uma medida de impureza comum é a **impureza de Gini**, para um nó que contém uma mistura de classes com proporções `p₁, ..., pₖ`:

```text
Gini = 1 − Σᵢ pᵢ²
```

A impureza de Gini é 0 quando um nó é perfeitamente puro (todo de uma classe) e máxima quando as classes estão misturadas por igual. O algoritmo avalia a impureza de Gini *ponderada* de cada divisão candidata nos dois filhos resultantes e escolhe gulosamente a divisão que mais reduz a impureza, repetindo recursivamente em cada nó filho até atingir uma condição de parada (uma profundidade máxima, ou um número mínimo de exemplos por folha).

### Por que árvores sem poda sofrem overfitting

Uma árvore de decisão crescida sem nenhuma condição de parada pode continuar dividindo até que cada folha contenha um único exemplo de treino, atingindo erro de treino zero. Mas esse é precisamente o regime de alta variância e baixo viés do conceito de viés-variância desta disciplina: uma árvore profunda o bastante para separar perfeitamente todo ponto de treino quase certamente ajustou ruído específico daquela amostra, e uma amostra de treino diferente da mesma distribuição verdadeira provavelmente produziria uma árvore com formato bem diferente. Limitar a profundidade da árvore, exigir um número mínimo de exemplos por folha ou podar a árvore depois de crescê-la são todas aplicações diretas e estruturais da mesma ideia de controle de capacidade que a regularização aplicou aos modelos lineares antes nesta disciplina.

## Exemplos Resolvidos

### Exemplo 1: calculando a impureza de Gini e escolhendo uma divisão

Considere um nó com 10 exemplos: 6 rotulados "sim", 4 rotulados "não". Sua impureza de Gini:

```text
p(sim) = 0.6, p(não) = 0.4
Gini = 1 − (0.6² + 0.4²) = 1 − (0.36 + 0.16) = 1 − 0.52 = 0.48
```

Suponha que uma divisão candidata pela feature `idade > 30` separe isso em dois filhos: Esquerda (idade ≤ 30): 5 exemplos, 1 "sim" / 4 "não" → `Gini_esq = 1 − (0.2² + 0.8²) = 1 − 0.68 = 0.32`. Direita (idade > 30): 5 exemplos, 5 "sim" / 0 "não" → `Gini_dir = 1 − (1.0² + 0²) = 0.0` (perfeitamente pura). A impureza ponderada da divisão: `(5/10)(0.32) + (5/10)(0.0) = 0.16`, uma grande redução em relação ao 0.48 do pai, o que torna esta uma divisão candidata forte que o algoritmo guloso provavelmente escolheria em vez de alternativas mais fracas.

### Exemplo 2: uma árvore rastreando uma previsão completa

Dada uma árvore ajustada:

```text
Raiz: idade > 30?
  ├── Não → renda > 50000?
  │          ├── Não → prevê: "recusar"
  │          └── Sim → prevê: "aprovar"
  └── Sim → prevê: "aprovar"
```

Para um novo solicitante com `idade = 25, renda = 60000`: começando na raiz, `idade > 30` é falso, então siga o ramo "Não" até o nó `renda > 50000`; `renda > 50000` é verdadeiro, então siga até a folha que prevê "aprovar". Toda previsão é exatamente esse tipo de caminho transparente e rastreável, a principal vantagem prática das árvores de decisão em relação aos modelos menos diretamente interpretáveis vistos antes nesta disciplina.

## Equívocos Comuns e Armadilhas

- **"Árvores de decisão sempre encontram a estrutura de árvore globalmente ótima."** O algoritmo guloso de divisão escolhe a melhor divisão local em cada passo, sem olhar adiante. Isso pode perder uma árvore globalmente melhor que exigiria uma divisão localmente subótima agora para permitir uma divisão muito melhor depois. Encontrar a árvore verdadeiramente ótima é computacionalmente intratável para tamanhos realistas de conjuntos de dados, e é exatamente por isso que a aproximação gulosa é usada na prática.
- **"Uma árvore mais profunda é sempre uma árvore melhor."** Uma árvore profunda o bastante e sem restrições pode memorizar exatamente o conjunto de treino (cada folha com um exemplo), que é o cenário clássico de overfitting de alta variância do conceito de viés-variância desta disciplina. A profundidade precisa ser limitada, ou a árvore podada, com base no desempenho de validação, e não no de treino.
- **"Árvores de decisão só lidam com features numéricas."** Árvores também dividem naturalmente por features categóricas (`cor == "vermelho"`?), uma de suas vantagens práticas em relação a modelos como a regressão linear/logística, que exigem que as features categóricas sejam primeiro codificadas numericamente.

## Resumo

Uma árvore de decisão reaproveita a estrutura de dados de árvore binária de `foundations/data-structures-i`, com cada nó interno testando uma feature contra um limiar e cada folha guardando uma previsão. Ela cresce de forma gulosa, de cima para baixo, escolhendo repetidamente a divisão que mais reduz a impureza (comumente medida pela impureza de Gini) nos filhos resultantes. Sem restrições, uma árvore de decisão pode crescer o bastante para ajustar perfeitamente seus dados de treino (o mesmo risco de overfitting de alta variância sobre o qual os conceitos de viés-variância e regularização desta disciplina já alertaram), e é por isso que limites de profundidade, tamanhos mínimos de folha ou poda são essenciais na prática.

## Documentation Links

- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): o Capítulo 7 (Tree-Based Methods) deriva por completo a impureza de Gini e o algoritmo guloso de crescimento de árvores.
- [Stanford CS229: Course Syllabus](https://cs229.stanford.edu/syllabus-autumn2018.html): lista árvores de decisão e ensembles de árvores como o tópico dedicado do curso logo após o bloco central de regressão/classificação.
