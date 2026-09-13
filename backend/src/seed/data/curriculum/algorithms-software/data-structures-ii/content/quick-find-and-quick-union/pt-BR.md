---
version: 1.0
updatedAt: 2026-09-06
title: Quick-Find e Quick-Union
summary: Quick-find dá find O(1) mas union O(n) (relabel de array inteiro); quick-union dá union O(1) mas find O(n) (corrente degenerada); nenhuma implementação faz escolha deliberada de como combinar grupos, o que union por rank/size resolve.
---
## Objetivos de Aprendizagem

- Implementar quick-find, um union-find baseado em array onde `find` é O(1) e `union` rerotula um grupo inteiro.
- Implementar quick-union, uma floresta de ponteiros de pai onde `union` reponta uma única raiz e `find` sobe até uma raiz.
- Analisar o custo de pior caso de `union` sob quick-find e de `find` sob quick-union, e construir sequências de entrada concretas que disparam cada pior caso.
- Explicar por que nenhuma implementação ingênua é aceitável por si só para uma longa sequência de operações mistas.
- Comparar as trocas das duas abordagens com precisão suficiente para motivar as otimizações (union por rank/size, compressão de caminho) desenvolvidas nos conceitos que seguem.

## Contexto e Motivação

Tendo estabelecido o contrato de duas operações do TAD union-find no conceito anterior, a próxima pergunta natural é: qual é a implementação mais simples possível? O "Algorithms, Part I" de Sedgewick e Wayne em Princeton, o curso que abre com union-find precisamente para ensinar essa lição, deliberadamente apresenta duas primeiras tentativas "óbvias," quick-find e quick-union, antes de tocar em qualquer otimização, porque o retorno pedagógico de ver ambas falharem de formas complementares vale mais do que pular direto para a versão eficiente. Cada uma dessas duas abordagens ganha uma das duas operações essencialmente de graça, e paga caro pela outra; nenhuma delas é um padrão estritamente melhor, e entender exatamente *como* cada uma falha é o que faz os consertos subsequentes (union por rank e compressão de caminho) parecerem inevitáveis em vez de arbitrários.

Isso importa além de pedagogia. É um instinto genuinamente comum, ao implementar pela primeira vez qualquer interface de duas operações, otimizar a operação que parece mais "natural" de escrever rapidamente e deixar a outra como ela acabar, e union-find é um exemplo limpo e pequeno o suficiente para ver precisamente por que esse instinto, aplicado ingenuamente aqui, produz uma estrutura cujo comportamento de pior caso é inaceitável para qualquer carga de trabalho com muitas operações. Tanto quick-find quanto quick-union valem a pena implementar completamente, à mão, especificamente porque seus modos de falha são concretos e fáceis de construir, não meros gestos assintóticos, mas uma pequena sequência real de operações que visivelmente dá errado.

## Teoria Central

### Quick-find: um array de rótulos de grupo

Quick-find representa a partição com um único array `id`, onde `id[i]` é um rótulo para o grupo contendo o elemento `i`. Dois elementos `p` e `q` estão conectados exatamente quando `id[p] == id[q]`.

```python
class QuickFind:
    def __init__(self, n):
        self.id = list(range(n))  # cada elemento começa em seu próprio grupo, rotulado por si mesmo

    def find(self, p):
        return self.id[p]

    def connected(self, p, q):
        return self.find(p) == self.find(q)

    def union(self, p, q):
        pid, qid = self.id[p], self.id[q]
        if pid == qid:
            return
        for i in range(len(self.id)):
            if self.id[i] == pid:
                self.id[i] = qid
```

`find` é uma única busca de array, O(1), tão rápido quanto é possível para qualquer implementação ser. Mas `union` deve varrer o array *inteiro* e rerotular todo elemento atualmente compartilhando o rótulo antigo de `p`, o que custa O(n) no pior caso, não importa quão pequenos os dois grupos sendo fundidos de fato sejam.

**Modo de falha concreto.** Pegue n = 8 elementos, todos singletons, e execute `union(0,1)`, `union(0,2)`, `union(0,3)`, …, `union(0,6)`, repetidamente crescendo um grupo por um elemento de cada vez. Toda chamada `union` varre o array completo de 8 elementos procurando pelo rótulo antigo para rerotular, mesmo que apenas um elemento de fato esteja sendo adicionado ao grupo a cada vez. Ao longo de `n − 1` dessas uniões, o trabalho total é proporcional a `n + (n-1) + (n-2) + \dots \approx n^2/2`, custo quadrático total para o que é, em termos do número de *elementos* finalmente fundidos, uma quantidade linear de trabalho "real." Esta é a fraqueza central do quick-find: mesmo uma união que logicamente funde um grupo minúsculo em outro paga por uma varredura de array completa de qualquer forma.

### Quick-union: uma floresta de ponteiros de pai

Quick-union em vez disso representa cada grupo como uma árvore, usando um array `parent` onde `parent[i]` é o pai de `i`, ou `i` mesmo se `i` é uma raiz (o representante canônico do grupo). `find` sobe ponteiros de pai até alcançar uma raiz.

```python
class QuickUnion:
    def __init__(self, n):
        self.parent = list(range(n))  # cada elemento começa como sua própria raiz

    def find(self, p):
        while self.parent[p] != p:
            p = self.parent[p]
        return p

    def connected(self, p, q):
        return self.find(p) == self.find(q)

    def union(self, p, q):
        root_p, root_q = self.find(p), self.find(q)
        if root_p == root_q:
            return
        self.parent[root_p] = root_q  # anexa uma raiz sob a outra
```

`union` agora é rápida: uma vez que as duas raízes são encontradas, fundir é uma única escrita de ponteiro, `parent[root_p] = root_q`, O(1) além do custo das duas chamadas `find` que precisa para localizar as raízes. Mas `find` agora tem que subir potencialmente a altura inteira de uma árvore, e nada nessa versão ingênua controla essa altura.

**Modo de falha concreto.** Suponha que uniões cheguem nesta ordem, sempre anexando a raiz mais recentemente formada sob o elemento mais novo: `union(0,1)`, `union(1,2)`, `union(2,3)`, `union(3,4)`, `union(4,5)`. Se toda chamada `union(a, b)` acontece de tornar a raiz de `a` filha da raiz de `b` (um resultado plausível dependendo de qual argumento é tratado como "a árvore a anexar"), a estrutura resultante degenera em uma única corrente longa:

```mermaid
graph BT
    N0((0)) --> N1((1))
    N1 --> N2((2))
    N2 --> N3((3))
    N3 --> N4((4))
    N4 --> N5((5))
```

Agora `find(0)` deve subir 0 → 1 → 2 → 3 → 4 → 5, cinco saltos para alcançar a raiz, para uma árvore de apenas seis elementos. Em geral, uma corrente de comprimento n força `find` no elemento mais profundo a levar O(n) passos, não melhor, assintoticamente, que o `union` de pior caso do quick-find. O problema é inteiramente auto-infligido: nada no `union` ingênuo acima considera qual raiz é "melhor" para anexar sob qual, sempre anexa `root_p` sob `root_q`, independentemente de qual árvore é mais alta, então uma sequência adversarial ou até apenas azarada de chamadas union pode encadear todo elemento em um único caminho degenerado.

### Comparação lado a lado

| | Custo de `find` | Custo de `union` | Estrutura subjacente |
|---|---|---|---|
| Quick-find | O(1) | O(n) pior caso | array plano, `id[i]` = rótulo de grupo |
| Quick-union | O(n) pior caso (árvore degenerada) | O(1) além de duas chamadas `find` | floresta, `parent[i]` = pai ou si mesmo |

Nenhuma é aceitável como uma estrutura de propósito geral para uma longa sequência mista de chamadas `union` e `find`: quick-find garante buscas rápidas mas pode forçar toda única união a tocar o array inteiro; quick-union garante fusões rápidas mas pode silenciosamente construir uma árvore tão alta que toda busca subsequente rasteja por uma corrente quase linear. Ambas as fraquezas remontam à mesma causa raiz, nenhuma implementação exerce nenhum controle sobre *como* grupos são combinados; quick-find sempre faz uma varredura completa independentemente do tamanho do grupo, e quick-union sempre anexa uma raiz específica sob a outra independentemente da altura da árvore. O próximo conceito, union por rank e size, conserta exatamente isso fazendo essa escolha de anexação deliberadamente.

## Exemplos Resolvidos

### Exemplo 1 — o trabalho desperdiçado do quick-find, rastreado passo a passo

**Problema:** Com n = 5 e quick-find, rastreie `id` através de `union(0,1)`, `union(0,2)`, `union(0,3)`, `union(0,4)`, e conte quantas células de array são de fato inspecionadas no total (não apenas escritas).

**Rastreamento.** Início: `id = [0,1,2,3,4]`.

- `union(0,1)`: `id[0]=0`, `id[1]=1`. Varra todas as 5 células procurando pelo valor 0, rerotule para 1. `id = [1,1,2,3,4]`. Células inspecionadas: 5.
- `union(0,2)`: `find(0)=1` (seu rótulo atual), `find(2)=2`. Varra todas as 5 células pelo valor 1, rerotule para 2. `id = [2,2,2,3,4]`. Células inspecionadas: 5.
- `union(0,3)`: `find(0)=2`, `find(3)=3`. Varra todas as 5 células pelo valor 2, rerotule para 3. `id = [3,3,3,3,4]`. Células inspecionadas: 5.
- `union(0,4)`: `find(0)=3`, `find(4)=4`. Varra todas as 5 células pelo valor 3, rerotule para 4. `id = [4,4,4,4,4]`. Células inspecionadas: 5.

**Total:** 4 uniões × 5 células varridas cada = 20 inspeções de célula, para fundir 5 elementos em um grupo, um grupo que poderia, em princípio, ter sido construído com apenas 4 fatos de fusão "reais" registrados. Este é o padrão de explosão quadrática: toda união custa uma varredura O(n) completa independentemente de quanto o grupo de fato cresça.

### Exemplo 2 — quick-union construindo uma corrente ruim, depois pagando por ela

**Problema:** Com n = 6 e quick-union (sempre anexando a raiz de `find(p)` sob a raiz de `find(q)`, pelo código de `union(p, q)` acima), rastreie `parent` através de `union(0,1)`, `union(1,2)`, `union(2,3)`, `union(3,4)`, `union(4,5)`, depois calcule o custo (número de saltos de ponteiro) de `find(0)`.

**Rastreamento.** Início: `parent = [0,1,2,3,4,5]`.

- `union(0,1)`: raízes são 0 e 1. `parent[0] = 1`. `parent = [1,1,2,3,4,5]`.
- `union(1,2)`: `find(1)=1`, `find(2)=2`. `parent[1] = 2`. `parent = [1,2,2,3,4,5]`.
- `union(2,3)`: `find(2)=2`, `find(3)=3`. `parent[2] = 3`. `parent = [1,2,3,3,4,5]`.
- `union(3,4)`: `find(3)=3`, `find(4)=4`. `parent[3] = 4`. `parent = [1,2,3,4,4,5]`.
- `union(4,5)`: `find(4)=4`, `find(5)=5`. `parent[4] = 5`. `parent = [1,2,3,4,5,5]`.

`parent` final = `[1,2,3,4,5,5]`, uma corrente 0→1→2→3→4→5.

**Custo de `find(0)`:** 0 → 1 → 2 → 3 → 4 → 5, cinco saltos para alcançar a raiz (5, que aponta para si mesma). Para n = 6 elementos, isso é O(n) para um único `find`, exatamente o comportamento degenerado que o `union` ingênuo permite, porque sempre anexou a raiz do primeiro argumento sob a do segundo sem nunca verificar qual árvore era mais alta.

## Equívocos Comuns e Armadilhas

- **"Quick-union é apenas estritamente melhor que quick-find porque seu `union` é rápido."** O `union` do quick-union é rápido apenas no sentido de "O(1) além de localizar as raízes", mas localizar as raízes via `find` é exatamente o que pode degradar para O(n) em uma árvore ruim, então uma chamada `union` ainda paga esse custo `find` escondido duas vezes. Quick-union não domina quick-find; simplesmente realoca o pior caso de `union` para `find`.
- **"O modo de falha de degeneração em corrente exige um adversário; não vai acontecer com dados 'normais'."** Não exige nenhum adversário de forma alguma, apenas exige que uniões consistentemente anexem no mesmo padrão direcional, que é exatamente o que o código `union(p, q)` ingênuo acima faz toda única vez (sempre raiz de `p` sob raiz de `q`), não como um caso extremo raro mas como seu comportamento incondicional. Qualquer sequência de uniões que aconteça de encadear elementos em ordem crescente, como no Exemplo 2, dispara isso.
- **"O union O(n) do quick-find só importa para n muito grande."** O rótulo assintótico importa em qualquer escala onde muitas uniões ocorrem, o ponto do Exemplo 1 é que o *padrão* (varredura de array completa por união, independentemente de quão pequeno o grupo de fato sendo fundido seja) é desperdiçador mesmo para n pequeno; simplesmente se torna intolerável conforme n e o número de operações crescem, já que o custo total se acumula para aproximadamente O(n²) ao longo de n − 1 uniões.
- **"Você pode consertar a degeneração do quick-union apenas sendo 'cuidadoso' sobre a ordem de união em seu próprio código."** Em princípio um programador controlando toda chamada union poderia evitar ordenações ruins à mão, mas cargas de trabalho reais (fluxos arbitrários de eventos de conexão, ordenações de aresta arbitrárias no algoritmo de Kruskal) não oferecem esse controle, o conserto tem que viver dentro do próprio `union`, estruturalmente, que é exatamente o que union por rank/size (o próximo conceito) fornece.

## Resumo

Quick-find e quick-union são as duas primeiras tentativas ingênuas de implementar o TAD union-find, e cada uma torna uma operação essencialmente grátis ao custo de deixar a outra com um pior caso ruim. Quick-find armazena um rótulo de grupo por elemento em um array plano, dando `find` O(1) mas forçando `union` a potencialmente rerotular todo elemento, uma operação O(n) que se acumula para aproximadamente O(n²) de custo total ao longo de n − 1 uniões. Quick-union armazena ponteiros de pai formando uma floresta, dando fusões rápidas O(1) (além de localizar raízes) mas deixando `find` subir até uma raiz ao longo de um caminho cujo comprimento é inteiramente descontrolado, uma sequência ruim de uniões pode encadear n elementos em um único caminho, tornando um único `find` custar O(n). Nenhuma é aceitável para uma longa sequência de operações mistas, e ambas as falhas remontam à mesma causa: nenhuma implementação faz nenhuma escolha deliberada sobre *como* dois grupos são combinados. Essa lacuna é exatamente o que os próximos dois conceitos, union por rank/size e compressão de caminho, fecham.

## Documentation Links

- [Sedgewick & Wayne — Algorithms Lectures (Princeton)](https://algs4.cs.princeton.edu/lectures/) — doc
- [Stanford CS166 — Data Structures](https://web.stanford.edu/class/cs166) — doc
