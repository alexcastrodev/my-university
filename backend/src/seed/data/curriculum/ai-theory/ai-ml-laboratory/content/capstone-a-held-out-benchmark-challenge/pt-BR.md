---
version: 1.0
updatedAt: 2026-09-12
title: "Capstone: Um Desafio de Benchmark com Conjunto Retido"
summary: Este capstone percorre de ponta a ponta o ciclo completo que a sequência de tópicos desta disciplina nomeia (pergunta, hipótese, dataset, modelo, experimento, avaliação, reprodução, desafio) sob pressão competitiva real, no estilo Kaggle. Há um dataset cujos rótulos verdadeiros de teste são de fato retidos, um prazo fixo e uma única pontuação de leaderboard sobre o conjunto retido como único retorno, o que força a disciplina de cada lab anterior (splits honestos do Lab 6, seleção de modelo com princípios do Lab 7, um baseline real do Lab 8) a se juntar em uma decisão real sob incerteza. O capstone fecha exatamente onde o framework teórico de Escolhendo e Validando um Modelo: Um Guia de Decisão começou, mas agora aplicado sob um prazo real e obrigatório, em vez de trabalhado com calma.
---
## Objetivos de Aprendizagem

- Percorrer de ponta a ponta o ciclo de pesquisa completo desta disciplina (pergunta, hipótese, dataset, modelo, experimento, avaliação, reprodução, desafio) contra um conjunto de teste genuinamente retido, sob um prazo real e fixo.
- Aplicar a disciplina de split honesto do Lab 6, o processo de seleção de modelo com princípios do Lab 7 e o padrão de baseline justo do Lab 8 a uma única decisão real, tomada sob incerteza e pressão de tempo.
- Enviar previsões contra uma pontuação de leaderboard sobre um conjunto retido como único sinal de retorno, exatamente como funcionam os benchmarks competitivos reais de ML no estilo Kaggle.
- Refletir sobre quais partes da disciplina deste arco se sustentaram sob pressão real de prazo e quais deu vontade de pular, conectando o resultado de volta ao framework de decisão de Escolhendo e Validando um Modelo.

## Contexto e Motivação

Este capstone percorre de ponta a ponta a sequência de tópicos nomeada desta disciplina inteira (pergunta, hipótese, dataset, modelo, experimento, avaliação, reprodução, desafio), pela primeira vez em condições que tornam realmente caro pular a disciplina de qualquer lab anterior: um dataset cujos rótulos verdadeiros de teste são genuinamente retidos, e não apenas separados pelo próprio código do estudante, um prazo fixo e uma única pontuação de leaderboard sobre o conjunto retido como único retorno, a mesma estrutura usada por benchmarks competitivos reais e bem conhecidos de ML, como o Kaggle.

## Teoria Central

Nada novo é derivado aqui; este capstone é onde o framework teórico de **Escolhendo e Validando um Modelo: Um Guia de Decisão**, apresentado com calma ao longo dos 23 conceitos de `machine-learning`, é aplicado sob uma restrição real e obrigatória que os labs anteriores deste arco não impunham, já que trabalhavam com um conjunto de teste separado localmente e controlado pelo próprio código do estudante.

## Exemplos Resolvidos

### A configuração do desafio

```text
- Um dataset real escolhido, dividido PELO PRÓPRIO DESAFIO (não pelo
  código do estudante) em um conjunto de treino público e um conjunto
  de teste genuinamente retido, cujos rótulos verdadeiros não ficam
  disponíveis para o estudante em momento algum do desafio.
- Um prazo fixo de submissão.
- Um único sinal de retorno: uma pontuação de leaderboard, calculada ao
  enviar PREVISÕES (não código, não rótulos) contra o conjunto retido,
  atualizada a cada nova submissão.
```

### Passo 1: aplicando a disciplina de hipótese do Lab 5 sob um prazo real

```text
Sob pressão de tempo, a tentação é pular direto para testar muitos
modelos e enviar o que tiver a melhor pontuação no leaderboard, uma
versão exata do problema de escolher a métrica retroativamente que
forming-a-falsifiable-hypothesis-on-a-real-dataset foi construído para
evitar. A disciplina deste lab exige o MESMO passo inicial: declarar,
antes da primeira submissão, qual classe de modelo e qual conjunto de
features devem ter o melhor desempenho, e por quê; uma previsão real e
falseável, mesmo sob pressão de prazo.
```

### Passo 2: reaproveitando a metodologia de split do Lab 6 nos dados PÚBLICOS de treino

```python
def prepare_local_validation(train_X, train_y, seed=0):
    # Os dados públicos de treino ainda precisam de um split local
    # HONESTO, exatamente a disciplina de
    # dataset-work-splits-leakage-and-honest-evaluation, já que o
    # conjunto de teste retido não dá nenhum retorno até que uma
    # submissão seja feita; a validação local é o único sinal
    # disponível antes disso.
    return correct_split(train_X, train_y, test_size=0.2, val_size=0.2, seed=seed)
```

### Passo 3: seleção de modelo sob um orçamento real de submissões

```text
Diferente do Lab 7, que podia varrer a complexidade livremente contra
um conjunto de validação local, este capstone normalmente tem um número
LIMITADO de submissões permitidas ao leaderboard real (uma restrição
real e comum em ML competitivo, que impede a estratégia de enviar toda
variante de modelo possível e escolher a de melhor pontuação por força
bruta, o que seria em si uma versão, no nível do leaderboard, do mesmo
problema de vazamento que o Lab 6 já tratou).

A estratégia correta: usar a validação LOCAL (Passo 2) para reduzir as
opções a um pequeno número de candidatos realmente promissores PRIMEIRO,
usando só 1 ou 2 das submissões reais limitadas para confirmar que a
estimativa local bate, mais ou menos, com o sinal real e independente
do leaderboard.
```

### Passo 4: o relatório honesto, fechando o arco inteiro

```text
RELATÓRIO DO CAPSTONE

Hipótese original (Passo 1): [declarada antes da primeira submissão]
Estimativa da validação local: [a estimativa honesta e retida dos Labs 6/7]
Pontuação no leaderboard (o resultado REAL, calculado de forma independente): [número real]
A validação local previu com precisão a pontuação real do leaderboard?
  [SIM/NÃO; se NÃO, por quanto, e um relato real e honesto do porquê]
Veredito sobre a hipótese original: [SUSTENTADA / REFUTADA, contra o
  número REAL do leaderboard, não contra a estimativa local]
```

Uma estimativa de validação local que acaba discordando da pontuação real do leaderboard mais do que o esperado não é um fracasso a esconder; ela é em si uma evidência real e informativa, que muitas vezes revela que a distribuição dos dados públicos de treino difere um pouco da do conjunto de teste retido. É exatamente o tipo de achado honesto, às vezes desconfortável, que um projeto de pesquisa real pode produzir e que o padrão de honestidade de `good-and-bad-science-measurement-and-reflection` exige relatar em vez de omitir.

## Equívocos Comuns e Armadilhas

- **"Sob pressão de prazo, pular o passo inicial da hipótese para ganhar tempo é razoável, já que o leaderboard vai dizer a resposta real de qualquer jeito."** O leaderboard revela uma pontuação, não se essa pontuação foi prevista com antecedência ou só reconhecida como boa depois do fato; pular o Passo 1 reintroduz exatamente o problema de escolha retroativa de métrica que este arco inteiro foi construído para evitar, agora em condições em que é genuinamente tentador pulá-lo.
- **"Enviar muitas variantes de modelo e ficar com a de maior pontuação no leaderboard é uma estratégia legítima, já que o leaderboard é a verdade real."** Enviar repetidamente e selecionar com base no retorno do leaderboard é em si uma forma de vazamento, no nível do leaderboard em vez do nível do split local, e é justamente por isso que a disciplina do Passo 3 usa a validação local para reduzir os candidatos primeiro, tratando o número limitado de submissões reais como uma checagem honesta e escassa, não como um procedimento de busca.
- **"Uma estimativa de validação local que discorda da pontuação real do leaderboard significa que a metodologia dos labs anteriores estava errada."** Uma discordância real e honesta entre o desempenho local e o do leaderboard é em si uma evidência válida e informativa, muitas vezes sobre quão representativos os dados públicos de treino de fato são do conjunto retido, e o relatório do Passo 4 a trata como um achado a declarar com honestidade, não como um resultado a esconder ou explicar de forma conveniente.

## Resumo

Este capstone percorre de ponta a ponta o ciclo de pesquisa nomeado desta disciplina sob restrições reais e obrigatórias que um conjunto de teste separado localmente nunca impôs: um leaderboard genuinamente retido, um prazo fixo e um orçamento limitado de submissões que torna a busca por força bruta no leaderboard uma forma de vazamento. Aplicar a disciplina de hipótese do Lab 5 antes da primeira submissão, a metodologia honesta de validação local do Lab 6 para reduzir os candidatos antes de gastar submissões reais escassas, e relatar com honestidade o resultado real do leaderboard contra a hipótese original, mesmo quando ele discorda da estimativa local, é o que fecha o arco desta disciplina exatamente onde o framework teórico de `choosing-and-validating-a-model-a-decision-guide` começou, agora testado em condições que tornam realmente caro pular sua disciplina.

## Documentation Links

- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): a fonte do framework de seleção de modelo e validação que este capstone aplica sob as restrições reais de um benchmark competitivo.
- [Pineau et al.: Improving Reproducibility in Machine Learning Research (JMLR, 2021)](https://www.jmlr.org/papers/v22/20-303.html): uma fonte direta de por que documentar a metodologia deste capstone (hipótese, split e estratégia de submissão) importa tanto aqui quanto no lab anterior.
