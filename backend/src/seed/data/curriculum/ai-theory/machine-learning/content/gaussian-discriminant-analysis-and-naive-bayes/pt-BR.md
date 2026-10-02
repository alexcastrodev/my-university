---
version: 1.0
updatedAt: 2026-09-06
title: "Classificadores Generativos: Análise Discriminante Gaussiana e Naive Bayes"
summary: Uma segunda forma, genuinamente diferente, de classificar. Em vez de modelar diretamente a fronteira de decisão (como faz a regressão logística), modela-se como cada classe gera seus dados e deixa-se o teorema de Bayes (já visto por completo com um exemplo real de teste diagnóstico) transformar isso numa previsão.
---
## Objetivos de Aprendizagem

- Distinguir modelos discriminativos (que modelam `P(y|x)` diretamente, como a regressão logística) de modelos generativos (que modelam `P(x|y)` e `P(y)` e depois usam o teorema de Bayes para obter `P(y|x)`).
- Enunciar o modelo de Análise Discriminante Gaussiana (GDA) e descrever como ele ajusta uma distribuição gaussiana separada às features de cada classe.
- Enunciar a suposição de independência condicional do Naive Bayes e explicar o que ela ganha computacionalmente e o que ela custa em precisão de modelagem.
- Explicar, com um exemplo resolvido, exatamente como o teorema de Bayes converte as densidades condicionais à classe de um modelo generativo numa decisão de classificação.

## Contexto e Motivação

A regressão logística, recém-vista, é um classificador **discriminativo**: ela modela diretamente a probabilidade condicional `P(y|x)`, traçando uma fronteira de decisão entre as classes sem nunca descrever como são os dados dentro de cada classe. Este conceito apresenta uma estratégia fundamentalmente diferente, a classificação **generativa**, que em vez disso modela como cada classe *gera* seus dados, `P(x|y)`, junto com a frequência geral de cada classe, `P(y)`, e então usa o teorema de Bayes, já visto por completo em `foundations/probability-statistics` com um exemplo resolvido completo de teste diagnóstico, para invertê-las na probabilidade de classificação de fato necessária, `P(y|x)`.

É uma filosofia de modelagem genuinamente diferente, e não apenas uma variante algébrica da mesma ideia: um modelo generativo pode, em princípio, gerar exemplos sintéticos de cada classe amostrando da distribuição ajustada, algo que um modelo discriminativo como a regressão logística não tem nenhum mecanismo para fazer.

## Teoria Central

### O teorema de Bayes aplicado à classificação

Lembre do teorema de Bayes, exatamente como provado e aplicado a um teste diagnóstico em `foundations/probability-statistics`:

```text
P(y | x) = P(x | y) · P(y) / P(x)
```

No cenário de classificação: `P(y)` é a probabilidade **a priori** de cada classe (quão comum ela é no geral), `P(x|y)` é a **densidade condicional à classe** (como as features são, dada a classe) e `P(y|x)` é a **a posteriori**, a quantidade de que um classificador afinal precisa, exatamente como no exemplo do teste diagnóstico em que um resultado positivo e a prevalência conhecida da doença se combinaram para dar a probabilidade verdadeira da doença. Aqui, `P(x|y)` e `P(y)` são o que o modelo de fato ajusta a partir dos dados de treino; `P(y|x)` é derivada depois, por essa mesma fórmula, e não ajustada diretamente.

### Análise Discriminante Gaussiana (GDA)

A GDA supõe que as features de cada classe são sorteadas de uma distribuição normal multivariada (a mesma distribuição normal de `foundations/probability-statistics`, generalizada para várias dimensões) com uma média específica da classe `μ_y` (e, na versão mais simples, uma covariância compartilhada entre as classes). Ajustar o modelo significa estimar a média de cada classe e a covariância compartilhada diretamente a partir dos exemplos de treino que pertencem àquela classe; classificar um ponto novo significa calcular `P(x|y)` sob a gaussiana ajustada de cada classe, multiplicar pela probabilidade a priori `P(y)` daquela classe e escolher a classe com o maior resultado.

### Naive Bayes e a suposição de independência condicional

O Naive Bayes adota uma abordagem generativa diferente, e computacionalmente muito mais barata: ele supõe que toda feature é **condicionalmente independente dada a classe**, ou seja, `P(x₁, x₂, ..., xₙ | y) = P(x₁|y) · P(x₂|y) · ... · P(xₙ|y)`. Essa suposição quase sempre é literalmente falsa (num classificador de spam, as palavras "grátis" e "dinheiro" de fato tendem a aparecer juntas, e não de forma independente), e é exatamente por isso que o modelo é chamado de "ingênuo" (naive). Mas a suposição reduz o ajuste de uma distribuição conjunta inteira sobre `n` features ao ajuste de `n` distribuições unidimensionais separadas, uma por feature, por classe, tornando-o drasticamente mais barato de estimar com poucos dados e rápido de calcular no momento da previsão.

## Exemplos Resolvidos

### Exemplo 1: uma decisão de classificação no estilo GDA

Suponha que um problema de duas classes (doença presente ou ausente) tenha probabilidades a priori ajustadas `P(doença) = 0.01`, `P(sem doença) = 0.99`, e densidades condicionais à classe ajustadas para uma única feature `x` (o escore de um teste) avaliadas no escore real de um paciente: `P(x | doença) = 0.6`, `P(x | sem doença) = 0.02`. Aplicando o teorema de Bayes para comparar os dois numeradores a posteriori (o denominador `P(x)` é o mesmo para as duas classes, então pode ser ignorado quando só se compara qual classe é mais provável):

```text
Numerador para "doença":     P(x|doença)·P(doença)          = 0.6 · 0.01  = 0.006
Numerador para "sem doença": P(x|sem doença)·P(sem doença)  = 0.02 · 0.99 = 0.0198
```

Mesmo que o escore do teste seja muito mais provável sob "doença" isoladamente (0.6 vs. 0.02), a baixa probabilidade a priori da doença (0.01) ainda deixa "sem doença" como a classe mais provável no geral (0.0198 > 0.006), a mesma lição de que a prevalência domina uma única observação já demonstrada com números concretos no exemplo do teste diagnóstico do teorema de Bayes.

### Exemplo 2: Naive Bayes para spam, com a suposição de independência explícita

Para um e-mail com as features "contém 'grátis'" (`x₁=1`) e "contém 'vencedor'" (`x₂=1`), o Naive Bayes calcula:

```text
P(x₁=1, x₂=1 | spam) ≈ P(x₁=1|spam) · P(x₂=1|spam) = 0.3 · 0.25 = 0.075
```

em vez de estimar diretamente dos dados a verdadeira probabilidade conjunta `P(x₁=1, x₂=1 | spam)`, o que exigiria muito mais exemplos de treino para ser estimado de forma confiável (cada combinação de valores de features precisa de exemplos suficientes para estimar sua própria probabilidade). A suposição de independência troca essa precisão de modelagem por um problema de estimação `n` vezes mais barato; na prática, uma troca que funciona surpreendentemente bem para classificação de texto, apesar de ser tecnicamente falsa.

## Equívocos Comuns e Armadilhas

- **"O Naive Bayes supõe que as features são de fato independentes, então é um modelo ruim sempre que isso for falso."** O Naive Bayes costuma ter bom desempenho mesmo quando a suposição de independência é claramente violada (como com as palavras de um documento). O que importa para uma classificação correta não é que as probabilidades estimadas sejam exatamente certas, só que a *ordenação relativa* das classes pela probabilidade a posteriori saia correta, o que a suposição de independência muitas vezes preserva mesmo quando distorce os valores brutos de probabilidade.
- **"Modelos generativos e discriminativos com os mesmos dados deveriam dar a mesma fronteira de decisão."** Em geral não dão. A GDA supõe implicitamente uma forma paramétrica específica (condicionais à classe gaussianas), e quando essa suposição está errada, sua fronteira de decisão pode diferir de forma significativa da da regressão logística, que não faz suposição alguma sobre a forma dos dados, só sobre a forma da fronteira.
- **"O teorema de Bayes aqui é uma fórmula diferente da que aparece na disciplina de probabilidade."** É a fórmula idêntica, aplicada a outro domínio (classes e features no lugar de presença de doença e resultados de teste): a mesma estrutura, a mesma cautela sobre probabilidades a priori dominarem uma única evidência.

## Resumo

A Análise Discriminante Gaussiana e o Naive Bayes são ambos classificadores generativos: em vez de modelar `P(y|x)` diretamente como a regressão logística, eles modelam a distribuição geradora de dados de cada classe, `P(x|y)`, e sua probabilidade a priori `P(y)`, e então as invertem pelo teorema de Bayes (já provado por completo em `foundations/probability-statistics`) para obter a probabilidade de classificação de fato necessária. A GDA supõe que as features de cada classe seguem uma distribuição normal multivariada; o Naive Bayes, em vez disso, supõe que toda feature é condicionalmente independente dada a classe, uma simplificação normalmente falsa, mas computacionalmente poderosa, que ainda assim costuma produzir classificações corretas na prática.

## Documentation Links

- [Stanford CS229: Lecture Notes, Part II: Classification and Logistic Regression](https://cs229.stanford.edu/main_notes.pdf): cobre GDA e Naive Bayes como a contraparte generativa da regressão logística.
- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): o Capítulo 3 discute classificadores generativos (análise discriminante linear/quadrática, Naive Bayes) junto com a regressão logística.
