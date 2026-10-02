---
version: 1.0
updatedAt: 2026-09-06
title: Inferência Exata em Redes Bayesianas
summary: Responder a uma consulta em uma rede bayesiana, seja enumerando diretamente a distribuição conjunta, seja com o algoritmo de eliminação de variáveis, muito mais barato, que soma as variáveis irrelevantes uma de cada vez e guarda os fatores intermediários em cache em vez de recalcular a conjunta inteira.
---
## Objetivos de Aprendizagem

- Enunciar a tarefa de inferência em uma rede bayesiana: calcular $P(\text{variável de consulta} \mid \text{evidência observada})$.
- Descrever a inferência por enumeração: somar a distribuição conjunta completa (recuperada a partir das CPTs da rede) sobre todos os valores de todas as variáveis que não são de consulta nem de evidência.
- Descrever a eliminação de variáveis como uma alternativa mais eficiente, que soma as variáveis irrelevantes uma de cada vez e guarda em cache os fatores intermediários resultantes.
- Rastrear a inferência por enumeração e a eliminação de variáveis na mesma consulta pequena, comparando o número real de multiplicações que cada uma faz.
- Explicar por que a economia da eliminação de variáveis vem especificamente de reaproveitar cálculos intermediários compartilhados, e não de uma resposta final diferente.

## Contexto e Motivação

O conceito anterior estabeleceu como construir uma rede bayesiana (um grafo mais uma pequena tabela de probabilidade condicional por nó) e mostrou que ela codifica de forma compacta uma distribuição conjunta completa como um produto dessas tabelas locais. Essa representação só é útil, porém, se for de fato possível calcular a partir dela a resposta a uma pergunta genuína: dado que John ligou (evidência), qual é a probabilidade de ter havido um roubo (a consulta)? Este conceito cobre exatamente esse cálculo, a **inferência** em redes bayesianas, começando pela abordagem direta e de força bruta (enumeração) e depois mostrando a alternativa padrão, muito mais eficiente (eliminação de variáveis), que sistemas reais de fato usam.

As duas abordagens calculam exatamente a mesma resposta; elas não são um trade-off entre velocidade e correção. A diferença está só em quanta computação redundante é evitada pelo caminho; o mesmo tipo de preocupação de engenharia já vista quando a programação dinâmica foi apresentada como melhoria sobre o recálculo recursivo redundante, aplicada aqui a cálculos de probabilidade redundantes em vez de subproblemas resolvidos de novo.

## Teoria Central

### A tarefa de inferência, com precisão

Dada uma rede bayesiana sobre variáveis particionadas em uma variável de consulta $X$, um conjunto de variáveis de evidência $E$ com valores observados $e$ e um conjunto de variáveis restantes, não observadas, $Y$, a tarefa de inferência é calcular $P(X \mid E = e)$. Pela definição de probabilidade condicional, isso é igual a $P(X, E=e) / P(E=e)$, e tanto o numerador quanto a constante de normalização no denominador podem ser obtidos **somando** (marginalizando) todos os valores de todas as variáveis de $Y$ na distribuição conjunta completa.

### Inferência por enumeração

A distribuição conjunta completa, recuperável como o produto das CPTs da rede (pela fatoração do conceito anterior), pode ser somada diretamente:

```text
P(X, e) = Σ  P(X, e, y)
         y ∈ Y

em que P(X, e, y), para qualquer atribuição completa específica, é calculado
multiplicando a entrada da CPT de cada variável dados os valores dos seus
pais naquela atribuição.
```

Isso está correto, mas repete uma quantidade enorme de multiplicações redundantes: muitos termos diferentes da soma sobre $Y$ acabam recalculando exatamente os mesmos produtos parciais, porque combinações diferentes das variáveis não observadas muitas vezes compartilham os mesmos valores para algumas das variáveis da rede.

### Eliminação de variáveis: somar uma variável de cada vez

A **eliminação de variáveis** reestrutura a mesma soma para eliminar as variáveis uma de cada vez, em vez de todas de uma vez, e, crucialmente, guarda a soma de cada variável como um **fator** intermediário (uma tabela sobre as variáveis restantes das quais ele ainda depende) que pode ser reaproveitado no resto do cálculo, em vez de ser recalculado dentro de cada termo de uma soma combinada gigante.

```mermaid
flowchart LR
    A["Produto completo das CPTs\n(todas as variáveis)"] --> B["Soma uma variável\nnão observada,\nproduzindo um novo fator"]
    B --> C["Multiplica os fatores\nrestantes entre si"]
    C --> D{"Ainda restam variáveis\nnão observadas?"}
    D -->|Sim| B
    D -->|Não| E["Normaliza o\nfator restante\nsobre a variável de consulta"]
```

A ordem em que as variáveis são eliminadas afeta o tamanho dos fatores intermediários (uma ordem de eliminação ruim pode, no pior caso, produzir um fator do tamanho que a distribuição conjunta completa teria), mas para muitas redes práticas, em especial as de estrutura esparsa, em árvore ou quase em árvore, uma boa ordem de eliminação mantém todo fator intermediário pequeno e o trabalho total muito abaixo do que a enumeração exigiria.

### Por que isso não é uma aproximação

Cada passo da eliminação de variáveis (somar uma variável fora de um produto de fatores, multiplicar fatores entre si) é uma manipulação algébrica exata da mesma distribuição conjunta completa que a enumeração calcularia diretamente. A eliminação de variáveis nunca descarta um termo nem aproxima uma probabilidade; ela só reorganiza *quando* cada parte da soma total é calculada, para que resultados parciais compartilhados sejam calculados uma vez e reaproveitados, em vez de recalculados separadamente dentro de cada ramo de uma soma combinada gigante. A resposta final é, em todos os casos, idêntica à que a enumeração produziria.

## Exemplos Resolvidos

### Exemplo 1: inferência por enumeração na rede do Roubo

Reaproveitando a rede Burglary/Earthquake/Alarm/JohnCalls/MaryCalls do conceito anterior, a consulta é: $P(Burglary \mid JohnCalls = true)$.

```text
P(B, j) = Σ Σ Σ  P(B) P(e) P(a|B,e) P(j|a) P(m|a)
          e a m

Para B = true:
  Soma sobre e ∈ {true,false}, a ∈ {true,false}, m ∈ {true,false}:
    8 combinações, cada uma exigindo uma multiplicação de 5 fatores (P(B)×P(e)×P(a|B,e)×P(j|a)×P(m|a))
  → 8 termos, cada um um produto de 5 números, só para B=true.
  Repete o mesmo cálculo de 8 termos para B=false.

Total: 16 termos, cada um exigindo 5 multiplicações = 80 multiplicações,
só para calcular o numerador (não normalizado) para os dois valores de B.
```

Repare que a soma sobre $m$ (MaryCalls) é totalmente irrelevante para a consulta sobre Burglary, exceto via Alarm, e ainda assim a enumeração recalcula $P(m \mid a)$ dentro de cada um desses 16 termos; exatamente o tipo de recálculo redundante que a eliminação de variáveis foi projetada para eliminar.

### Exemplo 2: a mesma consulta via eliminação de variáveis

```text
Passo 1: Soma MaryCalls primeiro, já que ela não aparece em nenhum outro
         cálculo além de P(m|a):
  f_M(a) = Σ P(m|a) = P(m=true|a) + P(m=false|a) = 1  para todo valor de a
  (somar uma variável inteiramente fora da sua própria CPT, sem nada mais
   dependendo dela, sempre dá o fator trivial 1; MaryCalls, depois de somada
   sem mais nenhum uso, não contribui com mais nada para o cálculo)

Passo 2: Trata JohnCalls de forma parecida, mas aqui ela É observada (j=true),
         então em vez de somar sobre os dois valores, o fator dela simplesmente
         usa o valor observado direto: f_J(a) = P(j=true | a), uma tabela de
         2 entradas sobre a ∈ {true, false}.

Passo 3: Soma Earthquake:
  f_E(B, a) = Σ P(e) P(a | B, e)     uma tabela pequena sobre B e a,
              e                        calculada uma vez e reaproveitada
                                         para os dois valores de B.

Passo 4: Soma Alarm:
  f_A(B) = Σ f_E(B,a) × f_J(a)       combina os dois fatores que ainda
           a                            mencionam a, produzindo uma
                                          tabela só sobre B.

Passo 5: Multiplica por P(B) e normaliza sobre B=true e B=false.
```

Cada fator aqui (f_M, f_J, f_E, f_A) é calculado exatamente uma vez e reaproveitado onde for necessário, em vez de ser recalculado separadamente dentro de 16 termos diferentes de enumeração; o número de multiplicações de fato necessárias cai bastante (bem menos da metade das 80 contadas no Exemplo 1 para esta rede pequena, com a diferença crescendo dramaticamente em redes maiores), enquanto a resposta numérica final para $P(Burglary \mid JohnCalls=true)$ é idêntica nos dois casos.

### Exemplo 3: o efeito da ordem de eliminação no tamanho dos fatores intermediários

```text
Considere uma rede em que a variável X tem muitos descendentes "a jusante"
que, no fim, alimentam todos uma única variável compartilhada Y antes de
chegar à consulta.

Ordem de eliminação A: elimina primeiro os descendentes de X, um de cada
  vez, cada um produzindo um fator pequeno só sobre Y e seus vizinhos diretos.

Ordem de eliminação B: elimina Y muito cedo, antes de seus descendentes
  terem sido somados, forçando o fator resultante a depender de todos os
  muitos vizinhos de Y ainda não somados ao mesmo tempo; uma tabela
  intermediária muito maior do que a ordem A jamais produz.
```

Isso ilustra, sem precisar de números exatos, por que a ordem de eliminação é uma preocupação algorítmica genuína da eliminação de variáveis, e não um detalhe de implementação: uma ordem ruim pode, no pior caso, produzir um fator intermediário quase tão grande quanto a distribuição conjunta completa, apagando a maior parte da vantagem do algoritmo sobre a enumeração simples, embora as duas ordens sempre calculem exatamente a mesma resposta final.

## Equívocos Comuns e Armadilhas

- **"A eliminação de variáveis dá uma resposta aproximada em troca de velocidade."** Cada passo é uma manipulação algébrica exata da mesma distribuição conjunta subjacente que a enumeração calcula; a resposta final é sempre idêntica. O ganho de velocidade vem inteiramente de evitar recálculos redundantes, e não de perder precisão em algum ponto.
- **"Variáveis de evidência precisam ser somadas como qualquer outra variável."** O valor de uma variável de evidência observada já é conhecido; em vez de somar sobre todos os valores possíveis, o fator dela simplesmente usa direto o único valor observado, e é justamente por isso que observar mais evidência tende a tornar a inferência mais barata, e não mais cara: menos variáveis precisam de fato ser somadas.
- **"Qualquer ordem de eliminação tem o mesmo custo computacional."** Como mostra o Exemplo 3, a ordem de eliminação pode afetar dramaticamente o tamanho dos fatores intermediários e, portanto, o trabalho total necessário, embora nunca afete a resposta numérica final; escolher uma boa ordem é um problema algorítmico real e separado (ligado à estrutura do grafo da rede) que implementações reais tratam explicitamente.
- **"Tendo as CPTs da rede, qualquer consulta pode ser respondida instantaneamente."** A inferência exata, mesmo com as melhorias da eliminação de variáveis, ainda pode ser computacionalmente cara em redes grandes e densamente conectadas (um problema computacional reconhecidamente difícil no pior caso); é parte do motivo de existirem métodos de inferência aproximada (abordagens baseadas em amostragem, não vistas nesta disciplina) como alternativa prática para as maiores e mais densamente conectadas redes do mundo real.

## Resumo

A inferência em redes bayesianas calcula $P(\text{consulta} \mid \text{evidência})$ marginalizando a distribuição conjunta completa (recuperável como produto das CPTs da rede) sobre todos os valores de todas as variáveis restantes não observadas; a inferência por enumeração faz isso diretamente e recalcula muitos produtos parciais redundantes no processo, enquanto a eliminação de variáveis reestrutura exatamente o mesmo cálculo para somar uma variável de cada vez, guardando cada resultado como um fator intermediário reaproveitável, chegando a uma resposta final idêntica com bem menos trabalho redundante, embora a economia real dependa de uma ordem de eliminação bem escolhida. Isso encerra o raciocínio probabilístico estático (de um único instante) visto até aqui; o próximo conceito estende as redes bayesianas ao longo do tempo, para os modelos ocultos de Markov, para raciocinar sobre um estado oculto que evolui conforme nova evidência chega a cada passo.

## Documentation Links

- [Russell & Norvig: Artificial Intelligence: A Modern Approach](https://aima.cs.berkeley.edu/contents.html): o tratamento canônico da inferência exata por enumeração e por eliminação de variáveis em redes bayesianas.
- [UC Berkeley CS188: Introduction to Artificial Intelligence](https://inst.eecs.berkeley.edu/~cs188/sp24/): curso que cobre a eliminação de variáveis como o algoritmo padrão e eficiente de inferência exata em redes bayesianas.
