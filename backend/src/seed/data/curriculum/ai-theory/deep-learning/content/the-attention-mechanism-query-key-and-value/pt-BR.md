---
version: 1.0
updatedAt: 2026-09-07
title: "O Mecanismo de Atenção: Query, Key e Value"
summary: Uma resposta diferente para o mesmo problema que o gating de LSTM/GRU só resolve em parte. Deixar cada posição de saída olhar diretamente para cada posição de entrada, em vez de comprimir todo o histórico da sequência em um único estado oculto, calculado com nada mais exótico que o produto escalar. Um vetor query é comparado com cada vetor key, e as pontuações resultantes ponderam uma soma de vetores value.
---
## Objetivos de Aprendizagem

- Explicar a limitação específica das arquiteturas recorrentes que a atenção trata: comprimir todo o histórico de uma sequência em um único estado oculto de tamanho fixo.
- Definir os vetores query, key e value e explicar o papel de cada um no cálculo de uma saída de atenção.
- Calcular à mão a scaled dot-product attention em um exemplo pequeno e concreto.
- Explicar por que o produto escalar, já visto como uma operação básica da álgebra vetorial, é exatamente a ferramenta certa para medir quão bem uma query casa com uma key.

## Contexto e Motivação

O gating de LSTM/GRU do conceito anterior melhora bastante a distância que os gradientes (e, portanto, as dependências aprendidas) conseguem percorrer em uma sequência, mas faz isso melhorando a *memória* do estado oculto recorrente; cada pedaço relevante do histórico da sequência inteira ainda precisa ser comprimido em um único vetor que evolui, atualizado um passo de tempo por vez. A atenção adota uma abordagem estruturalmente diferente: em vez de depender de um único resumo acumulado, deixar cada posição de saída olhar direta e individualmente para cada posição de entrada, e deixar a própria rede aprender quanto peso dar a cada uma. Isso é calculado com nada mais exótico que o produto escalar que `foundations/mathematics-for-computing` já cobriu como fato básico da álgebra vetorial: comparar dois vetores por quão alinhados eles estão.

## Teoria Central

### Query, key e value

A atenção opera sobre três conjuntos de vetores, todos derivados da entrada por projeções lineares aprendidas separadas:

- Um vetor **query** `q` representa "o que estou procurando agora"; normalmente derivado da posição de saída que está sendo calculada.
- Um vetor **key** `k`, um por posição de entrada, representa "o que esta posição oferece"; usado para ser comparado com a query.
- Um vetor **value** `v`, um por posição de entrada, representa "que conteúdo esta posição de fato contribui" se receber atenção.

A query é comparada com cada key para produzir uma pontuação de relevância para cada posição de entrada; essas pontuações então determinam quanto do *value* de cada posição contribui para a saída da atenção; as keys determinam *onde* olhar, os values determinam *o que* é recuperado quando se olha ali.

### Scaled dot-product attention

A pontuação de relevância entre uma query `q` e uma key `kᵢ` é o produto escalar delas, `q·kᵢ`; precisamente a operação da álgebra vetorial já estabelecida como medida de quão alinhados dois vetores estão: quanto mais `q` e `kᵢ` apontam em direções parecidas (no espaço de embeddings aprendido), maior o produto escalar e mais relevante a rede aprendeu que a posição `i` é para esta query. Essas pontuações brutas são reduzidas por `√d` (`d` é a dimensionalidade dos vetores key, para evitar que as pontuações cresçam demais conforme `d` aumenta e desestabilizem o softmax seguinte) e depois passam pelo softmax (exatamente a função já derivada nesta disciplina) para produzir um conjunto de pesos que somam 1:

```text
Attention(q, K, V) = softmax(q·K^T / √d) · V
```

em que `K` e `V` empilham os vetores key e value de cada posição de entrada como linhas. A saída é uma soma ponderada de todos os vetores value, com os pesos determinados inteiramente por quão bem a query casou com cada key correspondente.

## Exemplos Resolvidos

### Exemplo 1: pesos de atenção de uma query contra 3 keys

Seja a query `q = (1, 0)` e três keys `k₁ = (1, 0)`, `k₂ = (0, 1)`, `k₃ = (0.5, 0.5)`, com `d = 2`, então `√d ≈ 1.414`.

```text
q·k₁ = 1(1) + 0(0) = 1.0        escalada: 1.0 / 1.414 ≈ 0.707
q·k₂ = 1(0) + 0(1) = 0.0        escalada: 0.0 / 1.414 = 0.000
q·k₃ = 1(0.5) + 0(0.5) = 0.5    escalada: 0.5 / 1.414 ≈ 0.354

softmax(0.707, 0.000, 0.354):
  e^0.707 ≈ 2.028,  e^0.000 = 1.000,  e^0.354 ≈ 1.425
  soma ≈ 4.453
  pesos ≈ (0.455, 0.225, 0.320)
```

A key mais alinhada com a query (`k₁`, apontando exatamente na mesma direção) recebe o maior peso (≈45,5%), a key ortogonal (`k₂`) recebe o menor (≈22,5%) e a key parcialmente alinhada (`k₃`) recebe um peso intermediário; exatamente o comportamento intuitivo esperado de "olhe mais para o que casa melhor", agora calculado com precisão.

### Exemplo 2: a saída da atenção como soma ponderada dos values

Continuando o Exemplo 1, suponha que os vetores value correspondentes sejam `v₁ = (10, 0)`, `v₂ = (0, 10)`, `v₃ = (5, 5)`. A saída da atenção é a soma ponderada, usando os pesos `(0.455, 0.225, 0.320)` do Exemplo 1:

```text
saída = 0.455·(10, 0) + 0.225·(0, 10) + 0.320·(5, 5)
      = (4.55, 0) + (0, 2.25) + (1.60, 1.60)
      = (6.15, 3.85)
```

A saída não é exatamente `v₁` nem uma média simples dos três values: ela é puxada predominantemente para `v₁` (o value que corresponde à key que melhor casou), mas ainda incorpora alguma contribuição dos outros dois, exatamente na proporção em que suas keys casaram com a query.

## Equívocos Comuns e Armadilhas

- **"A atenção substitui o produto escalar por alguma medida de similaridade mais sofisticada."** A scaled dot-product attention usa exatamente o produto escalar já visto como operação básica da álgebra vetorial; os únicos acréscimos são o fator de escala `√d` (por estabilidade numérica) e a normalização softmax (já derivada nesta disciplina), que transforma pontuações brutas em pesos.
- **"Keys e values são a mesma coisa, só usada de jeitos diferentes."** Normalmente são produzidos por duas projeções lineares aprendidas separadas da mesma entrada e podem acabar representando informações genuinamente diferentes; a key é otimizada para *ser comparada*, o value para *ser recuperado e usado*, e não há nenhuma exigência de que esses dois papéis sejam mais bem atendidos por vetores idênticos.
- **"Um peso de atenção maior sempre significa que o value correspondente é mais importante para acertar a resposta."** Os pesos refletem o que a rede aprendeu que faz uma query e uma key "casarem" para a tarefa em que foi treinada; é uma noção de relevância aprendida e específica da tarefa, e não uma medida geral de importância independente do que a rede foi treinada para fazer.

## Resumo

A atenção permite que cada posição de saída olhe diretamente para cada posição de entrada, usando uma query, um conjunto de keys e um conjunto de values, todos derivados da entrada por projeções aprendidas. O produto escalar entre uma query e cada key (precisamente a operação da álgebra vetorial já estabelecida neste currículo) produz uma pontuação de relevância para cada posição de entrada; escalar por `√d` e aplicar softmax transforma essas pontuações em pesos que somam 1, e a saída da atenção é a soma ponderada resultante dos vetores value. Isso evita diretamente o gargalo do estado oculto único que limitava até as arquiteturas recorrentes com gating de LSTM/GRU, preparando o próximo conceito, que aplica esse mesmo mecanismo aos próprios tokens de uma sequência.

## Documentation Links

- [Dive into Deep Learning: Attention Mechanisms and Transformers: Queries, Keys, and Values](https://d2l.ai/chapter_attention-mechanisms-and-transformers/index.html): o enquadramento de query/key/value e a formulação de scaled dot-product que este conceito segue diretamente.
- [CS231n: Course Schedule (Stanford, Spring 2026)](https://cs231n.stanford.edu/schedule.html): confirma "Self-Attention, Transformers" como aula dedicada do próprio curso, refletindo a importância atual da atenção na área.
