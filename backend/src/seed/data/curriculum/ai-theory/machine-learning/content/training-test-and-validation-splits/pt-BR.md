---
version: 1.0
updatedAt: 2026-09-06
title: Divisões de Treino, Teste e Validação
summary: A disciplina prática que transforma a pergunta da generalização em algo que dá para medir de fato. Separar dados nos quais o modelo nunca treina e nunca tocar no verdadeiro conjunto de teste até que todas as outras decisões já estejam tomadas.
---
## Objetivos de Aprendizagem

- Explicar por que um modelo precisa ser avaliado em dados nos quais não treinou e por que medir o desempenho só no conjunto de treino quase não tem significado.
- Distinguir a divisão em três (treino, validação e teste) e dizer para que cada parte é usada.
- Explicar a disciplina de tocar no conjunto de teste exatamente uma vez, bem no fim, e por que conferir repetidamente o desempenho de teste enquanto se itera sobre um modelo transforma silenciosamente o conjunto de teste num segundo conjunto de validação.
- Descrever como essa disciplina prática é a resposta direta e aplicada à pergunta da viabilidade do aprendizado levantada no conceito anterior.

## Contexto e Motivação

O limite de Hoeffding do conceito anterior dá uma garantia matemática de que o erro dentro da amostra acompanha o erro fora da amostra, mas só se o erro for de fato medido em dados genuinamente separados daqueles aos quais o modelo foi ajustado. Este conceito transforma essa garantia numa prática concreta de engenharia: nunca confie num número calculado nos mesmos dados em que o modelo treinou, porque um modelo flexível o bastante sempre pode ser levado a ajustar quase perfeitamente seus próprios dados de treino, o que não diz nada sobre como ele se sai em outros lugares.

Esse é um dos hábitos mais importantes do machine learning aplicado, e também um dos mais fáceis de violar sem querer: por exemplo, testando dez modelos diferentes, conferindo o desempenho de cada um num "conjunto de teste" e reportando o melhor. Essa prática reintroduz discretamente exatamente o problema de muitas hipóteses apontado no conceito anterior: o conjunto de teste na prática virou parte da busca, e o número reportado não significa mais o que afirma significar.

## Teoria Central

### A divisão em três

Um conjunto de dados normalmente é dividido em três partes disjuntas:

1. **Conjunto de treino**: os dados aos quais os parâmetros do modelo são de fato ajustados.
2. **Conjunto de validação**: separado do treino, usado para comparar modelos diferentes ou escolhas diferentes de hiperparâmetros (quantas árvores, quanta regularização) e escolher um vencedor.
3. **Conjunto de teste**: separado tanto do treino quanto da validação, tocado exatamente uma vez, bem no fim, para reportar uma estimativa final e honesta de como o modelo escolhido se sai em dados não vistos.

Uma proporção de divisão comum é 60/20/20 ou 70/15/15, embora as proporções certas dependam de quantos dados há no total.

### Por que validação e teste não podem ser o mesmo conjunto

Se a seleção de modelo (comparar muitos modelos candidatos ou hiperparâmetros) for feita diretamente contra o conjunto de teste, escolhe-se o modelo que por acaso pontuou melhor naquele conjunto específico, o que reintroduz o risco de overfitting de muitas hipóteses do conceito anterior, agora aplicado ao próprio conjunto de teste em vez do de treino. O conjunto de validação existe especificamente para absorver esse processo de busca, deixando o número do conjunto de teste não contaminado e confiável como relatório final.

### A regra do toque único

A disciplina que este conceito de fato ensina é comportamental: o conjunto de teste é tocado exatamente uma vez. Toda decisão sobre qual modelo, quais features, quais hiperparâmetros acontece usando só os conjuntos de treino e de validação. Só depois de todas essas decisões estarem travadas é que o conjunto de teste é avaliado, uma única vez, para reportar o número em que de fato se vai confiar ou que será publicado. Conferir o desempenho de teste repetidamente durante o desenvolvimento e ajustar o modelo em resposta transforma o conjunto de teste num segundo conjunto de validação informal, e o número final reportado deixa de significar o que deveria significar.

## Exemplos Resolvidos

### Exemplo 1: uma divisão concreta de 1000 exemplos

```text
Total de exemplos: 1000
Treino:     600 exemplos (60%): os parâmetros do modelo são ajustados aqui
Validação:  200 exemplos (20%): comparam-se 5 modelos candidatos aqui e escolhe-se o melhor
Teste:      200 exemplos (20%): tocado uma vez, no fim, para reportar a acurácia final
```

Suponha que 5 modelos candidatos sejam treinados nos 600 exemplos de treino e avaliados nos 200 exemplos de validação:

```text
Modelo A: 78% de acurácia na validação
Modelo B: 85% de acurácia na validação   ← escolhido
Modelo C: 81% de acurácia na validação
Modelo D: 83% de acurácia na validação
Modelo E: 79% de acurácia na validação
```

O Modelo B é selecionado com base no desempenho de validação. Só agora ele é executado uma vez nos 200 exemplos de teste, rendendo (digamos) 84%: o número reportado como o verdadeiro desempenho de generalização do modelo.

### Exemplo 2: o cenário de contaminação

Suponha, em vez disso, que os 5 modelos acima sejam avaliados diretamente no conjunto de teste e que o Modelo B (84% de acurácia de teste) seja escolhido por ter pontuado mais alto ali. Mesmo que 84% seja um número real, ele agora é uma estimativa otimistamente enviesada do desempenho verdadeiro: o Modelo B foi escolhido *porque* por acaso pontuou melhor neste conjunto de teste específico entre 5 candidatos, então parte desses 84% reflete um alinhamento de sorte entre o Modelo B e esta amostra específica de 200 exemplos, e não puramente a verdadeira acurácia do Modelo B fora da amostra. Reportar 84% como o desempenho esperado em dados novos seria enganoso.

## Equívocos Comuns e Armadilhas

- **"Se meu modelo atinge 99% de acurácia no conjunto de treino, ele é um ótimo modelo."** Isso mede a capacidade de memorização, não a generalização. Um modelo flexível o bastante pode chegar a quase 100% de acurácia de treino e se sair bem pior em dados novos (um sintoma do overfitting que o bloco de complexidade de modelos desta disciplina trata diretamente).
- **"Posso espiar o conjunto de teste algumas vezes enquanto ajusto, desde que não treine nele."** Mesmo sem treinar diretamente nos dados de teste, escolher qual modelo ou quais hiperparâmetros manter com base no desempenho de teste já é uma forma de ajuste ao conjunto de teste; é exatamente a contaminação do Exemplo 2.
- **"Os conjuntos de validação e de teste servem ao mesmo propósito, então um único conjunto separado basta."** Eles servem a propósitos diferentes: a validação dá suporte à *seleção* de modelo (comparar muitos candidatos), o teste dá suporte ao *relatório* final (um número honesto). Juntá-los num único conjunto faz com que o número final reportado deixe de ser confiável como estimativa não enviesada.

## Resumo

Como o desempenho de um modelo nos próprios dados de treino diz pouco sobre como ele vai se sair em dados novos, um fluxo de trabalho real de ML divide os dados em treino (ajustar parâmetros), validação (selecionar entre modelos candidatos ou hiperparâmetros) e teste (reportar um único número de desempenho final e honesto, tocado exatamente uma vez). Essa é a resposta prática direta à preocupação de viabilidade do aprendizado levantada pelo limite de Hoeffding: a garantia de que o erro dentro da amostra acompanha o erro fora da amostra só vale se "dentro da amostra" e "fora da amostra" forem mantidos genuinamente separados, e essa divisão em três é como essa separação é de fato imposta na prática.

## Documentation Links

- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): o Capítulo 5 (Resampling Methods) cobre essa divisão e a técnica de validação cruzada à qual esta disciplina volta mais adiante.
- [Caltech CS 156: Learning From Data, Lecture 13: Validation](https://work.caltech.edu/telecourse.html): a aula real que formaliza o papel do conjunto de validação entre o treino e o teste.
