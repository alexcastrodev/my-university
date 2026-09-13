---
version: 1.0
updatedAt: 2026-09-06
title: Tabela Hash do Zero
summary: Construa uma tabela hash real a partir de uma lista Python simples, force colisões de propósito, sobreviva a um redimensionamento sem perder dados, e meça, em vez de simplesmente confiar, se o lookup médio de fato fica O(1) conforme n cresce.
---
## Objetivos de Aprendizagem

- Implementar as operações `insert`, `lookup`, e `delete` de uma tabela hash do zero, apoiadas em uma lista Python simples, sem usar `dict` ou `set` internamente.
- Implementar encadeamento separado como a estratégia de resolução de colisão e disparar isso deliberadamente com uma sequência de chaves colidentes escolhida à mão.
- Implementar redimensionamento automático que faz o array de apoio crescer assim que o fator de carga cruza um limiar fixo, e verificar que toda chave existente permanece corretamente alcançável depois de um redimensionamento.
- Desenhar uma suíte de testes que checa correção em chaves comuns, em chaves deliberadamente colidentes, e nos casos extremos específicos em torno de deleção e redimensionamento.
- Fazer benchmark do tempo médio de lookup conforme o número de chaves armazenadas cresce, e checar empiricamente se a tendência medida é consistente com a afirmação de caso médio O(1) em vez de meramente afirmá-la.

## Contexto e Motivação

**Hashing e Funções de Hash** já fez o caso teórico para tabelas hash: uma boa função de hash mapeia chaves para índices de array de uma forma que é determinística, aproximadamente uniforme, e barata de computar, e colisões são uma certeza matemática uma vez que o espaço de chaves excede o tamanho da tabela, não um defeito a ser eliminado por engenharia. Conhecer aquele argumento não é o mesmo que saber que ele se sustenta, a única forma de descobrir se uma implementação de fato entrega lookup médio O(1), de fato resolve colisões corretamente, e de fato sobrevive a um redimensionamento sem perder dados, é construir uma, quebrá-la de propósito, e medi-la. Este laboratório faz exatamente isso: nenhuma teoria nova é introduzida aqui, só a disciplina de transformar a teoria já coberta em código funcional e depois interrogar aquele código com casos de teste concretos e um experimento de timing.

## Teoria Central

Este laboratório constrói diretamente sobre **Hashing e Funções de Hash**: o pipeline código-hash-depois-comprimir (`index = hash_code(key) % table_size`), as três propriedades de uma boa função de hash (determinística, uniforme, barata), e a inevitabilidade de colisões uma vez que o número de chaves possíveis excede o tamanho da tabela. Tratamento de colisão aqui usa **encadeamento separado**, já introduzido como uma estratégia de resolução padrão nos conceitos companheiros daquela disciplina: cada slot de array mantém não um único par chave-valor mas um pequeno balde (aqui, uma lista Python de pares) que pode conter mais de uma entrada quando múltiplas chaves caem no mesmo índice. Nada sobre funções de hash, uniformidade, ou o princípio da casa dos pombos é re-derivado abaixo, é usado como maquinaria assentada, já entendida.

## Exemplos Resolvidos

### Especificação de API

A implementação é uma única classe, `HashTable`, correspondendo a uma interface pequena, precisa, deliberadamente estreita, no espírito de uma especificação de tarefa estilo Princeton `algs4`, para que correção possa ser checada contra um contrato preciso em vez de uma descrição vaga:

- `HashTable(initial_capacity: int = 8)`, constrói uma tabela vazia com o número dado de baldes.
- `insert(key, value) -> None`, armazena `value` sob `key`. Se `key` já existe, seu valor é sobrescrito, não duplicado. Pode disparar um redimensionamento como efeito colateral.
- `lookup(key) -> Any`, retorna o valor armazenado sob `key`. Levanta `KeyError` se `key` não está presente (espelhando o próprio contrato de `dict` do Python, então o comportamento é fácil de raciocinar).
- `delete(key) -> None`, remove `key` e seu valor. Levanta `KeyError` se `key` não está presente.
- `__contains__(key) -> bool`, suporta `key in table`, retornando `False` em vez de levantar exceção quando ausente.
- `__len__() -> int`, retorna o número de chaves armazenadas (não o número de baldes).

Requisito de desempenho enunciado com precisão, espelhando como uma especificação de tarefa real o formularia: `insert`, `lookup`, e `delete` no caso médio precisam rodar em tempo O(1) em relação ao número de chaves armazenadas `n`, contanto que o fator de carga seja mantido limitado por redimensionamento, não O(1) em algum sentido informal, mas demonstravelmente plano quando o tempo médio de lookup é medido através de `n` crescente (o Passo 5 abaixo faz exatamente essa medição).

### Passo 1: o array de apoio e o pipeline hash/comprimir

O armazenamento de apoio é uma `list` Python simples de baldes, cada balde ele mesmo uma `list` Python simples de pares `(key, value)`, nenhum `dict` é usado em lugar nenhum da implementação:

```python
class HashTable:
    def __init__(self, initial_capacity: int = 8):
        self._capacity = initial_capacity
        self._buckets = [[] for _ in range(self._capacity)]
        self._size = 0  # número de chaves armazenadas, não número de baldes

    def _index_for(self, key) -> int:
        # A hash() embutida do Python reduzida mod tamanho da tabela é uma
        # abordagem legítima, padrão, para chaves hasheáveis arbitrárias
        # (veja Hashing e Funções de Hash: o pipeline código-hash-depois-
        # comprimir). A hash() do Python já satisfaz determinismo dentro
        # de uma única execução e uniformidade decente para tipos de
        # chave típicos.
        return hash(key) % self._capacity
```

Usar `hash()` aqui não é um atalho para contornar "escrever sua própria função de hash", é o estágio de código-hash do pipeline de dois estágios já coberto teoricamente; o próprio trabalho deste laboratório é o estágio de compressão, a estrutura de baldes, a política de redimensionamento, e as operações construídas em cima, todas escritas do zero abaixo.

### Passo 2: insert, com encadeamento separado

```python
    def insert(self, key, value) -> None:
        index = self._index_for(key)
        bucket = self._buckets[index]
        for i, (k, _) in enumerate(bucket):
            if k == key:
                bucket[i] = (key, value)   # sobrescreve, não duplica
                return
        bucket.append((key, value))
        self._size += 1
        if self._load_factor() > 0.75:
            self._resize(self._capacity * 2)

    def _load_factor(self) -> float:
        return self._size / self._capacity
```

Uma colisão é exatamente o caso onde `bucket` já tem uma ou mais entradas quando uma chave nova chega no mesmo índice; encadeamento separado a resolve varrendo a lista de balde (tipicamente muito curta) por uma chave correspondente antes de anexar, essa varredura é o custo inteiro de uma colisão, e permanece barata só porque uma boa função de hash mantém baldes curtos em média.

### Passo 3: lookup e delete

```python
    def lookup(self, key):
        index = self._index_for(key)
        for k, v in self._buckets[index]:
            if k == key:
                return v
        raise KeyError(key)

    def __contains__(self, key) -> bool:
        index = self._index_for(key)
        return any(k == key for k, _ in self._buckets[index])

    def delete(self, key) -> None:
        index = self._index_for(key)
        bucket = self._buckets[index]
        for i, (k, _) in enumerate(bucket):
            if k == key:
                del bucket[i]
                self._size -= 1
                return
        raise KeyError(key)

    def __len__(self) -> int:
        return self._size
```

### Passo 4: redimensionamento automático

Crescimento é disparado em `insert` uma vez que o fator de carga (`size / capacity`) excede `0.75`, o mesmo limiar que o próprio `HashMap` do Java usa por convenção. Redimensionar significa alocar um array de apoio maior e **re-hashear toda chave existente para dentro dele**, o índice de uma chave depende de `capacity`, então simplesmente copiar baldes antigos para um array maior literalmente deixaria a maioria das chaves inalcançáveis no índice que um `lookup` futuro calcularia:

```python
    def _resize(self, new_capacity: int) -> None:
        old_buckets = self._buckets
        self._capacity = new_capacity
        self._buckets = [[] for _ in range(self._capacity)]
        old_size = self._size
        self._size = 0
        for bucket in old_buckets:
            for key, value in bucket:
                self.insert(key, value)   # recalcula o índice de cada chave sob a nova capacidade
        assert self._size == old_size, "resize não deve perder ou duplicar nenhuma chave"
```

Reutilizar `insert` aqui (em vez de um append de baixo nível separado) é deliberado: garante que exatamente a mesma lógica de cálculo de índice e chave-duplicada se aplica uniformemente, seja uma chave chegando via inserção comum ou via um redimensionamento.

### Passo 5: validando correção com casos de teste concretos

Seguindo a convenção de tarefa Princeton `algs4` de enunciar saídas esperadas exatas em vez de comportamento vago, cada teste abaixo afirma um valor específico:

```python
def test_insert_then_lookup():
    t = HashTable()
    t.insert("apple", 1)
    t.insert("banana", 2)
    assert t.lookup("apple") == 1
    assert t.lookup("banana") == 2
    assert len(t) == 2

def test_overwrite_does_not_duplicate():
    t = HashTable()
    t.insert("apple", 1)
    t.insert("apple", 99)
    assert t.lookup("apple") == 99
    assert len(t) == 1          # ainda uma chave, não duas

def test_delete_then_lookup_raises():
    t = HashTable()
    t.insert("apple", 1)
    t.delete("apple")
    assert "apple" not in t
    try:
        t.lookup("apple")
        assert False, "esperava KeyError"
    except KeyError:
        pass

def test_missing_key_raises_and_contains_is_false():
    t = HashTable()
    assert "ghost" not in t
    try:
        t.lookup("ghost")
        assert False, "esperava KeyError"
    except KeyError:
        pass

def test_forced_collision_sequence_resolves_correctly():
    # Force uma colisão de propósito: uma tabela minúscula (capacidade 4) com
    # chaves escolhidas para que mais de uma mapeie para o mesmo índice sob
    # hash() % 4.
    t = HashTable(initial_capacity=4)
    keys = [f"key{i}" for i in range(20)]   # 20 chaves em 4 baldes garante repetições
    for i, k in enumerate(keys):
        t.insert(k, i)
    for i, k in enumerate(keys):
        assert t.lookup(k) == i             # toda chave ainda resolve para seu próprio valor
    assert len(t) == 20

def test_resize_preserves_every_key():
    t = HashTable(initial_capacity=4)
    for i in range(100):                    # força vários redimensionamentos além do fator de carga 0.75
        t.insert(i, i * i)
    for i in range(100):
        assert t.lookup(i) == i * i
    assert len(t) == 100

def test_delete_one_of_several_colliding_keys():
    t = HashTable(initial_capacity=4)
    keys = [f"key{i}" for i in range(10)]
    for i, k in enumerate(keys):
        t.insert(k, i)
    t.delete(keys[3])
    assert keys[3] not in t
    for i, k in enumerate(keys):             # as outras chaves colidentes não são afetadas
        if k != keys[3]:
            assert t.lookup(k) == i
```

`test_forced_collision_sequence_resolves_correctly` é o caso que especificamente estressa encadeamento separado: com só 4 baldes e 20 chaves, o princípio da casa dos pombos garante índices repetidos, então esse teste só passa se a varredura de balde distingue corretamente chaves que compartilham um índice. `test_resize_preserves_every_key` é o caso que especificamente estressa `_resize`: força o limiar de fator de carga a disparar múltiplas vezes e checa que nenhuma chave se torna inalcançável depois, a forma mais comum de uma tabela hash do zero silenciosamente perder dados.

### Passo 6: checando empiricamente a afirmação de lookup médio O(1)

Uma suíte de testes checa correção; ela não checa desempenho. A afirmação de que `lookup` custa O(1) em média, independente de `n`, é uma afirmação empírica sobre crescimento e precisa ser medida, não meramente confiada:

```python
import random
import string
import timeit

def random_key(length: int = 10) -> str:
    return "".join(random.choices(string.ascii_lowercase, k=length))

def measure_average_lookup_time(n: int, num_lookups: int = 2000) -> float:
    t = HashTable()
    keys = [random_key() for _ in range(n)]
    for i, k in enumerate(keys):
        t.insert(k, i)

    sample = random.sample(keys, min(num_lookups, n))
    start = timeit.default_timer()
    for k in sample:
        t.lookup(k)
    elapsed = timeit.default_timer() - start
    return elapsed / len(sample)   # segundos médios por lookup

for n in (1_000, 10_000, 100_000, 1_000_000):
    avg = measure_average_lookup_time(n)
    print(f"n={n:>9}  avg lookup = {avg * 1e6:8.3f} microseconds")
```

Forma de saída esperada: a coluna de tempo-médio-de-lookup deveria permanecer aproximadamente plana (dentro de um pequeno fator constante, considerando ruído de medição e sobrecarga do Python) conforme `n` cresce por três ordens de magnitude, por exemplo, algo como `0.4`, `0.4`, `0.5`, `0.5` microssegundos em vez de `0.4`, `4`, `40`, `400`. Uma tendência plana através de um crescimento de 1000x em `n` é a assinatura empírica de O(1); uma tendência que escala aproximadamente linearmente com `n` em vez disso significaria que a política de redimensionamento não está mantendo o fator de carga limitado, ou a função de hash está agrupando chaves em um pequeno número de baldes muito longos, de qualquer forma, uma descoberta real que o experimento de timing revela e que ler o código sozinho não revelaria.

## Equívocos Comuns e Armadilhas

- **Esquecer de re-hashear toda chave no redimensionamento, ou re-hashear para a capacidade errada.** Dobrar o comprimento do array e copiar baldes antigos para o array novo em seus índices *antigos* deixa quase toda chave inalcançável, porque `index = hash(key) % new_capacity` quase nunca é igual a `index = hash(key) % old_capacity`. A correção é o que o Passo 4 faz: recalcular o índice de toda chave sob a nova capacidade reinserindo-a, nunca copiando o conteúdo de balde posicionalmente.
- **Checar fator de carga antes da inserção em vez de depois.** Checar `_load_factor() > 0.75` antes de adicionar a entrada nova significa que a tabela sempre redimensiona uma inserção "atrasada" em relação ao seu próprio limiar declarado, e a última inserção que de fato empurra o fator de carga além do limiar nunca é seguida por um redimensionamento até a *próxima* chamada, um off-by-one sutil que só aparece sob um teste de timing em escala, não em testes de correção pequenos.
- **Usar `is` ou uma checagem de igualdade instável em vez de `==` ao varrer um balde.** Uma varredura de balde que compara chaves com `is` em vez de `==` vai falhar em encontrar uma chave que é igual em valor mas um objeto diferente (ex., duas strings construídas separadamente com os mesmos caracteres), `lookup` vai incorretamente levantar `KeyError` para uma chave que, de fato, foi inserida.
- **Não tratar o caso atualização-versus-duplicata em `insert`.** Anexar um par `(key, value)` a um balde sem primeiro checar se `key` já existe naquele balde silenciosamente cria entradas duplicadas para a mesma chave; `lookup` então retornará qualquer duplicata que aconteça de ser encontrada primeiro (geralmente a mais antiga), e `len()` vai contar demais, ambos fáceis de perder até que testes estilo `test_overwrite_does_not_duplicate` os capturem explicitamente.
- **Nunca encolher a tabela, e tratar isso como um bug de correção.** Crescer em um fator de carga alto mas nunca encolher em um baixo depois de muitas deleções não é incorreto, é uma escolha de design legítima, comum (uma tabela que nunca encolhe ainda é O(1) em média para lookup e insert), mas vale a pena enunciar explicitamente como uma decisão de design em vez de um descuido, já que algumas especificações de tarefa de fato exigem encolher-na-deleção e esta implementação intencionalmente não faz isso.
- **Assumir que o teste de timing sozinho prova que a implementação está correta.** Uma tabela hash que sempre retorna a primeira entrada do primeiro balde independentemente da chave ainda produziria uma curva de timing suspeitosamente plana (de fato, artificialmente rápida) enquanto está completamente errada, o experimento de timing no Passo 6 checa a afirmação de desempenho, não correção; só os casos de teste explícitos no Passo 5 checam correção. Ambos são necessários, e nenhum substitui o outro.

## Resumo

Este laboratório construiu uma `HashTable` a partir de uma lista Python simples de baldes: `hash(key) % capacity` para o estágio de compressão (citando isso como um uso legítimo do pipeline código-hash-depois-comprimir já coberto em Hashing e Funções de Hash), encadeamento separado para resolver colisões dentro de cada balde, e dobramento automático uma vez que o fator de carga cruza `0.75`, com toda chave existente re-hasheada sob a nova capacidade. Correção foi validada com casos de teste explícitos, insert/lookup comum, sobrescrita em vez de duplicação, delete-depois-lookup levantando `KeyError`, uma sequência de chave deliberadamente forçando colisão, e um caso de redimensionamento-preservando-toda-chave, e a afirmação teórica de lookup médio O(1) foi checada empiricamente cronometrando lookups através de `n` crescendo de 1.000 para 1.000.000 e confirmando que a média permaneceu aproximadamente plana em vez de crescer com `n`.

## Documentation Links

- [Sedgewick & Wayne: Algorithms, 4th ed. Companion Site](https://algs4.cs.princeton.edu/home/): doc
- [Princeton algs4 Assignments Index](https://coursera.cs.princeton.edu/algs4/assignments/): doc
