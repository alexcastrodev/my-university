---
version: 1.0
updatedAt: 2026-09-06
title: Matrizes de Markov e Distribuições Estacionárias
summary: Uma matriz de Markov tem colunas não negativas somando 1; sua distribuição estacionária é um autovetor com autovalor 1, para o qual Mᵏx converge de qualquer início; PageRank define o rank de uma página como sua entrada nessa distribuição.
---
## Objetivos de Aprendizagem

- Definir uma matriz de Markov (coluna-estocástica): entradas não negativas, com toda coluna somando 1, e explicar o que cada coluna representa como uma distribuição de probabilidade.
- Definir uma distribuição estacionária como um autovetor de uma matriz de Markov com autovalor 1, e explicar por que tal autovetor sempre existe para esse tipo de matriz.
- Calcular a distribuição estacionária de uma pequena matriz de Markov à mão, resolvendo Mx = x diretamente.
- Simular uma cadeia de Markov numericamente e observar convergência para sua distribuição estacionária independentemente do ponto de partida.
- Explicar, com um exemplo resolvido concreto, como o PageRank modela a web como uma cadeia de Markov e como o rank de uma página é exatamente uma entrada da distribuição estacionária.

## Contexto e Motivação

Todo conceito até agora no tópico de autovalores desta disciplina tratou Av = λv como um fato puramente algébrico sobre uma matriz. Matrizes de Markov são onde esse fato se transforma em algo que você pode observar acontecer ao longo do tempo. Uma **matriz de Markov** (também chamada de matriz estocástica) é construída para descrever um sistema que se move entre um conjunto fixo de estados passo a passo, de acordo com probabilidades fixas, um caminhante aleatório em um grafo, um cliente se movendo entre níveis de assinatura, uma molécula transitando entre conformações, ou, na aplicação para a qual este conceito constrói, um navegador da web clicando de página em página. O que torna isso uma história de álgebra linear em vez de apenas uma história de probabilidade é um fato genuinamente elegante: não importa onde tal sistema comece, se você deixá-lo rodar por tempo suficiente, seu estado se estabiliza em uma distribuição de longo prazo fixa, e essa distribuição nada mais é do que um autovetor da matriz de Markov, com autovalor exatamente 1.

A aplicação real mais famosa dessa ideia também é uma das peças mais consequentes de álgebra linear aplicada dos últimos trinta anos: o **PageRank**, o algoritmo sobre o qual o Google foi originalmente construído para ranquear páginas web. O insight central da formulação original do PageRank é modelar toda a web como um grafo, páginas são nós, hiperlinks são arestas direcionadas, e depois imaginar um "navegador aleatório" que começa em alguma página e, a cada passo, clica em um link de saída uniformemente aleatório. A probabilidade de que esse navegador aleatório esteja em qualquer página específica, depois de cliques suficientes, converge para uma distribuição estacionária exatamente do tipo desenvolvido neste conceito, e o PageRank de uma página é definido como precisamente sua entrada nessa distribuição estacionária: a fração de "atenção," no longo prazo, que um clicador aleatório gasta nela. Este conceito constrói o maquinário para calcular essa distribuição convergente diretamente, e trabalha um pequeno grafo web resolvido completamente, precisamente para tornar a conexão com PageRank concreta em vez de apenas uma menção de nome.

## Teoria Central

### Definição: matrizes de Markov (estocásticas)

Uma matriz n×n M é uma **matriz de Markov** (ou **matriz coluna-estocástica**) se:

1. Toda entrada é não negativa: Mᵢⱼ ≥ 0 para todo i, j.
2. Toda coluna soma 1: para cada coluna j, Σᵢ Mᵢⱼ = 1.

A interpretação: a coluna j é a distribuição de probabilidade sobre "para onde você vai a seguir," dado que você está atualmente no estado j. A entrada Mᵢⱼ é a probabilidade de transicionar do estado j para o estado i em um passo. Como a coluna j lista probabilidades de cair em algum lugar (possivelmente permanecendo) depois de deixar o estado j, e essas possibilidades são exaustivas e mutuamente exclusivas, elas devem somar exatamente 1, isso é todo o conteúdo da condição 2.

Se x é uma distribuição de probabilidade sobre os n estados em algum ponto no tempo (um vetor de entradas não negativas somando 1, uma entrada por estado), então Mx dá a distribuição de probabilidade um passo depois: (Mx)ᵢ = Σⱼ Mᵢⱼxⱼ soma, sobre todo estado j em que o sistema poderia estar atualmente, a probabilidade de estar em j vezes a probabilidade de se mover de j para i, exatamente a lei da probabilidade total aplicada a "onde estarei em seguida."

### Distribuições estacionárias como autovetores com autovalor 1

Uma **distribuição estacionária** de uma matriz de Markov M é uma distribuição de probabilidade π (entradas não negativas, somando 1) satisfazendo:

Mπ = π

Isso é exatamente a equação de autovetor Mπ = λπ com λ = 1, uma distribuição estacionária nada mais é do que um autovetor de M para o autovalor 1, normalizado para que suas entradas somem 1 (recorde do conceito de autovetores que autovetores são definidos apenas até um múltiplo escalar; a normalização "entradas somam 1" é o que transforma um autovetor genérico para λ = 1 em uma distribuição de probabilidade genuína).

**Por que λ = 1 sempre é um autovalor.** Toda coluna de M soma 1, que é exatamente a afirmação de que toda coluna de Mᵀ (a transposta de M) soma o mesmo valor ao longo de cada *linha*, equivalentemente, Mᵀ aplicado ao vetor de todos-uns 𝟙 = (1,1,…,1) dá de volta 𝟙 em si: (Mᵀ𝟙)ᵢ = Σⱼ (Mᵀ)ᵢⱼ = Σⱼ Mⱼᵢ = 1 (a condição de soma da coluna-j, lida para a coluna i). Então 𝟙 é um autovetor de Mᵀ com autovalor 1. Uma matriz e sua transposta sempre compartilham os mesmos autovalores (têm o mesmo polinômio característico, já que det(A − λI) = det((A − λI)ᵀ) = det(Aᵀ − λI) para qualquer matriz quadrada), então a própria M também tem 1 como autovalor, embora seu autovetor para esse autovalor seja geralmente um vetor diferente de 𝟙, encontrado resolvendo (M − I)π = 0 diretamente.

Sob condições leves em M (informalmente: todo estado pode eventualmente alcançar todo outro estado, e a cadeia não cicla rigidamente entre um conjunto fixo de estados sem possibilidade de se estabilizar, condições estudadas com mais profundidade em um curso completo sobre cadeias de Markov, e passadas por cima aqui), essa distribuição estacionária é única, e, crucialmente para a interpretação abaixo, o sistema converge para ela a partir de *qualquer* distribuição inicial conforme você aplica M repetidamente:

Mᵏx → π conforme k → ∞, para essencialmente qualquer distribuição inicial válida x

Essa convergência é precisamente uma história de diagonalização: escrevendo M = PDP⁻¹ (ou sua generalização quando autovalores se repetem), Mᵏx = PDᵏP⁻¹x, e como 1 é o autovalor de maior magnitude para uma matriz de Markov bem comportada, a contribuição de todo outro autovalor a Dᵏ encolhe em direção a 0 conforme k cresce, deixando apenas o componente λ = 1 sobrevivendo no limite, que é exatamente π.

```mermaid
graph LR
    X0["Qualquer distribuição<br/>inicial x"] -->|"aplica M"| X1["Mx"]
    X1 -->|"aplica M"| X2["M²x"]
    X2 -->|"aplica M, repete..."| Xn["Mᵏx"]
    Xn -->|"k → ∞"| Pi["π (distribuição estacionária)<br/>= autovetor de M, autovalor 1"]
```

### A conexão com o PageRank

Modele a web como um grafo direcionado: cada página é um nó, e um hiperlink da página j para a página i é uma aresta direcionada j → i. Construa uma matriz de Markov M onde a coluna j é uma distribuição uniforme sobre os links de saída da página j: se a página j tem k links de saída, cada página vinculada recebe probabilidade 1/k na coluna j (e páginas para as quais j não linka recebem probabilidade 0 nessa coluna). Essa matriz M modela um "navegador aleatório": a cada passo, a partir de qualquer página em que esteja, ele clica em um link de saída uniformemente aleatório daquela página.

O PageRank de uma página é definido como exatamente sua entrada na distribuição estacionária π dessa matriz, a fração de longo prazo de cliques que o navegador aleatório gasta nela. Uma página acumula PageRank alto sendo vinculada por outras páginas, especialmente páginas que elas próprias têm PageRank alto e relativamente poucos links de saída para "diluir" seu voto entre eles, exatamente a intuição recursiva ("páginas importantes são aquelas vinculadas por outras páginas importantes") que faz o PageRank parecer quase circular em sua definição, e é a equação de autovetor Mπ = π que resolve a aparente circularidade em um único vetor bem definido e computável.

## Exemplos Resolvidos

### Exemplo 1 — calculando uma distribuição estacionária à mão

**Problema:** Encontre a distribuição estacionária de M = [[0,5, 0,3], [0,5, 0,7]] (uma matriz de Markov de dois estados, o estado 1 permanece com probabilidade 0,5 e se move para o estado 2 com probabilidade 0,5; o estado 2 permanece com probabilidade 0,7 e se move para o estado 1 com probabilidade 0,3).

**Monte Mπ = π, ou seja, (M − I)π = 0.**

M − I = [[0,5−1, 0,3], [0,5, 0,7−1]] = [[−0,5, 0,3], [0,5, −0,3]]

**Resolva.** Primeira linha: −0,5π₁ + 0,3π₂ = 0, então π₂ = (0,5/0,3)π₁ = (5/3)π₁. (A segunda linha, 0,5π₁ − 0,3π₂ = 0, dá a equação idêntica, como esperado, essa dependência é exatamente o que det(M−I) = 0 garante.)

**Normalize para que as entradas somem 1.** π₁ + π₂ = 1, e π₂ = (5/3)π₁, então π₁ + (5/3)π₁ = 1 → (8/3)π₁ = 1 → π₁ = 3/8. Então π₂ = 5/8.

**Verifique:** π = (3/8, 5/8). Verifique Mπ = π: Mπ = (0,5·3/8 + 0,3·5/8, 0,5·3/8 + 0,7·5/8) = (1,5/8 + 1,5/8, 1,5/8 + 3,5/8) = (3/8, 5/8) ✓.

### Exemplo 2 — simulando convergência a partir de um início arbitrário

**Problema:** Começando de x₀ = (1, 0) (toda probabilidade no estado 1), verifique numericamente que aplicação repetida de M do Exemplo 1 converge para π = (3/8, 5/8) = (0,375, 0,625).

```python
def matvec(M, x):
    return [sum(M[i][j] * x[j] for j in range(len(x))) for i in range(len(M))]

M = [[0.5, 0.3], [0.5, 0.7]]
x = [1.0, 0.0]  # começa inteiramente no estado 1

for step in range(15):
    x = matvec(M, x)

print(x)  # converge para [0.375, 0.625]
```

Executar isso mostra x se aproximando rapidamente de (0,375, 0,625) dentro de poucos passos, a mesma distribuição estacionária encontrada algebricamente no Exemplo 1, independentemente do fato de que essa execução começou de um ponto de partida completamente diferente e "injusto" (toda massa no estado 1). Começar em vez disso de x₀ = (0, 1), ou de uma divisão igual (0,5, 0,5), converge para o (0,375, 0,625) idêntico, a característica definidora de uma distribuição estacionária alcançada a partir de qualquer ponto de partida válido.

### Exemplo 3 — um grafo web de brinquedo com 4 páginas e seu PageRank

**Problema:** Considere uma web minúscula com quatro páginas, P1–P4, vinculadas assim: P1 vincula para P2 e P3; P2 vincula apenas para P3; P3 vincula para P1 e P4; P4 vincula apenas para P1. Construa a matriz de Markov (seguindo links), e encontre a distribuição estacionária, o PageRank de cada página.

**Construa a matriz de transição.** A coluna j lista, para os links de saída da página j, uma probabilidade uniforme sobre eles. P1 tem 2 links de saída (para P2, P3), então a coluna 1 coloca 1/2 na linha P2 e 1/2 na linha P3. P2 tem 1 link de saída (para P3), então a coluna 2 coloca 1 na linha P3. P3 tem 2 links de saída (para P1, P4), então a coluna 3 coloca 1/2 na linha P1 e 1/2 na linha P4. P4 tem 1 link de saída (para P1), então a coluna 4 coloca 1 na linha P1. Ordenando linhas/colunas como (P1, P2, P3, P4):

M =
```
        de P1    de P2    de P3    de P4
para P1 [  0        0       0.5      1    ]
para P2 [  0.5       0        0        0   ]
para P3 [  0.5       1        0        0   ]
para P4 [  0        0       0.5      0    ]
```

Cada coluna soma 1, confirmando que M é uma matriz de Markov válida.

**Resolva Mπ = π à mão.** Escrevendo π = (a, b, c, d):

Linha P1: 0,5c + d = a
Linha P2: 0,5a = b
Linha P3: 0,5a + b = c
Linha P4: 0,5c = d

Da linha P4: d = c/2. Substituindo na linha P1: 0,5c + c/2 = a, ou seja, a = c. Da linha P2: b = a/2 = c/2. Verificando a linha P3: 0,5a + b = c/2 + c/2 = c ✓ (consistente, como esperado). Então a = c, b = d = c/2. Normalizando a+b+c+d = 1: c + c/2 + c + c/2 = 3c = 1, então c = 1/3, dando:

π = (a, b, c, d) = (1/3, 1/6, 1/3, 1/6)

**Interpretação.** P1 e P3 acabam cada uma com PageRank 1/3, as duas páginas mais "importantes" nessa web de brinquedo, enquanto P2 e P4 ficam para trás em 1/6 cada. Isso corresponde à intuição: P1 recebe links tanto de P3 quanto de P4 (duas fontes de "votos" de entrada), e P3 recebe links tanto de P1 quanto de P2, as duas páginas mais vinculadas saem no topo, exatamente como a intuição recursiva do PageRank prevê, mas agora resolvida em um único número preciso e computável para cada página em vez de uma noção vaga de "importância."

**Verificando via simulação.** Uma verificação de iteração de potência confirma a mesma resposta: começando de uma distribuição uniforme (0,25, 0,25, 0,25, 0,25) sobre as quatro páginas (modelando um navegador aleatório começando em qualquer lugar com chance igual) e aplicando repetidamente M converge numericamente para (0,333…, 0,167…, 0,333…, 0,167…), correspondendo exatamente a (1/3, 1/6, 1/3, 1/6), confirmando tanto que a solução algébrica está correta quanto que ela é genuinamente o limite alcançado por seguir links repetidamente, não apenas uma curiosidade algébrica.

```python
def matvec(M, x):
    return [sum(M[i][j] * x[j] for j in range(len(x))) for i in range(len(M))]

M = [
    [0,   0,   0.5, 1],
    [0.5, 0,   0,   0],
    [0.5, 1,   0,   0],
    [0,   0,   0.5, 0],
]
x = [0.25, 0.25, 0.25, 0.25]

for step in range(30):
    x = matvec(M, x)

print(x)  # converge para [0.333, 0.167, 0.333, 0.167]
```

## Equívocos Comuns e Armadilhas

- **"A distribuição estacionária é o autovetor com as maiores entradas, encontrada por inspeção."** Ela é definida precisamente como o autovetor para autovalor exatamente 1 (normalizado para somar 1), deve ser encontrada resolvendo (M − I)π = 0 (ou verificada checando Mπ = π diretamente), não adivinhada examinando as entradas de uma matriz.
- **"Qualquer matriz quadrada com linhas ou colunas de probabilidades tem uma distribuição estacionária alcançável de todo início."** A existência de *algum* autovetor para autovalor 1 é garantida pela condição de soma-das-colunas-igual-a-1 sozinha, mas *convergência de todo ponto de partida* para uma distribuição estacionária *única* exige adicionalmente que a cadeia seja bem comportada (capaz de alcançar todo estado a partir de todo outro, e não presa em um ciclo rígido), condições que este conceito enuncia informalmente em vez de provar, mas que ocasionalmente falham para estruturas de transição patológicas.
- **"Coluna-estocástica e linha-estocástica são a mesma convenção, então não importa qual fonte usa."** Este conceito fixa colunas somando 1, correspondendo a Mx = distribuição de probabilidade um passo depois. Algumas fontes em vez disso definem matrizes linha-estocásticas (linhas somando 1) com a convenção xM em vez de Mx, algebricamente equivalente até uma transposta, mas misturar as duas convenções dentro de um único cálculo silenciosamente produz respostas erradas.
- **"Uma página com PageRank zero deve não ter links de saída."** São os links de *entrada* (e o PageRank das páginas que a vinculam) que aumentam o PageRank, não links de saída, links de saída apenas determinam como o próprio PageRank de uma página é dividido e repassado a outras. Uma página com muitos links de saída mas zero links de entrada (como uma página "pendurada" que ninguém vincula) na verdade recebe PageRank baixo, precisamente porque nada alimenta probabilidade em sua linha de M.

## Resumo

Uma matriz de Markov tem entradas não negativas com cada coluna somando 1, de modo que a coluna j representa a distribuição de probabilidade sobre para onde um sistema no estado j se move a seguir. Sua distribuição estacionária, a distribuição de probabilidade de longo prazo na qual o sistema se estabelece independentemente do ponto de partida, é exatamente um autovetor da matriz para autovalor 1, um fato garantido pela própria condição de soma-das-colunas (via os autovalores compartilhados de M e Mᵀ) e alcançável no limite graças ao maquinário de diagonalização de anteriormente neste tópico. PageRank é a aplicação historicamente central dessa exata ideia: modele a web como um grafo, construa uma matriz de Markov a partir de probabilidades uniformes de seguir links, e o rank de uma página é precisamente sua entrada na distribuição estacionária resultante, trabalhado concretamente acima para uma pequena web de brinquedo de 4 páginas, onde as duas páginas mais vinculadas convergiram para o rank mais alto, 1/3 cada, correspondendo exatamente tanto à equação de autovetor resolvida à mão quanto a uma caminhada aleatória simulada diretamente.

## Documentation Links

- [MIT 18.06 — Course Home (OCW)](https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/) — doc
- [MIT 18.06SC — Syllabus (OCW)](https://www.ocw.mit.edu/courses/18-06sc-linear-algebra-fall-2011/pages/syllabus) — doc
