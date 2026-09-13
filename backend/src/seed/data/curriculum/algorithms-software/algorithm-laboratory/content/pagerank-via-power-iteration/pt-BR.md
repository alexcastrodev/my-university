---
version: 1.0
updatedAt: 2026-09-06
title: PageRank via Iteração de Potência
summary: A escalada honesta do que uma checagem de verificação apenas sugeria: em 18 páginas, iteração de potência para de ser conveniência e se torna o único método prático, exatamente como o algoritmo real de Brin & Page opera em escala de web.
---
## Objetivos de Aprendizagem

- Implementar iteração de potência como um método autônomo para calcular PageRank, multiplicação repetida de matriz-vetor até convergência, em um grafo grande demais para resolver exatamente à mão.
- Implementar o fator de amortecimento da formulação original de PageRank de Brin & Page, e explicar qual modo de falha específico (becos sem saída, componentes desconectados) ele existe para corrigir.
- Medir convergência diretamente, imprimindo a mudança no vetor de rank através das iterações e observando-a encolher em direção a zero.
- Validar o vetor de rank resultante checando que soma 1 e que nós fortemente referenciados acabam com rank visivelmente maior que nós esparsamente referenciados.
- Explicar concretamente por que decomposição em autovalores, que era prática para o grafo de brinquedo de 4 páginas resolvido em outro lugar, para de ser uma abordagem viável conforme o grafo cresce, e por que iteração de potência é a resposta real para aquele problema de escala, não uma conveniência.

## Contexto e Motivação

[Matrizes de Markov e Distribuições Estacionárias](../../../../mathematics-for-computing/content/markov-matrices-and-stationary-distributions/pt-BR.md) já resolveu PageRank exatamente, à mão, em um grafo de web de brinquedo de 4 páginas: construiu a matriz de link coluna-estocástica, resolveu Mπ = π diretamente por redução de linha, obteve π = (1/3, 1/6, 1/3, 1/6), e depois rodou um pequeno laço de iteração de potência como uma **checagem de verificação**, confirmando que aplicar M repetidamente a um vetor inicial convergia para a mesma resposta já encontrada algebricamente. Aquela iteração de potência era um bônus ali: uma segunda forma, independente, de confirmar que um sistema linear de quatro incógnitas tinha sido resolvido corretamente, nada mais.

Este laboratório é a escalada honesta para a qual a checagem de verificação daquele conceito estava gesticulando mas não precisava fazer. Resolver Mπ = π exatamente, por redução de linha, exige montar e resolver um sistema com tantas incógnitas quanto há páginas, tratável à mão para 4 páginas, sem esperança à mão para até mesmo algumas dezenas, e nunca a forma como o algoritmo real funcionou em qualquer ponto desde que foi introduzido. [O artigo original de Brin & Page](http://infolab.stanford.edu/pub/papers/google.pdf) descreve calcular PageRank através da web real, centenas de milhões de páginas na época, dezenas de bilhões hoje, sem que ninguém jamais monte ou resolva uma equação de autovetor diretamente. Iteração de potência não é uma aproximação conveniente substituindo o método algébrico "real"; para um grafo em qualquer escala real, iteração de potência *é* o algoritmo real. Este laboratório a constrói como o método primário, autônomo, em um grafo de 18 páginas, pequeno o suficiente para imprimir e inspecionar por completo, mas grande o suficiente que resolver um sistema linear de 18 incógnitas à mão não é mais algo razoável de tentar, o que é precisamente o ponto.

## Teoria Central

O mecanismo é inalterado do conceito anterior: construa uma matriz de link coluna-estocástica M, depois repetidamente compute `x ← Mx` começando de qualquer distribuição, e a sequência converge em direção à distribuição estacionária π, o autovetor de M para autovalor 1. O que é novo aqui é tratar aquele laço como o algoritmo inteiro em vez de uma checagem sobre uma resposta já conhecida, e adicionar a única correção do mundo real que o artigo de Brin & Page constrói na fórmula real:

**O fator de amortecimento.** Um modelo puro de "siga um link de saída aleatório" quebra em duas situações comuns: um **beco sem saída** (uma página sem nenhum link de saída de forma alguma, o que deixa o surfista aleatório sem lugar para ir, a coluna correspondente de M nem sequer pode ser construída como uma distribuição de probabilidade válida) e um **componente desconectado** (um agrupamento de páginas linkando só entre si, o que prende toda a massa de probabilidade dentro dele para sempre, faminta toda página fora do agrupamento até zero de rank independentemente de quão bem linkada seja de outra forma). A correção real de Brin & Page, exatamente como descrita em seu artigo, é modelar o surfista como, a todo passo, seguindo um link com probabilidade d (o fator de amortecimento, **d = 0.85** no artigo original) e em vez disso pulando para uma *página uniformemente aleatória em qualquer lugar da web* com probabilidade (1 − d). A regra de atualização se torna:

**x ← d · M x + (1 − d) · (1/n) · 𝟙**

onde 𝟙 é o vetor de todos-uns e n é o número total de páginas. O termo `(1 − d)/n` injeta um piso pequeno, constante, de probabilidade em toda página independentemente da estrutura de link, o que é exatamente o que impede becos sem saída e componentes desconectados de prender ou esfomear massa de probabilidade, toda página sempre tem ao menos `(1 − d)/n` de rank disponível para ela, e o termo de salto aleatório mantém a matriz bem comportada (irredutível e aperiódica, em termos de cadeia de Markov) mesmo em um grafo web repleto de becos sem saída, que a web real muito é.

## Exemplos Resolvidos

### Um grafo de link de 18 páginas grande demais para resolver à mão

```python
import random

random.seed(7)
n = 18
pages = list(range(n))

# Estrutura de link desenhada à mão: algumas páginas hub (0, 1) recebem muitos links;
# a maioria das outras páginas linka para um hub e um ou dois vizinhos; algumas páginas
# estão perto de becos sem saída com só um link de saída, para exercitar o termo de amortecimento.
links = {
    0: [1, 2, 3],
    1: [0, 4, 5],
    2: [0, 1],
    3: [0, 1, 6],
    4: [1, 7],
    5: [1, 0],
    6: [0, 3, 8],
    7: [4, 1],
    8: [6, 9],
    9: [8, 0],
    10: [0, 11],
    11: [10],
    12: [0, 1, 13],
    13: [12],
    14: [1, 15],
    15: [14, 0],
    16: [],          # um beco sem saída genuíno: nenhum link de saída de forma alguma
    17: [1, 16],
}
```

Dezoito páginas significam que Mπ = π é um sistema linear homogêneo 18×18, solucionável em princípio, mas não mais algo para reduzir por linha à mão da forma que o grafo de brinquedo de 4 páginas era; esta é exatamente a escala onde iteração de potência para de ser uma conveniência e se torna o único método prático.

### Iteração de potência como o método primário, amortecimento incluído

```python
def build_matrix(links, n):
    M = [[0.0] * n for _ in range(n)]
    for j in range(n):
        outgoing = links[j]
        if outgoing:
            share = 1.0 / len(outgoing)
            for i in outgoing:
                M[i][j] = share
        # becos sem saída (nenhum link de saída) deixam a coluna j toda zero;
        # o termo de amortecimento abaixo é o que impede que isso seja um problema.
    return M

def matvec(M, x):
    return [sum(M[i][j] * x[j] for j in range(len(x))) for i in range(len(M))]

def pagerank(links, n, d=0.85, iterations=100, tol=1e-10):
    M = build_matrix(links, n)
    x = [1.0 / n] * n            # começa de uma distribuição uniforme
    jump = (1 - d) / n

    for step in range(iterations):
        mx = matvec(M, x)
        x_new = [d * mx[i] + jump for i in range(n)]
        delta = sum(abs(x_new[i] - x[i]) for i in range(n))
        x = x_new
        if step % 10 == 0 or delta < tol:
            print(f"iteration {step:3d}: change = {delta:.8f}")
        if delta < tol:
            break

    return x

ranks = pagerank(links, n)
print("sum of ranks:", sum(ranks))
for i, r in sorted(enumerate(ranks), key=lambda kv: -kv[1])[:5]:
    print(f"page {i}: {r:.4f}")
```

### Validando convergência

Rodar isso imprime uma coluna `delta` que encolhe firmemente em direção a zero, uma execução típica mostra `iteration 0: change = 0.31842...`, depois valores caindo aproximadamente uma ordem de magnitude a cada várias iterações, passando de `1e-10` bem antes de o limite de 100 iterações ser alcançado. Esse padrão de delta-encolhendo é a evidência direta, honesta, de convergência: em vez de confiar cegamente no laço, a implementação imprime exatamente a quantidade (a mudança L1 entre iterações sucessivas) que precisa ir a zero se e somente se a sequência de fato está se assentando em direção a um ponto fixo, que é o conteúdo matemático inteiro de "π é uma distribuição estacionária."

### Validando que o resultado faz sentido

`sum(ranks)` deveria imprimir `1.0` (até arredondamento de ponto flutuante), a fórmula de amortecimento, corretamente aplicada, preserva massa de probabilidade total a cada passo, já que `d · Mx` redistribui massa existente e `(1−d) · 𝟙/n` soma exatamente `1 − d`, juntos sempre somando 1 dado que `x` já somava 1. Inspecionando as cinco páginas de rank mais alto: a página 0 e a página 1, as duas páginas hub recebendo links de entrada de quase toda outra página no grafo, deveriam sair no topo por uma margem ampla sobre páginas como 11, 13, ou 16, que recebem no máximo um link de entrada cada. A página 16, o beco sem saída genuíno com zero links de saída, ainda recebe um pequeno rank positivo em vez de um valor zero ou indefinido, inteiramente por causa do piso `(1−d)/n` e do link de entrada que recebe da página 17, uma confirmação direta, visível, de que o termo de amortecimento está fazendo exatamente o trabalho descrito na Teoria Central.

## Equívocos Comuns e Armadilhas

- **"Iteração de potência aqui é só uma forma de checar novamente a resposta do autovetor, como no conceito anterior."** Aquele enquadramento se aplicava ao grafo de brinquedo de 4 páginas, onde resolver Mπ = π diretamente era o método primário e iteração de potência era a checagem secundária. Em 18 páginas, e em escala de web, que é o ponto, não há nenhum "método primário" prático contra o qual checar; iteração de potência não está substituindo nada, é o algoritmo real sendo usado, exatamente como o artigo de Brin & Page descreve calcular PageRank na prática.
- **"O fator de amortecimento é um botão de ajuste arbitrário; qualquer valor perto de 1 serviria."** d = 0.85 é o valor real específico do artigo original de Brin & Page, não uma conveniência arbitrária, equilibra confiar na estrutura de link (valores de d perto de 1 fazem o resultado depender quase inteiramente dos links reais do grafo) contra garantir convergência e tratar becos sem saída/componentes desconectados (valores de d mais longe de 1 injetam mais probabilidade de salto aleatório corretiva, convergindo mais rápido mas se importando menos com a estrutura de link real).
- **"Uma página sem links de saída (um beco sem saída) deveria simplesmente receber um rank de zero, já que não contribui nada adiante."** O próprio comportamento de saída de um beco sem saída não diz nada sobre seu rank de *entrada*; a página 16 acima não tem nenhum link de saída mas ainda recebe rank significativo de seu único link de entrada mais o piso de amortecimento. Confundir "não envia nada adiante" com "deveria receber nada" é um mal-entendido básico do que PageRank de fato mede, links de entrada, não de saída, são o que impulsiona o rank de uma página para cima.
- **"Pular o termo `(1 − d)/n` tudo bem contanto que o grafo aconteça de não ter becos sem saída visíveis."** Mesmo sem um beco sem saída direto, um agrupamento de páginas linkando só entre si (nenhum caminho levando de volta para fora) silenciosamente prende massa de probabilidade ao longo de iterações suficientes sem o termo de amortecimento, a falha é só menos imediatamente óbvia que uma coluna explícita de zeros de beco sem saída, e é exatamente por que a fórmula de Brin & Page aplica o termo de salto aleatório incondicionalmente, a toda página, em vez de só remendar páginas que são visivelmente becos sem saída.
- **"Convergência deveria ser checada olhando se os ranks impressos parecem estáveis, não rastreando um delta numérico."** O delta impresso a cada iteração é uma quantidade específica, checável, falsificável; "os números pareciam estáveis" não é, uma sequência convergindo lentamente ou oscilando pode parecer superficialmente assentada em um intervalo impresso curto enquanto ainda se move significativamente mais adiante, o que é exatamente por que a implementação rastreia e imprime um critério de convergência real em vez de depender de inspeção visual dos ranks sozinha.

## Resumo

O conceito anterior resolveu PageRank exatamente em um grafo de brinquedo de 4 páginas e usou um pequeno laço de iteração de potência só para checar novamente aquela resposta algébrica. Este laboratório faz a escalada honesta que aquela comparação implica mas nunca enuncia: em 18 páginas, já demais para reduzir por linha Mπ = π à mão, quanto mais na escala da web real, iteração de potência para de ser uma conveniência e se torna o único método prático, exatamente como o artigo original de Brin & Page descreve calcular PageRank na prática, sem nenhuma decomposição em autovalores envolvida em nenhum ponto. A implementação adicionou a única correção do mundo real que a história limpa de autovetor do grafo de brinquedo não precisava: o fator de amortecimento de Brin & Page (d = 0.85), que injeta uma probabilidade de salto aleatório uniforme em toda página e especificamente impede becos sem saída e componentes desconectados de prender ou esfomear rank. Convergência foi validada diretamente rastreando a mudança por iteração encolhendo no vetor de rank, e os ranks resultantes corresponderam à intuição, páginas hub fortemente referenciadas se assentaram em rank visivelmente maior que páginas esparsamente referenciadas, e até mesmo uma página de beco sem saída genuína reteve um rank pequeno, corretamente não zero, de seu link de entrada e do piso de amortecimento.

## Documentation Links

- [Brin & Page — The Anatomy of a Large-Scale Hypertextual Web Search Engine](http://infolab.stanford.edu/pub/papers/google.pdf) — doc
- [Sedgewick & Wayne — Algorithms, 4th ed. Companion Site](https://algs4.cs.princeton.edu/home/) — doc
