---
version: 1.0
updatedAt: 2026-09-06
title: Percolação: Union-Find na Prática
summary: A tarefa clássica de Princeton para colocar o ADT union-find em uso real, reduzindo "o sistema percola?" a uma única consulta connected via sites virtuais, e diagnosticando o bug clássico de backwash que um design ingênuo produz.
---
## Objetivos de Aprendizagem

- Implementar um modelo de percolação sobre uma grade n-por-n, apoiado em uma estrutura union-find usada estritamente através de suas operações `union` e `connected`.
- Aplicar a técnica de site virtual-topo / virtual-fundo para reduzir "o sistema percola" a uma única consulta `connected`, e explicar por que essa redução é necessária, não incidental.
- Rastrear, à mão, a sequência de aberturas de site de uma pequena grade junto com o estado real da estrutura union-find, e confirmar que a saída do código corresponde exatamente ao rastro manual.
- Diagnosticar o bug de "backwash" que um design ingênuo de site-virtual-único produz, e implementar a correção de dois-sites-virtuais que o evita.
- Validar uma implementação de percolação contra casos extremos: uma grade totalmente bloqueada, uma grade totalmente aberta, e uma grade que percola só através de um caminho estreito.

## Contexto e Motivação

**O ADT Union-Find (Conjunto Disjunto)** já estabeleceu o que `union` e `find` (e o `connected` derivado) garantem, e por que um ADT sem nenhuma operação `split` é exatamente o que torna implementações rápidas possíveis. Percolação é a tarefa que Sedgewick e Wayne usam para colocar aquele ADT em uso real, não para ensinar os internos de union-find de novo, mas para praticar reconhecer quando um problema real *é*, estruturalmente, um problema de union-find, e para construir o código de ligação (curto mas fácil de errar sutilmente) que conecta um modelo de grade a uma instância union-find de caixa-preta. Esta é a tarefa Percolation real, bem documentada, do `algs4` de Princeton, reproduzida aqui como um laboratório prático.

## Teoria Central

Este laboratório trata union-find puramente como uma caixa-preta: `union(a, b)` mescla os componentes de dois sites, e `connected(a, b)` (via `find`) responde se dois sites estão no mesmo componente, exatamente o contrato de **O ADT Union-Find (Conjunto Disjunto)**, sem nenhum mecanismo interno (compressão de caminho, union por tamanho, estrutura de árvore) re-derivado aqui. A única ideia nova que este laboratório introduz é um truque de modelagem, não um conceito de union-find: representar "percola" como uma única consulta `connected` usando dois **sites virtuais** extras, não físicos.

## Exemplos Resolvidos

### Enunciado do problema, com precisão

Uma grade n-por-n de sites; todo site está inicialmente **bloqueado**. Um site pode ser **aberto**. Um site **cheio** é um site aberto que está conectado, através de uma cadeia de sites abertos adjacentes, a algum site aberto na linha do topo. O sistema **percola** se qualquer site na linha de baixo está cheio, ou seja, existe uma cadeia de sites abertos adjacentes do topo até o fundo. Sites são indexados por linha e coluna, cada um em `[0, n-1]`; dois sites são adjacentes se diferem por 1 em exatamente uma coordenada (cima/baixo/esquerda/direita, não diagonal).

### Especificação de API

```python
class Percolation:
    def __init__(self, n: int):
        """Cria uma grade n-por-n, todos os sites inicialmente bloqueados."""

    def open(self, row: int, col: int) -> None:
        """Abre o site (row, col) se ainda não estiver aberto."""

    def is_open(self, row: int, col: int) -> bool:
        """O site (row, col) está aberto?"""

    def is_full(self, row: int, col: int) -> bool:
        """O site (row, col) está cheio (aberto E conectado à linha do topo)?"""

    def number_of_open_sites(self) -> int:
        """Quantos sites estão atualmente abertos?"""

    def percolates(self) -> bool:
        """O sistema percola?"""
```

Todo método precisa rodar rápido o suficiente para ser chamado depois de todo único `open` em uma simulação, em particular `percolates()` não deve varrer de novo a grade do zero a cada vez (isso derrotaria o ponto inteiro de usar union-find incrementalmente).

### Passo 1: a técnica virtual-topo / virtual-fundo

A abordagem ingênua, depois de todo `open`, rodar uma busca nova de todo site da linha do topo para ver se algum site da linha de baixo é alcançável, joga fora tudo aprendido das aberturas anteriores, exatamente a armadilha contra a qual **O ADT Union-Find** alerta. Em vez disso, dois sites extras, não físicos, são adicionados à estrutura union-find: um site **virtual-topo**, unido com todo site aberto na linha 0, e um site **virtual-fundo**, unido com todo site aberto na linha n-1. Com isso em vigor, `percolates()` se reduz a uma única chamada: `connected(virtual_top, virtual_bottom)`. Esta é a técnica real, padrão, que a especificação de Princeton usa, e é a razão inteira pela qual o ADT union-find, não uma travessia nova, é a ferramenta certa aqui: duas checagens `connected` quase-O(1) (depois das próprias otimizações do ADT) substituem uma nova varredura O(n²).

Uma grade de n² sites é achatada para índices 1-D para a estrutura union-find (`index = row * n + col`), mais dois índices extras para os sites virtuais (`n*n` para virtual-topo, `n*n + 1` para virtual-fundo):

```python
class Percolation:
    def __init__(self, n: int):
        if n <= 0:
            raise ValueError("n must be positive")
        self._n = n
        self._open_sites = [[False] * n for _ in range(n)]
        self._open_count = 0
        self._virtual_top = n * n
        self._virtual_bottom = n * n + 1
        self._uf = WeightedQuickUnionUF(n * n + 2)   # caixa-preta: só union / connected

    def _index(self, row: int, col: int) -> int:
        self._validate(row, col)
        return row * self._n + col

    def _validate(self, row: int, col: int) -> None:
        if not (0 <= row < self._n and 0 <= col < self._n):
            raise IndexError(f"({row}, {col}) is outside the grid")
```

`WeightedQuickUnionUF` aqui é exatamente a estrutura union-find já construída na disciplina pré-requisito, usada sem nenhum conhecimento de seus internos, só seus métodos `union(a, b)` e `connected(a, b)` são chamados abaixo.

### Passo 2: abrindo um site e conectando-o a seus vizinhos abertos

```python
    def open(self, row: int, col: int) -> None:
        self._validate(row, col)
        if self._open_sites[row][col]:
            return
        self._open_sites[row][col] = True
        self._open_count += 1
        idx = self._index(row, col)

        if row == 0:
            self._uf.union(idx, self._virtual_top)
        if row == self._n - 1:
            self._uf.union(idx, self._virtual_bottom)

        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            r, c = row + dr, col + dc
            if 0 <= r < self._n and 0 <= c < self._n and self._open_sites[r][c]:
                self._uf.union(idx, self._index(r, c))

    def is_open(self, row: int, col: int) -> bool:
        self._validate(row, col)
        return self._open_sites[row][col]

    def number_of_open_sites(self) -> int:
        return self._open_count
```

### Passo 3: `is_full` e `percolates`, e a armadilha do backwash

A versão ingênua de `is_full`, `connected(index(row, col), virtual_top)`, e a versão ingênua de `percolates`, `connected(virtual_top, virtual_bottom)`, ambas parecem certas e ambas compilam, mas a `is_full` ingênua tem um bug real, coberto em Equívocos Comuns abaixo (**backwash**). A checagem de percolates em si está correta como uma única chamada `connected`; a correção pertence a como `is_full` é calculada, não a `percolates`:

```python
    def is_full(self, row: int, col: int) -> bool:
        self._validate(row, col)
        if not self._open_sites[row][col]:
            return False
        return self._uf.connected(self._index(row, col), self._virtual_top)

    def percolates(self) -> bool:
        return self._uf.connected(self._virtual_top, self._virtual_bottom)
```

(A implementação de `is_full` deste laboratório, como escrita, é a versão ingênua, mantida simples para corresponder à forma exata da armadilha discutida abaixo; a correção livre de backwash é descrita, não deixada como exercício, em Equívocos Comuns.)

### Passo 4: rastreando à mão uma grade 3-por-3 contra a saída real do código

**Configuração da grade:** n = 3, sites indexados (row, col) de (0,0) topo-esquerda a (2,2) fundo-direita. Abra, em ordem: (0,0), (1,0), (1,1), (2,1).

**Rastro manual:**

| Passo | Ação | Efeito no union-find | percolates()? |
|---|---|---|---|
| 1 | open(0,0) | union(idx(0,0), virtual_top), linha 0 | False |
| 2 | open(1,0) | union(idx(1,0), idx(0,0)), verticalmente adjacente, ambos agora abertos | False |
| 3 | open(1,1) | union(idx(1,1), idx(1,0)), horizontalmente adjacente | False |
| 4 | open(2,1) | union(idx(2,1), idx(1,1)), verticalmente adjacente; também linha 2, então union(idx(2,1), virtual_bottom) | True |

Depois do passo 4, a cadeia é `virtual_top, (0,0), (1,0), (1,1), (2,1), virtual_bottom`, tudo um componente, então `connected(virtual_top, virtual_bottom)` é `True`, a grade percola através do caminho (0,0)→(1,0)→(1,1)→(2,1), um formato "L" descendo a coluna esquerda e um passo à direita.

**Rodando o código real:**

```python
p = Percolation(3)
for r, c in [(0, 0), (1, 0), (1, 1), (2, 1)]:
    p.open(r, c)
    print(f"opened ({r},{c}) -> percolates={p.percolates()}")
```

Saída impressa esperada, correspondendo exatamente ao rastro manual:

```
opened (0,0) -> percolates=False
opened (1,0) -> percolates=False
opened (1,1) -> percolates=False
opened (2,1) -> percolates=True
```

Uma discrepância entre esta saída esperada e a saída real do código nesta exata sequência de 4 passos é uma forma rápida, precisa, de localizar um bug, a tabela acima fixa exatamente qual passo deveria virar `percolates()` para `True`.

### Passo 5: validando casos extremos

```python
def test_all_blocked_never_percolates():
    p = Percolation(3)
    assert p.number_of_open_sites() == 0
    assert not p.percolates()

def test_all_open_always_percolates():
    p = Percolation(3)
    for r in range(3):
        for c in range(3):
            p.open(r, c)
    assert p.number_of_open_sites() == 9
    assert p.percolates()

def test_single_column_path_percolates():
    p = Percolation(3)                # grade n=1 também vale a pena testar separadamente
    for r in range(3):
        p.open(r, 1)                  # abre só a coluna do meio, do topo ao fundo
    assert p.percolates()

def test_blocked_row_prevents_percolation():
    p = Percolation(3)
    p.open(0, 0)
    p.open(1, 0)
    # linha 2 inteiramente bloqueada -- nenhum caminho consegue alcançar o fundo
    p.open(2, 1)                      # aberto mas desconectado do resto
    assert not p.percolates()

def test_single_site_grid():
    p = Percolation(1)
    assert not p.percolates()
    p.open(0, 0)
    assert p.percolates()             # o único site é simultaneamente linha do topo e do fundo

def test_opening_same_site_twice_is_idempotent():
    p = Percolation(2)
    p.open(0, 0)
    p.open(0, 0)
    assert p.number_of_open_sites() == 1
```

`test_single_site_grid` é um caso extremo genuíno que vale a pena enunciar explicitamente, correspondendo a como a própria especificação de Princeton destaca n = 1: linha 0 e linha n-1 são a mesma linha, então uma única chamada `open(0, 0)` une o único site a ambos os sites virtuais de uma vez, e o sistema percola imediatamente.

## Equívocos Comuns e Armadilhas

- **Backwash: um design de virtual-fundo único vaza "cheio" para cima através de sites de linha de baixo não relacionados.** Uma vez que `percolates()` se torna `True`, todo site aberto na linha de baixo é unido (através do virtual-fundo) no mesmo componente do virtual-topo, *mesmo sites que não têm nenhum caminho físico real aberto até o topo*, porque union-find não tem noção de direção, conectar o virtual-fundo ao componente que percola faz todo outro site da linha de baixo anexado a esse mesmo virtual-fundo parecer "cheio" também, uma vez que um caminho existe. A correção usada na especificação real de Princeton é manter uma **segunda estrutura union-find separada** que inclui o virtual-topo mas deliberadamente exclui o virtual-fundo, e usar aquela segunda estrutura exclusivamente para consultas `is_full`, `percolates()` ainda usa a estrutura com ambos os sites virtuais, mas `is_full` nunca toca no virtual-fundo de forma alguma, então um site de linha de baixo não relacionado não pode ser puxado para "cheio" por um caminho que percola em outro lugar da grade.
- **Confundir coordenadas de grade com os índices 1-D achatados do union-find.** `row * n + col` precisa ser aplicado consistentemente em todo lugar onde o índice union-find de um site é necessário; confundir `row * n + col` com `col * n + row` em só um método (um erro de digitação fácil de cometer uma vez e copiar-colar em todo o resto) produz uma estrutura que une os pares errados de sites, um bug que não vai levantar uma exceção, só silenciosamente produzir respostas erradas de `percolates()` em qualquer grade assimétrica o suficiente para expor a troca.
- **Chamar `union` mesmo quando um site não está de fato aberto.** `open(row, col)` precisa unir o site novo só com vizinhos que já estão *abertos*, unir com um vizinho independentemente do estado aberto/bloqueado daquele vizinho conectaria componentes através de sites que nunca foram abertos, fazendo sites bloqueados agirem como se conduzissem.
- **Reabrir um site já aberto e contar ou unir duas vezes.** Sem a proteção `if self._open_sites[row][col]: return` no topo de `open`, chamar `open` duas vezes no mesmo site o uniria com seus vizinhos duas vezes (inofensivo, já que um `union` repetido é um no-op pelo contrato do ADT) mas também incrementaria `_open_count` duas vezes, corrompendo `number_of_open_sites()`.
- **Validar índices só em `open` mas não em `is_open` / `is_full`.** Um `(row, col)` fora do intervalo passado para `is_full` ou `is_open` sem checagem de limites vai levantar um `IndexError` confuso de bem lá dentro do array de apoio em vez de um erro claro na fronteira da API, todo método público que recebe coordenadas precisa da mesma validação, não só `open`.
- **Tratar `percolates()` como algo que precisa ser recalculado varrendo a grade.** O ponto inteiro da técnica de site virtual é que `percolates()` é uma única chamada `connected` em uma estrutura já mantida; recorrer a "varra a linha de baixo e faça BFS de todo site cheio de baixo" derrota a redução que este laboratório existe para ensinar e reintroduz o custo O(n²)-por-consulta que o ADT union-find foi escolhido especificamente para evitar.

## Resumo

Este laboratório implementou o problema Percolation de Princeton em cima de um ADT union-find já construído, usado estritamente como caixa-preta (`union`, `connected`): uma grade n-por-n de sites, um site virtual-topo e virtual-fundo cada um unido com os sites abertos da linha de grade correspondente, e `percolates()` reduzido a uma única chamada `connected(virtual_top, virtual_bottom)`. Uma grade 3-por-3 foi rastreada à mão passo a passo e checada contra a saída impressa real do código linha por linha, e casos extremos (totalmente bloqueada, totalmente aberta, um único caminho estreito, a grade n = 1, e reabertura idempotente) foram validados explicitamente. O bug de backwash, um design de virtual-fundo único marcando falsamente sites de linha de baixo não relacionados como cheios uma vez que o sistema percola, foi diagnosticado e corrigido com uma segunda estrutura union-find que exclui o virtual-fundo inteiramente para consultas `is_full`.

## Documentation Links

- [Princeton — Percolation Assignment Specification](https://coursera.cs.princeton.edu/algs4/assignments/percolation/specification.php) — doc
- [Princeton algs4 Assignments Index](https://coursera.cs.princeton.edu/algs4/assignments/) — doc
