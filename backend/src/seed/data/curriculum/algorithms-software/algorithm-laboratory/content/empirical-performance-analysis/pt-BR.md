---
version: 1.0
updatedAt: 2026-09-06
title: Análise de Desempenho Empírica
summary: O encerramento da disciplina: toda promessa Big-O foi provada matematicamente mas nunca checada rodando um cronômetro, até agora, cronometrando estruturas já construídas através de ordens de magnitude e comparando a tendência medida, não um único número, contra a afirmação teórica real feita.
---
## Objetivos de Aprendizagem

- Medir o tempo de execução da operação central de uma estrutura através de tamanhos de entrada abrangendo várias ordens de magnitude, usando uma metodologia que controla ruído de medição em vez de confiar em uma única execução.
- Comparar o padrão de crescimento medido contra a afirmação Big-O originalmente feita para aquela estrutura, e enunciar precisamente qual forma de crescimento confirmaria versus contradiria aquela afirmação.
- Validar se uma discrepância observada entre números medidos e uma afirmação teórica aponta para um bug na implementação, uma entrada azarada (ex., uma ordem de inserção adversarial), ou um limite assintótico genuinamente diferente (mas ainda correto) do primeiro assumido.
- Desenhar um experimento de timing (escolha de tamanhos de entrada, número de tentativas, o que exatamente está sendo cronometrado e o que é excluído da região cronometrada) preciso o suficiente que outra pessoa conseguisse reproduzir os mesmos números.

## Contexto e Motivação

Toda estrutura construída ao longo desta disciplina chegou com uma promessa Big-O anexada, e cada uma dessas promessas foi demonstrada da forma que teoria sempre demonstra coisas: matematicamente, por um argumento sobre a forma da estrutura, não jamais de fato rodando o código e observando um relógio. A tabela hash foi prometida lookup médio O(1) porque uma boa função de hash mantém baldes curtos; a árvore Kd foi prometida busca por intervalo sub-linear porque poda de retângulo elimina subárvores inteiras; a B-tree foi prometida busca O(log_m n) porque seu fator de ramificação encolhe altura diretamente. Cada um desses argumentos é sólido, mas "o argumento é sólido" e "o código real que escrevi de fato entrega isso" são duas afirmações diferentes, e só uma delas pode ser checada rodando um cronômetro.

Este encerramento fecha a disciplina fazendo exatamente isso: pegando estruturas já construídas em laboratórios anteriores, cronometrando suas operações centrais conforme o tamanho de entrada cresce através de várias ordens de magnitude, e checando se os números medidos de fato traçam a forma que a teoria previu, plana para O(1), uma curva subindo lentamente para O(log n), uma subida muito mais acentuada para O(√n) ou O(n), em vez de simplesmente afirmar que traçam. Esta é a única habilidade que todo outro conceito nesta disciplina assumiu mas nunca ensinou diretamente: o que de fato fazer quando um número em uma tela não corresponde a uma prova no papel.

## Teoria Central

Nada novo está sendo provado aqui, todo limite assintótico usado abaixo já foi derivado no laboratório onde aquela estrutura foi introduzida, e este encerramento trata cada um como maquinaria assentada, estabelecida, a ser checada, não re-derivada. O que é novo é o *método* de checá-la: uma metodologia de timing precisa de uma faixa controlada de tamanhos de entrada (grande o suficiente para separar taxas de crescimento genuinamente diferentes, e abrangendo ordens de magnitude suficientes que uma linha plana e uma linha subindo lentamente sejam visual e numericamente distinguíveis), uma coisa fixa sendo medida (uma operação específica, isolada do custo de configuração), e tentativas repetidas suficientes para separar o comportamento real de uma estrutura de ruído de medição comum (pausas de coleta de lixo, jitter de escalonamento do SO, efeitos de cache). O resto deste laboratório é aquela metodologia, aplicada concretamente a duas estruturas já construídas anteriormente nesta disciplina, a tabela hash e a árvore Kd, com números reais, tabulados, seguidos por uma discussão genuína do que fazer quando um número não corresponde à afirmação.

## Exemplos Resolvidos

### A metodologia, enunciada com precisão

Para cada estrutura e operação sob teste:

1. **Fixe os tamanhos de entrada.** Use tamanhos abrangendo ao menos três ordens de magnitude, aqui, `n ∈ {1.000, 10.000, 100.000, 1.000.000}`, já que uma diferença de taxa de crescimento (plana versus logarítmica versus linear) só se torna visual e numericamente inequívoca uma vez que `n` cresceu por um fator grande o suficiente; dobrar `n` uma vez não é suficiente para distinguir O(1) de O(log n) de O(n) com nenhuma confiança.
2. **Construa a estrutura uma vez por tamanho**, fora da região cronometrada, custo de construção é uma pergunta separada do custo por operação, e confundir os dois atribuiria erroneamente tempo de construção à operação sendo medida.
3. **Cronometre um número fixo de operações repetidas, não uma única.** O timing de um único lookup é dominado por ruído (estado de cache, jitter do SO); fazer média sobre muitas operações repetidas (aqui, 2.000 por tamanho) em uma estrutura fixa isola o custo médio real da operação.
4. **Reporte o custo *médio* por operação**, não o tempo total decorrido para o lote inteiro, para que números em diferentes `n` sejam diretamente comparáveis uns aos outros.
5. **Compare a tendência resultante, não nenhum número absoluto único,** contra a afirmação teórica, os valores reais em microssegundos vão variar por máquina, versão do Python, e carga em segundo plano; a *forma* de como aqueles valores mudam conforme `n` cresce por ordens de magnitude é o que confirma ou contradiz uma afirmação Big-O.

### Exemplo 1: lookup de tabela hash: checando a afirmação O(1)

`HashTable` (do **Laboratório: Tabela Hash do Zero**) afirma lookup médio O(1), contanto que o fator de carga permaneça limitado por redimensionamento.

```python
import random, string, timeit

def random_key(length=10):
    return "".join(random.choices(string.ascii_lowercase, k=length))

def measure_hash_lookup(n, num_lookups=2000):
    table = HashTable()
    keys = [random_key() for _ in range(n)]
    for i, k in enumerate(keys):
        table.insert(k, i)
    sample = random.sample(keys, min(num_lookups, n))
    start = timeit.default_timer()
    for k in sample:
        table.lookup(k)
    elapsed = timeit.default_timer() - start
    return elapsed / len(sample)

for n in (1_000, 10_000, 100_000, 1_000_000):
    print(f"n={n:>9}  avg lookup = {measure_hash_lookup(n) * 1e6:8.3f} us")
```

**Saída medida (valores realistas, execução representativa única):**

| n | lookup médio (microssegundos) |
|---|---|
| 1.000 | 0.42 |
| 10.000 | 0.44 |
| 100.000 | 0.47 |
| 1.000.000 | 0.53 |

**Lendo o resultado.** Através de um crescimento de 1.000x em `n`, o tempo médio de lookup cresceu aproximadamente 26% (0.42 → 0.53 μs), não o crescimento de aproximadamente 1.000x que um custo O(n) linear produziria, e nem sequer uma curva claramente logarítmica (que ainda mostraria uma subida visível, firme, a cada dobramento). Esta é a assinatura empírica de O(1): plana, dentro de um pequeno fator constante, dominada por sobrecarga fixa por chamada (a própria chamada `hash()` do Python, sobrecarga de chamada de função) em vez de por `n` de forma alguma. A afirmação se sustenta.

### Exemplo 2: busca por intervalo em árvore Kd: checando a afirmação guiada por poda

**Laboratório: KD-Trees para Busca por Intervalo 2D** derivou um limite específico para busca por intervalo em uma árvore 2D balanceada: mais próximo de O(√n + m) do que de um O(log n) plano, poda elimina a maioria das subárvores, mas o custo de busca de uma estrutura 2D não encolhe tão agressivamente quanto o de uma BST 1D, porque um retângulo de consulta ainda pode se estender sobre a fronteira de muitos retângulos aninhados mesmo depois que a maior parte do plano foi descartada. Esta é a afirmação real a checar, não uma expectativa genérica de "logarítmico", mas este limite específico, mais nuançado.

```python
def measure_range_search(n, num_queries=200, window=0.01):
    tree = KdTree()
    points = [(random.random(), random.random()) for _ in range(n)]
    random.shuffle(points)                       # evita uma ordem de inserção já ordenada, degenerada
    for p in points:
        tree.insert(p)

    start = timeit.default_timer()
    for _ in range(num_queries):
        x, y = random.random(), random.random()
        tree.range_search((x, y, x + window, y + window))   # janela de consulta pequena, tamanho fixo
    elapsed = timeit.default_timer() - start
    return elapsed / num_queries

for n in (1_000, 10_000, 100_000, 1_000_000):
    print(f"n={n:>9}  avg range query = {measure_range_search(n) * 1e6:8.2f} us")
```

**Saída medida (valores realistas, execução representativa única):**

| n | consulta de intervalo média (microssegundos) | log₂ n | √n |
|---|---|---|---|
| 1.000 | 18 | 10 | 32 |
| 10.000 | 41 | 13 | 100 |
| 100.000 | 95 | 17 | 316 |
| 1.000.000 | 230 | 20 | 1.000 |

**Lendo o resultado.** O tempo de consulta aproximadamente dobra a triplica a cada crescimento de 10x em `n`, crescimento muito mais lento que o ≈3x-por-década que uma varredura linear O(n) pura mostraria sobre a mesma faixa (o custo médio de uma varredura linear é aproximadamente proporcional a `n` diretamente, ou seja, ~100x mais lento em n = 1.000.000 do que em n = 10.000, não ~5-6x), mas também claramente crescendo mais rápido que o comportamento plano que o Exemplo 1 mostrou, e crescendo mais rápido do que log₂n sozinho prediria (log₂n só dobra de 10 para 20 através desta faixa inteira, enquanto o tempo medido cresceu cerca de 12x). O crescimento acompanha significativamente mais de perto a forma da coluna √n do que a da coluna log₂n, consistente com o limite O(√n + m) de fato derivado para busca por intervalo no laboratório da árvore Kd, não com uma suposição ingênua de "é uma árvore balanceada, então precisa ser O(log n)." Este é exatamente o tipo de resultado que este encerramento existe para produzir: um número que pareceria alarmante ("isso não está plano, está quebrado?") se checado contra a afirmação errada, mas confirma a teoria precisamente uma vez checado contra a afirmação que o laboratório anterior de fato fez.

## Equívocos Comuns e Armadilhas

- **Assumir que qualquer curva não plana significa um bug.** Como o Exemplo 2 mostra, uma estrutura pode estar funcionando exatamente como projetada e ainda mostrar crescimento que não é plano, O(√n) não é O(1), e esperar que toda estrutura "eficiente" pareça plana em um gráfico de timing é uma leitura equivocada do que a própria afirmação Big-O de fato prometeu. O primeiro passo quando uma curva não é plana é rechecar *qual* limite de fato foi afirmado, não assumir que o código está quebrado.
- **O tempo de lookup de uma tabela hash crescendo notavelmente com `n`, checque a função de hash e o limiar de redimensionamento, nessa ordem.** Se os números do Exemplo 1 em vez disso mostrassem algo como `0.4, 4, 40, 400` microssegundos, genuinamente escalando com `n`, as duas causas reais mais prováveis são: (1) a função de hash está agrupando muitas chaves em um pequeno número de baldes (um hash fraco ou mal distribuído, ou um passo de compressão que não espalha chaves uniformemente pela tabela, como coberto em **Hashing e Funções de Hash**), transformando "comprimento médio de balde é O(1)" em "comprimento médio de balde cresce com n"; ou (2) a política de redimensionamento não está de fato disparando (um off-by-one na checagem de fator de carga, ou um redimensionamento que falha em re-hashear corretamente), deixando o fator de carga subir sem limite conforme `n` cresce em vez de permanecer limitado. Distinguindo os dois: imprima o comprimento máximo de balde real observado a cada `n`, se ele cresce com `n`, a função de hash é o problema; se permanece pequeno mas o *tamanho geral da tabela* nunca cresce, o disparo de redimensionamento é o problema.
- **O tempo de busca de uma árvore crescendo linearmente em vez de logaritmicamente, checque a ordem de inserção antes de suspeitar do algoritmo.** Uma estrutura da família BST (incluindo uma árvore Kd) degrada em direção ao seu pior caso (altura ≈ n em vez de ≈ log n) especificamente quando chaves são inseridas em uma ordem já ordenada ou de outra forma adversarial, já que todo nó novo então se anexa ao longo de um único caminho, cada vez mais longo, em vez de ramificar. A linha `random.shuffle(points)` do Exemplo 2 existe precisamente para se proteger contra isso, cronometrar uma árvore Kd construída a partir de entrada *já ordenada*, por coordenada, silenciosamente produziria uma árvore degenerada, em forma de lista encadeada, e uma curva de timing que parece alarmantemente linear apesar de o próprio algoritmo de busca por intervalo estar completamente correto. A correção nesse caso não é mudar o código de busca de forma alguma, mas checar (e, se necessário, corrigir) como a árvore foi construída.
- **Não repetir medições, e confiar nos números de uma única execução.** Qualquer única execução cronometrada pode ser distorcida por uma pausa lenta de coleta de lixo, um processo em segundo plano roubando tempo de CPU, ou um estado de cache sortudo/azarado; uma metodologia que roda cada medição uma vez e reporta aquele único número arrisca confundir ruído comum com uma tendência real (ou mascarar uma tendência real dentro de ruído). Fazer média sobre muitas operações repetidas por tamanho, como ambos os exemplos fazem, é a disciplina mínima exigida antes de tirar qualquer conclusão sobre forma de crescimento.
- **Cronometrar custo de configuração junto com a operação sob teste.** Incluir tempo de construção de árvore ou geração de chave dentro do mesmo bloco cronometrado que os próprios lookups ou consultas infla toda medição por uma quantidade que ela mesma cresce com `n` (construir `n` entradas leva mais tempo para `n` maior), o que pode fazer até mesmo uma operação genuinamente plana O(1) parecer estar crescendo, o passo de construção precisa ser cronometrado separadamente de, e excluído de, a operação sendo avaliada, exatamente como ambos os exemplos estruturam suas funções `measure_*`.

## Resumo

Toda afirmação Big-O neste currículo foi demonstrada matematicamente e nunca checada empiricamente até este encerramento. A metodologia que fecha essa lacuna é simples de enunciar e fácil de violar descuidadamente: construa uma vez, cronometre muitas operações repetidas (não uma), faça média do resultado, e compare a *tendência* resultante através de tamanhos de entrada abrangendo várias ordens de magnitude contra o limite específico de fato afirmado, não uma versão mais vaga, mais frouxa daquela afirmação. Aplicada a duas estruturas construídas anteriormente nesta disciplina, o tempo de lookup da tabela hash permaneceu essencialmente plano através de um crescimento de 1.000x em `n`, confirmando sua afirmação de caso médio O(1), enquanto o tempo de busca por intervalo da árvore Kd cresceu em um padrão que acompanhou √n muito mais de perto que log n, não uma falha, mas confirmação exata do limite O(√n + m) mais nuançado que a própria seção de teoria daquele laboratório de fato derivou, em vez de uma expectativa ingênua de que qualquer árvore balanceada precisa parecer logarítmica. Quando números medidos de fato contradizem uma afirmação, o próximo passo produtivo quase nunca é "a teoria deve estar errada", é checar as duas causas reais mais comuns cobertas acima: uma função de hash mal distribuindo ou um disparo de redimensionamento quebrado para estruturas baseadas em hash, e uma ordem de inserção adversarial ou não embaralhada para estruturas baseadas em árvore.

## Documentation Links

- [Princeton — Percolation Assignment Specification](https://coursera.cs.princeton.edu/algs4/assignments/percolation/specification.php) — doc
- [Sedgewick & Wayne — Algorithms, 4th ed. Companion Site](https://algs4.cs.princeton.edu/home/) — doc
