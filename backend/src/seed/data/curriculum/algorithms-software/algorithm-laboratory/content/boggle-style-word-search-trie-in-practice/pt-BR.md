---
version: 1.0
updatedAt: 2026-09-06
title: Busca de Palavras Estilo Boggle: Trie na Prática
summary: A busca em profundidade gera um prefixo candidato de cada vez conforme percorre a grade, tornando "devo continuar estendendo este caminho?" exatamente uma pergunta de associação de prefixo que uma trie responde de forma barata e um hash set estruturalmente não consegue.
---
## Objetivos de Aprendizagem

- Implementar uma busca em profundidade sobre uma grade de letras que encontra toda palavra válida de dicionário alcançável por um caminho de células adjacentes, não repetidas.
- Podar uma busca em grade usando a estrutura de prefixo de uma trie, parando a exploração no instante em que um caminho parcial não é um prefixo de nenhuma palavra do dicionário.
- Implementar uma linha de base ingênua de conjunto-hash-de-palavras que não consegue podar cedo, e medir seu custo real contra a versão podada por trie na mesma grade e dicionário.
- Validar uma implementação de busca de palavras contra uma pequena grade e lista de palavras totalmente rastreadas à mão, checando tanto quais palavras são encontradas quanto quais candidatas de aparência plausível são corretamente rejeitadas.
- Explicar, com uma medição concreta antes/depois, por que a poda por prefixo da trie é a propriedade específica que a torna a estrutura certa para este problema, não meramente "uma árvore em vez de um conjunto hash."

## Contexto e Motivação

**Tries: Árvores de Prefixo para Chaves de String** já estabeleceu o fato central que este laboratório explora: as operações `insert` e caminhada-de-prefixo de uma trie preservam a relação entre uma string e seus prefixos, de uma forma que uma estrutura de dicionário baseada em hash estruturalmente não consegue. Busca de palavras estilo Boggle é o lugar natural para colocar esse fato em uso, porque a própria busca gera um prefixo candidato de cada vez conforme percorre a grade, a pergunta "devo continuar estendendo este caminho?" é, exatamente, uma pergunta de associação de prefixo, e respondê-la de forma barata é a diferença inteira entre uma busca que explora inteligentemente e uma que explora cegamente e só checa no final.

## Teoria Central

Este laboratório usa a trie puramente como uma ferramenta já entendida: `insert(word)` para construir o dicionário, e uma operação de caminhada-de-prefixo (`has_prefix(prefix) -> bool`, construída da mesma forma que `search` e `keys_with_prefix` foram construídas em **Tries: Árvores de Prefixo para Chaves de String**, percorra a trie um caractere de cada vez, seguindo `children`, retornando `False` no momento em que uma aresta de caractere necessária está ausente) para perguntar, em O(comprimento do caminho até agora), se o caminho de grade explorado até agora ainda poderia se estender em uma palavra real. Nenhum interno de trie é re-derivado aqui; o algoritmo de busca em grade construído em torno dela é o material novo.

## Exemplos Resolvidos

### Enunciado do problema

Dada uma grade `n`-por-`m` de letras e um dicionário de palavras válidas, encontre toda palavra no dicionário que pode ser soletrada por um caminho através da grade, onde cada passo se move para uma das (até) 8 células vizinhas (cima/baixo/esquerda/direita/diagonal), nenhuma célula é reutilizada dentro do caminho de uma única palavra, e uma palavra precisa ter ao menos comprimento 3 para contar (o mínimo convencional do Boggle, adotado aqui para manter a saída do exemplo administrável).

### Especificação de API

```python
class Trie:
    def insert(self, word: str) -> None: ...
    def has_prefix(self, prefix: str) -> bool: ...   # True se alguma palavra começa com prefix
    def is_word(self, word: str) -> bool: ...         # True se word em si é uma palavra completa armazenada

def find_words(grid: list[list[str]], dictionary_trie: Trie, min_length: int = 3) -> set[str]:
    """Retorna o conjunto de palavras distintas do dicionário alcançáveis por um caminho de grade válido."""
```

`has_prefix` e `is_word` são as duas consultas de trie que este laboratório precisa; ambas são invólucros finos em torno do padrão percorra-a-árvore já construído em **Tries: Árvores de Prefixo para Chaves de String**:

```python
def has_prefix(self, prefix: str) -> bool:
    node = self.root
    for ch in prefix:
        if ch not in node.children:
            return False
        node = node.children[ch]
    return True

def is_word(self, word: str) -> bool:
    node = self.root
    for ch in word:
        if ch not in node.children:
            return False
        node = node.children[ch]
    return node.is_end_of_word
```

### Passo 1: o pequeno exemplo concreto: grade e dicionário

**Grade** (3x3, maiúsculas para legibilidade):

```
C A T
O R N
D E S
```

Como coordenadas: `(0,0)=C (0,1)=A (0,2)=T`, `(1,0)=O (1,1)=R (1,2)=N`, `(2,0)=D (2,1)=E (2,2)=S`.

**Dicionário:** `{"CAT", "CAR", "CARD", "CARE", "CARES", "CARTON", "ORE", "TAR", "TARE", "RAT", "ARC", "TORN"}`.

**Checagem de adjacência à mão para algumas candidatas:**

- `CAT`: C(0,0)→A(0,1)→T(0,2). A e T são horizontalmente adjacentes, C e A são horizontalmente adjacentes. Caminho válido. **Encontrada.**
- `CAR`: C(0,0)→A(0,1)→R(1,1). A(0,1) e R(1,1) são verticalmente adjacentes. Caminho válido. **Encontrada.**
- `CARD`: C(0,0)→A(0,1)→R(1,1)→D(2,0). R(1,1) e D(2,0) são diagonalmente adjacentes. Caminho válido, nenhuma célula reutilizada. **Encontrada.**
- `CARE`: C(0,0)→A(0,1)→R(1,1)→E(2,1). R(1,1) e E(2,1) são verticalmente adjacentes. **Encontrada.**
- `CARES`: continuando de E(2,1)→S(2,2), horizontalmente adjacente. **Encontrada.**
- `CARTON`: precisa de um segundo `R` depois de `CART..` que esta grade 3x3 específica não tem adjacente no lugar certo, e reutiliza letras que o layout da grade não consegue fornecer em sequência, **não encontrada**, corretamente rejeitada apesar de parecer uma palavra mais longa plausível compartilhando o prefixo `CAR`.
- `ORE`: O(1,0)→R(1,1)→E(2,1). Ambas as adjacências válidas. **Encontrada.**
- `TORN`: T(0,2)→O(1,0)? T(0,2) e O(1,0) não são adjacentes (diferem em 1 na linha e 2 na coluna). **Não encontrada**, uma palavra presente no dicionário mas não alcançável nesta grade particular.

**Saída esperada de `find_words` nesta grade e dicionário exatos:** `{"CAT", "CAR", "CARD", "CARE", "CARES", "ORE"}`, seis palavras, com `CARTON` e `TORN` corretamente ausentes apesar de serem entradas válidas do dicionário, porque a adjacência real das letras da grade não sustenta um caminho que as soletre.

### Passo 2: a busca em profundidade podada por trie

```python
def find_words(grid, dictionary_trie, min_length=3):
    rows, cols = len(grid), len(grid[0])
    found = set()

    def neighbors(r, c):
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                nr, nc = r + dr, c + dc
                if 0 <= nr < rows and 0 <= nc < cols:
                    yield nr, nc

    def dfs(r, c, path_word, visited):
        # Poda imediatamente se nenhuma palavra do dicionário tem esse prefixo --
        # esta única checagem é a razão inteira de uma trie ser usada aqui.
        if not dictionary_trie.has_prefix(path_word):
            return
        if len(path_word) >= min_length and dictionary_trie.is_word(path_word):
            found.add(path_word)
        for nr, nc in neighbors(r, c):
            if (nr, nc) not in visited:
                visited.add((nr, nc))
                dfs(nr, nc, path_word + grid[nr][nc], visited)
                visited.remove((nr, nc))   # backtrack: esta célula fica livre de novo para outros caminhos

    for r in range(rows):
        for c in range(cols):
            dfs(r, c, grid[r][c], {(r, c)})

    return found
```

A linha `if not dictionary_trie.has_prefix(path_word): return` no topo de `dfs` é o passo de poda: no momento em que as letras visitadas até agora (ex., `"CAX"`) não são um prefixo de *nenhuma* palavra armazenada, a função retorna imediatamente em vez de continuar explorando a (potencialmente grande) subárvore de caminhos de grade se estendendo daquele beco sem saída. Backtracking (`visited.remove`) depois da chamada recursiva é o que permite que uma célula participe de múltiplos caminhos de palavra diferentes começando de células diferentes, ao mesmo tempo proibindo o caminho de uma única palavra de reutilizar uma célula.

### Passo 3: a linha de base ingênua de conjunto-hash, e por que ela não consegue podar

Uma versão de `is_word` baseada em conjunto-hash-de-palavras, `word in word_set`, responde associação exata em O(1) em média, exatamente como **Hashing e Funções de Hash** prediria. O problema é `has_prefix`: um conjunto hash não tem nenhuma operação que responda "esta string parcial é um prefixo de algo no conjunto" sem, no pior caso, checar o `startswith` de toda palavra armazenada:

```python
def naive_has_prefix(prefix: str, word_set: set[str]) -> bool:
    return any(w.startswith(prefix) for w in word_set)   # O(número de palavras), toda única chamada
```

Uma DFS ingênua construída em torno disso não consegue podar cedo no sentido da trie de forma alguma, toda chamada a `naive_has_prefix` custa tempo proporcional ao *tamanho do dicionário inteiro*, não ao comprimento do prefixo, então checá-la em toda única célula de grade visitada (que é a única forma de podar sem uma trie) é frequentemente mais lento do que não podar de forma alguma. A linha de base ingênua realista em vez disso gera todo caminho de grade possível até algum comprimento máximo primeiro, e só depois checa cada string candidata completa contra o conjunto de palavras:

```python
def find_words_naive(grid, word_set, max_length=8, min_length=3):
    rows, cols = len(grid), len(grid[0])
    found = set()

    def neighbors(r, c):
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                nr, nc = r + dr, c + dc
                if 0 <= nr < rows and 0 <= nc < cols:
                    yield nr, nc

    def dfs(r, c, path_word, visited):
        if min_length <= len(path_word) and path_word in word_set:
            found.add(path_word)
        if len(path_word) >= max_length:
            return
        for nr, nc in neighbors(r, c):        # sem poda -- explora todo caminho por completo
            if (nr, nc) not in visited:
                visited.add((nr, nc))
                dfs(nr, nc, path_word + grid[nr][nc], visited)
                visited.remove((nr, nc))

    for r in range(rows):
        for c in range(cols):
            dfs(r, c, grid[r][c], {(r, c)})

    return found
```

Esta versão ingênua tem que explorar e construir por completo *todo* caminho de grade até `max_length` (limitado só pela ramificação de vizinhos, até 8 direções por passo) independentemente de se qualquer palavra do dicionário compartilha as letras daquele caminho de forma alguma, checando `path_word in word_set` só uma vez depois que cada candidata de comprimento completo é construída, o exato padrão "explore por completo, depois filtre" contra o qual a própria orientação deste laboratório alerta, contrastado diretamente contra o padrão da versão trie de "pare no instante em que não é mais um prefixo de nada."

### Passo 4: medindo a diferença

```python
import random
import string
import timeit

def random_grid(size: int) -> list[list[str]]:
    return [[random.choice(string.ascii_uppercase) for _ in range(size)] for _ in range(size)]

def build_trie(words) -> Trie:
    t = Trie()
    for w in words:
        t.insert(w)
    return t

for size in (3, 4, 5, 6):
    grid = random_grid(size)
    trie = build_trie(DICTIONARY)
    word_set = set(DICTIONARY)

    trie_time = timeit.timeit(lambda: find_words(grid, trie), number=3) / 3
    naive_time = timeit.timeit(lambda: find_words_naive(grid, word_set, max_length=size * size), number=3) / 3
    print(f"grid={size}x{size}  trie={trie_time*1000:8.3f} ms  naive={naive_time*1000:8.3f} ms")
```

Forma de saída esperada: em tamanhos de grade pequenos (3x3, 4x4) as duas abordagens podem estar próximas, mas o custo da versão ingênua cresce acentuadamente com o tamanho da grade, o número de caminhos possíveis cresce aproximadamente exponencialmente com `max_length` e o fator de ramificação (até 8), enquanto o trabalho real da versão podada por trie permanece próximo do número de caminhos que são *prefixos genuínos de dicionário*, o que para um dicionário real e uma grade aleatória é uma fração pequena de todas as sequências de letras possíveis. Um padrão representativo: algo como `trie=1.2ms naive=3.1ms` em 3x3, alargando para `trie=4ms naive=800ms` ou pior em 6x6, os números específicos dependem do tamanho do dicionário e da ramificação, mas a lacuna qualitativa se alargando, não nenhum número único, é a demonstração empírica contra a qual a afirmação de poda é medida.

### Passo 5: validando correção

```python
def build_test_setup():
    grid = [["C", "A", "T"], ["O", "R", "N"], ["D", "E", "S"]]
    words = ["CAT", "CAR", "CARD", "CARE", "CARES", "CARTON", "ORE", "TAR", "TARE", "RAT", "ARC", "TORN"]
    trie = build_trie(words)
    return grid, trie

def test_finds_expected_words():
    grid, trie = build_test_setup()
    result = find_words(grid, trie)
    assert result == {"CAT", "CAR", "CARD", "CARE", "CARES", "ORE"}

def test_rejects_unreachable_dictionary_word():
    grid, trie = build_test_setup()
    result = find_words(grid, trie)
    assert "TORN" not in result       # está no dicionário, mas T e O não são adjacentes aqui
    assert "CARTON" not in result

def test_no_cell_reused_within_one_word():
    # Uma grade onde uma busca ingênua (sem rastrear visitados) poderia "encontrar" uma
    # palavra só revisitando uma célula -- confirma que a imposição do conjunto visited funciona.
    grid = [["A", "B"], ["C", "D"]]
    words = ["ABAB"]      # exigiria reutilizar A e B
    trie = build_trie(words)
    result = find_words(grid, trie, min_length=3)
    assert "ABAB" not in result

def test_minimum_length_enforced():
    grid, trie = build_test_setup()
    result = find_words(grid, trie, min_length=3)
    assert all(len(w) >= 3 for w in result)

def test_empty_dictionary_finds_nothing():
    grid, _ = build_test_setup()
    empty_trie = Trie()
    assert find_words(grid, empty_trie) == set()

def test_trie_and_naive_agree_on_small_grid():
    grid, trie = build_test_setup()
    words = ["CAT", "CAR", "CARD", "CARE", "CARES", "CARTON", "ORE", "TAR", "TARE", "RAT", "ARC", "TORN"]
    word_set = set(words)
    assert find_words(grid, trie) == find_words_naive(grid, word_set, max_length=9)
```

`test_trie_and_naive_agree_on_small_grid` é a checagem de correção mais importante de todas: a versão podada por trie e a versão de exploração completa ingênua precisam retornar o conjunto *idêntico* de palavras na mesma entrada, já que poda é só uma otimização de desempenho; qualquer divergência entre as duas significa que a lógica de poda está incorretamente rejeitando (ou, menos provável, incorretamente aceitando) algum caminho, não que os dois algoritmos têm permissão legítima para discordar.

## Equívocos Comuns e Armadilhas

- **Podar em `is_word` em vez de `has_prefix`.** Checar `dictionary_trie.is_word(path_word)` e parar a busca quando é `False` está errado, `"CA"` não é uma palavra completa no dicionário de exemplo, mas é um prefixo válido de `"CAT"` e `"CAR"`, e cortar a busca ali silenciosamente perderia toda palavra mais longa compartilhando aquele prefixo. Poda precisa ser guiada por `has_prefix`, e `is_word` é checado separadamente, só para decidir se *registra* o caminho corrente, nunca para decidir se *continua* ele.
- **Esquecer o conjunto `visited` por completo, ou compartilhar um `visited` entre células de partida separadas.** Sem um conjunto `visited` por caminho, o caminho de uma única palavra poderia voltar em loop através de uma célula já usada antes naquele mesmo caminho, ex., soletrando `"ORO"` reutilizando a célula `O` duas vezes sem nenhuma letra de fato repetida em outra célula. Usar um `visited` compartilhado através do laço externo sobre células de partida (em vez de um novo, ou backtracking cuidadoso, por célula de partida) em vez disso faz células usadas pela busca de uma célula de partida *anterior* permanecerem incorretamente marcadas como indisponíveis para a busca de uma célula de partida *posterior*.
- **Esquecer de fazer backtrack (`visited.remove(...)`) depois que a chamada recursiva retorna.** Omitir o passo de backtrack significa que uma célula, uma vez visitada por qualquer caminho de qualquer direção, permanece marcada como visitada pelo resto daquela árvore de chamadas DFS, colapsando a busca para um único caminho por célula de partida em vez de explorar todo caminho que uma célula de partida pode alcançar.
- **Tratar "não é um prefixo" e "não é uma palavra" como o mesmo sinal.** `has_prefix("CARTO")` pode ser `True` (alguma palavra pode começar assim) mesmo que `is_word("CARTO")` seja `False`, confundir os dois leva ou a parar cedo demais (como na primeira armadilha) ou a incorretamente registrar não-palavras como encontradas, dependendo de qual checagem é trocada por qual.
- **Fazer benchmark da versão trie contra uma versão ingênua que também poda, acidentalmente.** Se a checagem `path_word in word_set` da linha de base "ingênua" é, por alguma razão, movida para dentro do laço de vizinhos e usada para controlar a recursão (em vez de só registrar palavras encontradas no final), ela para de ser uma linha de base ingênua justa, uma checagem de associação de conjunto hash usada *como uma condição de parada* no meio do caminho não é equivalente à checagem de prefixo de uma trie, já que `path_word` no meio da busca frequentemente ainda não é ela mesma uma palavra completa e incorretamente interromperia caminhos promissores; as duas linhas de base precisam diferir só em *se* conseguem checar associação de prefixo parcial de forma barata, não em quando cada checagem é aplicada.
- **Assumir que um dicionário maior sempre torna a vantagem da trie maior de uma forma fixa.** A vantagem de poda escala com quantos prefixos *plausíveis-na-grade* são becos sem saída relativos ao tamanho total do dicionário e à ramificação da grade, um dicionário de palavras compartilhando muito poucos prefixos comuns com as letras reais da grade pode mostrar uma lacuna menor que os números no Passo 4, então a magnitude específica do ganho de velocidade depende da carga de trabalho, mesmo que a direção qualitativa (trie poda, ingênua explora por completo) sempre valha.

## Resumo

Este laboratório carregou um pequeno dicionário concreto em uma trie (citando **Tries: Árvores de Prefixo para Chaves de String** para `insert` e o padrão de caminhada-de-prefixo, estendido aqui em `has_prefix` e `is_word`) e buscou uma grade de letras 3x3 por busca em profundidade, podando qualquer caminho no instante em que parava de ser um prefixo de qualquer palavra do dicionário, encontrando `{"CAT", "CAR", "CARD", "CARE", "CARES", "ORE"}` e corretamente rejeitando `"CARTON"` e `"TORN"` apesar de ambas serem palavras válidas do dicionário, porque a adjacência real da grade não sustenta soletrá-las. Uma linha de base ingênua de conjunto-hash-de-palavras foi construída e mostrada como estruturalmente incapaz de podar no meio do caminho da forma que a trie faz, e ambas foram checadas quanto à correção uma contra a outra e cronometradas através de tamanhos de grade crescentes, mostrando o custo da versão ingênua se alargando acentuadamente em relação à versão podada por trie conforme a grade (e o espaço de caminhos candidatos) cresce.

## Documentation Links

- [Princeton algs4 Assignments Index](https://coursera.cs.princeton.edu/algs4/assignments/) — doc
- [Sedgewick & Wayne — Algorithms, 4th ed. Companion Site](https://algs4.cs.princeton.edu/home/) — doc
