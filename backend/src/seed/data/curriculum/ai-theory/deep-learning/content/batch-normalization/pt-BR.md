---
version: 1.0
updatedAt: 2026-09-07
title: Batch Normalization
summary: Uma camada que não faz nada além de recentralizar e reescalar sua entrada para estatísticas de gaussiana unitária, usando a média e a variância do próprio mini-batch. Ela é inserida entre uma camada linear e sua ativação justamente para manter estável a distribuição de entrada de cada camada conforme os pesos abaixo dela mudam durante o treino, permitindo que taxas de aprendizado bem maiores convirjam de forma confiável.
---
## Objetivos de Aprendizagem

- Enunciar com precisão a transformação de batch normalization, incluindo seus dois parâmetros aprendíveis.
- Explicar por que normalizar para média zero e variância unitária, sozinho, não basta, e por que os parâmetros aprendíveis de escala e deslocamento são necessários.
- Explicar por que a batch normalization reduz a sensibilidade à inicialização dos pesos e permite taxas de aprendizado maiores.
- Rastrear à mão a computação do forward da batch normalization em um batch pequeno de valores.

## Contexto e Motivação

`weight-initialization-and-the-vanishing-exploding-gradient-problem` tratou o problema do gradiente que desaparece/explode bem no início do treino, calibrando as escalas iniciais dos pesos. Mas, conforme o treino avança e os pesos mudam, nada garante que a distribuição de entrada de uma camada continue bem-comportada; um fenômeno que pesquisadores chamam de **internal covariate shift**: conforme os pesos das camadas anteriores são atualizados, a distribuição das ativações que chegam a cada camada posterior continua se deslocando, forçando cada camada a se readaptar continuamente a um alvo em movimento. A batch normalization é uma camada que impõe diretamente estatísticas de entrada estáveis em cada camada, durante todo o treino, em vez de calibrar apenas o ponto de partida.

## Teoria Central

### O passo de normalização

Para um mini-batch de valores de pré-ativação `{z₁, ..., zₘ}` em uma dada camada, a batch normalization primeiro calcula a média `μ_B` e a variância `σ²_B` do próprio batch e depois normaliza cada valor para média zero e variância unitária:

```text
ẑᵢ = (zᵢ − μ_B) / √(σ²_B + ε)
```

(`ε` é uma constante minúscula que evita divisão por zero). Isso é inserido entre o passo linear de uma camada e sua função de ativação, normalizando a entrada da não linearidade, e não a saída final da camada.

### A escala e o deslocamento aprendíveis

Forçar a entrada de toda camada a ter exatamente média zero e variância unitária na verdade *reduziria* o poder expressivo da rede; por exemplo, impediria uma camada sigmoid de operar na região mais linear e menos saturada perto de zero, já que essa região exige uma escala de entrada específica, diferente de um. A batch normalization compensa com dois parâmetros adicionais aprendidos por unidade, `γ` (escala) e `β` (deslocamento):

```text
BN(z)ᵢ = γ·ẑᵢ + β
```

`γ` e `β` são parâmetros comuns, atualizados por gradiente descendente exatamente como qualquer peso; crucialmente, isso significa que a rede pode *aprender* a desfazer completamente a normalização (definindo `γ = √(σ²_B + ε)` e `β = μ_B`) se isso se mostrar ótimo, então a batch normalization estritamente acrescenta flexibilidade, em vez de removê-la; ela só muda como é o estado inicial *padrão*, fácil de alcançar.

### Por que isso ajuda o treino

Com a batch normalization no lugar, a distribuição de entrada de nenhuma camada consegue se afastar arbitrariamente conforme o treino avança: cada camada vê entradas recentralizadas e reescaladas pelas estatísticas do próprio batch, camada por camada, a cada forward pass. Isso tem dois efeitos concretos e bem documentados: torna a rede dramaticamente menos sensível ao esquema específico de inicialização de pesos visto dois conceitos atrás (já que a batch normalization corrige ativamente a escala, qualquer que seja a inicialização dos pesos de uma camada) e permite taxas de aprendizado significativamente maiores sem desestabilizar o treino, porque uma grande atualização de pesos em uma camada deixa de se traduzir diretamente em um deslocamento igualmente grande da *distribuição* com que a camada seguinte precisa lidar.

## Exemplos Resolvidos

### Exemplo 1: normalizando um batch pequeno à mão

Considere um mini-batch de 4 valores de pré-ativação para uma unidade: `z = (2, 4, 4, 6)`.

```text
μ_B = (2 + 4 + 4 + 6) / 4 = 4.0
σ²_B = ((2-4)² + (4-4)² + (4-4)² + (6-4)²) / 4 = (4 + 0 + 0 + 4) / 4 = 2.0
√(σ²_B + ε) ≈ √2.0 ≈ 1.414   (tomando ε ≈ 0 por simplicidade)

ẑ = ((2-4)/1.414, (4-4)/1.414, (4-4)/1.414, (6-4)/1.414)
  = (−1.414, 0, 0, 1.414)
```

O batch normalizado agora tem exatamente média zero e variância unitária, qualquer que fosse a escala ou o deslocamento dos valores originais; a mesma normalização é aplicada de forma idêntica, não importa quais pesos a montante produziram este batch específico de pré-ativações.

### Exemplo 2: aplicando a escala e o deslocamento aprendidos

Continuando o Exemplo 1, suponha que o treino tenha aprendido `γ = 3` e `β = 1` para esta unidade:

```text
BN(z) = 3·(−1.414, 0, 0, 1.414) + 1 = (−4.243 + 1, 1, 1, 4.243 + 1) = (−3.243, 1, 1, 5.243)
```

A saída final já não tem média zero nem variância unitária: ela tem a média e a dispersão que `γ` e `β` aprenderam ser úteis para esta unidade específica; isso confirma que o passo fixo de normalização da batch normalization e sua escala/deslocamento aprendidos, juntos, dão à rede flexibilidade total, e não uma distribuição fixa e imposta.

## Equívocos Comuns e Armadilhas

- **"A batch normalization força as ativações de toda camada a serem normais padrão, de forma permanente."** Os `γ` e `β` aprendíveis significam que a rede pode recuperar, ou se afastar de, qualquer distribuição de que precisar; a parte fixa é só o passo *intermediário* de normalização, e não a saída final da camada de batch normalization.
- **"A batch normalization torna a inicialização dos pesos irrelevante."** Ela reduz bastante a sensibilidade à escala de inicialização, mas não elimina por completo a necessidade de uma inicialização razoável; as duas técnicas são complementares e atacam o mesmo problema de estabilidade do treino por ângulos diferentes (um ponto de partida fixo versus uma correção contínua).
- **"A batch normalization se comporta da mesma forma no treino e no teste."** Durante o treino ela usa a média e a variância do mini-batch atual; no teste (em que um único exemplo, ou um batch de tamanho diferente, pode ser processado), ela usa uma média móvel de `μ_B` e `σ²_B` acumulada ao longo do treino; a mesma divisão de comportamento entre treino e teste já vista no dropout, por um motivo análogo: as previsões de teste não devem depender de quais outros exemplos calharam de estar no mesmo batch.

## Resumo

A batch normalization normaliza os valores de pré-ativação de cada camada para média zero e variância unitária usando as estatísticas do mini-batch atual e depois aplica uma escala `γ` e um deslocamento `β` aprendidos, para que a rede mantenha toda a flexibilidade expressiva em vez de ficar presa a uma distribuição. Ao manter estável a distribuição de entrada de cada camada durante todo o treino (e não só na inicialização, que é tudo o que `weight-initialization-and-the-vanishing-exploding-gradient-problem` tratou), a batch normalization reduz a sensibilidade à escala inicial dos pesos e permite taxas de aprendizado significativamente maiores, o que a torna uma das ferramentas padrão (ao lado de uma inicialização cuidadosa, dos otimizadores dos conceitos anteriores e da regularização) para treinar as arquiteturas profundas que o resto desta disciplina constrói.

## Documentation Links

- [CS231n: Neural Networks Part 2: Batch Normalization](https://cs231n.github.io/neural-networks-2/): o enquadramento de "forçar as ativações a assumirem uma distribuição gaussiana unitária" e o benefício de robustez à inicialização que este conceito cobre.
- [Dive into Deep Learning: Batch Normalization](https://d2l.ai/chapter_convolutional-modern/batch-norm.html): a transformação `BN(x) = γ⊙(x − μ̂_B)/σ̂_B + β` e a distinção entre as estatísticas de treino e de teste.
