---
version: 1.0
updatedAt: 2026-08-18
title: "O Método Simplex: Resolvendo Programas Lineares por Pivoteamento"
description: "O método simplex tabular — transformando restrições de desigualdade num dicionário inicial via variáveis de folga/excesso/artificiais, lendo soluções diretamente de um tableau, e pivoteando via eliminação de Gauss-Jordan até o ótimo — retomando exatamente onde o concept irmão linear-programming-formulation-and-duality parou deliberadamente antes do algoritmo em si; também cobre formas não padrão (minimização, restrições >=/= via o método de duas fases) e as variantes dual-simplex/simplex generalizado construídas sobre a mesma maquinaria de tableau."
---
## Objetivo

Retomar exatamente onde o concept irmão `linear-programming-formulation-and-duality` deliberadamente para. Aquele concept cobre como formular um programa linear e como a dualidade permite *certificar* uma solução como ótima — mas ele explicitamente se recusa a ensinar o próprio algoritmo simplex, já que sua fonte (CLRS 4ª edição) descartou a mecânica de tableau de propósito. Este concept é esse algoritmo faltante: o **método simplex tabular** — transformando restrições de desigualdade num "dicionário" inicial com variáveis de folga, lendo uma solução diretamente de um tableau, escolhendo uma coluna e uma linha de pivô, e repetindo eliminação de Gauss-Jordan até que nenhuma melhora adicional seja possível. Também cobre o que fazer quando um problema não chega no formato amigável ao simplex (um objetivo de minimização, restrições `>=`, restrições de igualdade) e fecha com as duas variantes práticas construídas em cima da mesma maquinaria de tableau: o algoritmo dual-simplex e o procedimento de simplex generalizado que combina os dois.

## Casos de Uso

- Resolver programas lineares pequenos a médios inteiramente à mão, que é precisamente a razão de existir da forma tabular — ela organiza a mesma álgebra que um método baseado em "dicionário" faz, mas como uma grade fixa de números, muito menos propensa a erro para atualizar à mão do que reescrever equações a cada iteração.
- Entender, mecanicamente, o que um solver de LP quer dizer quando relata "inviável" ou "ilimitado" — inviável corresponde à Fase I do método de duas fases terminar com uma soma positiva de variável artificial, e ilimitado corresponde a uma coluna de pivô sem nenhuma entrada positiva contra a qual rodar o teste de razão.
- Reotimizar um LP que já foi resolvido uma vez, depois de uma pequena mudança — uma nova restrição, um lado direito apertado — sem reconstruir o tableau inteiro do zero. Esse é o verdadeiro nicho prático do algoritmo dual-simplex: ele parte de um tableau que ainda é ótimo mas não é mais viável (exatamente o formato que se obtém ao aparafusar mais uma restrição num tableau já ótimo) e restaura a viabilidade sem nunca abrir mão da otimalidade.
- Modelar problemas que naturalmente produzem restrições `>=` ou `=` — um requisito mínimo de nutriente numa mistura, uma restrição de quantidade exata de embarque — e precisar de uma forma principiada (o método de duas fases) de encontrar sequer um primeiro tableau viável de onde pivotear, já que a própria maquinaria do simplex só parte de um que é *obviamente* viável.

## Aprofundamento

### De equações para um tableau: o que a grade de fato guarda

A forma padrão do concept irmão é `maximizar c^T x sujeito a Ax <= b, x >= 0`. Para pivotear sobre isso, toda restrição `<=` primeiro se torna uma igualdade adicionando uma **variável de folga** não negativa: `a_i1 x_1 + ... + a_in x_n <= b_i` se torna `a_i1 x_1 + ... + a_in x_n + s_i = b_i`. A linha do objetivo é reescrita com tudo movido para um lado, `Z - c_1 x_1 - ... - c_n x_n = 0`, de forma que ler o sinal de um coeficiente responda diretamente "essa variável ainda pode melhorar o objetivo?" — um `c_j` positivo ainda é lucrativo, um zero-ou-negativo já está esgotado.

Cada linha do sistema resultante nomeia uma **variável básica** (inicialmente, as variáveis de folga, uma por restrição); toda outra variável é **não básica** e implicitamente mantida em `0`. Definir todas as variáveis não básicas como `0` e ler cada variável básica direto do lado direito de sua linha dá uma solução viável imediata — a solução "óbvia" — sem nenhuma aritmética necessária. Esse é o ponto inteiro do layout de tableau: viabilidade é lida diretamente, não resolvida.

```java
// Uma linha de um tableau simplex: qual variável básica essa linha representa atualmente,
// seus coeficientes em cada variável estrutural/de folga, e seu lado direito.
record TableauRow(String basicVariable, double[] coefficients, double rhs) { }

record Tableau(TableauRow objectiveRow, List<TableauRow> constraintRows, List<String> variableNames) {

    /** A solução "óbvia": toda variável não básica é 0, toda variável básica é o rhs de sua linha. */
    Map<String, Double> obviousSolution() {
        Map<String, Double> x = new LinkedHashMap<>();
        for (String name : variableNames()) x.put(name, 0.0);
        for (TableauRow row : constraintRows()) x.put(row.basicVariable(), row.rhs());
        return x;
    }

    /** Ótimo (maximização) assim que todo coeficiente da linha do objetivo é >= 0 -- nada mais a ganhar. */
    boolean isOptimal() {
        for (double c : objectiveRow().coefficients()) if (c < 0) return false;
        return true;
    }
}
```

### Um trace completo resolvido: max 5x1 + 2x2

Considere um pequeno programa linear com três restrições `<=`, já em forma padrão:

| | |
|---|---|
| maximizar | `Z = 5x1 + 2x2` |
| sujeito a | `x1 <= 3` |
| | `x2 <= 4` |
| | `x1 + 2x2 <= 9` |
| | `x1, x2 >= 0` |

Adicionando uma folga por restrição (`x3`, `x4`, `x5`) dá o sistema de igualdades `Z - 5x1 - 2x2 = 0`, `x1 + x3 = 3`, `x2 + x4 = 4`, `x1 + 2x2 + x5 = 9`, que se torna o tableau inicial:

| V.B. | Z | x1 | x2 | x3 | x4 | x5 | const. |
|---|---|---|---|---|---|---|---|
| Z | 1 | -5 | -2 | 0 | 0 | 0 | 0 |
| x3 | 0 | **1** | 0 | 1 | 0 | 0 | 3 |
| x4 | 0 | 0 | 1 | 0 | 1 | 0 | 4 |
| x5 | 0 | 1 | 2 | 0 | 0 | 1 | 9 |

A solução óbvia é `x1=0, x2=0, x3=3, x4=4, x5=9, Z=0` — viável, mas não ótima, já que a linha do objetivo ainda tem entradas negativas (`-5`, `-2`). Duas regras conduzem toda iteração a partir daqui:

- **Variável entrante (condição de otimalidade):** entre as variáveis não básicas com um coeficiente negativo na linha do objetivo, escolha uma para se tornar básica. A regra mais simples (e a que este trace usa) é *coeficiente mais negativo* — aqui, `x1` em `-5`.
- **Variável sainte (viabilidade / teste de razão):** entre as linhas com um coeficiente estritamente positivo na coluna entrante, escolha a linha com a menor razão de `const. / coeficiente` — o limite mais apertado de quanto a variável entrante pode crescer antes que alguma variável básica ficasse negativa. Aqui: `3/1 = 3` (linha `x3`), `4/0 = ∞` (linha `x4`, pulada — um coeficiente zero ou negativo nunca limita o crescimento), `9/1 = 9` (linha `x5`). O mínimo é `3`, então `x3` sai.

A célula onde a coluna entrante encontra a linha sainte (`x1`/`x3`, valor `1`) é o **elemento de pivô**. Pivotear significa: dividir a linha de pivô pelo elemento de pivô (aqui já `1`, sem mudança necessária), depois, para toda outra linha (incluindo a linha do objetivo), subtrair o coeficiente daquela linha na coluna de pivô multiplicado pela nova linha de pivô — a mesma eliminação de Gauss-Jordan usada para zerar uma coluna. Depois de pivotear:

| V.B. | Z | x1 | x2 | x3 | x4 | x5 | const. |
|---|---|---|---|---|---|---|---|
| Z | 1 | 0 | -2 | 5 | 0 | 0 | 15 |
| x1 | 0 | 1 | 0 | 1 | 0 | 0 | 3 |
| x4 | 0 | 0 | 1 | 0 | 1 | 0 | 4 |
| x5 | 0 | 0 | **2** | -1 | 0 | 1 | 6 |

Nova solução óbvia: `x1=3, x2=0, x4=4, x5=6, Z=15` — melhor, mas o coeficiente da linha do objetivo de `x2` ainda é negativo (`-2`), então um segundo pivô é necessário. Teste de razão na coluna `x2`: `4/1=4` (linha `x4`), `6/2=3` (linha `x5`) — `x5` sai, pivoteando em `2`:

| V.B. | Z | x1 | x2 | x3 | x4 | x5 | const. |
|---|---|---|---|---|---|---|---|
| Z | 1 | 0 | 0 | 4 | 0 | 1 | 21 |
| x1 | 0 | 1 | 0 | 1 | 0 | 0 | 3 |
| x4 | 0 | 0 | 0 | 1/2 | 1 | -1/2 | 1 |
| x2 | 0 | 0 | 1 | -1/2 | 0 | 1/2 | 3 |

Nenhum coeficiente negativo resta na linha do objetivo, então este tableau é ótimo: `x1=3, x2=3, x3=0, x4=1, x5=0, Z=21`. Toda "solução óbvia" intermediária — `(0,0)`, `(3,0)`, `(3,3)` — é um vértice da região viável, exatamente o comportamento de "caminhar de vértice a vértice vizinho" que o Deep Dive do concept irmão descreve sem mostrar; este é esse caminhar, feito concreto.

### A aritmética de pivoteamento, enunciada em geral

Para um pivô no elemento `a_sp` (linha `s`, coluna `p`, a variável `x_j` entrando com coeficiente de objetivo `c_j < 0`):

1. **Normalize a linha de pivô**: divida toda entrada da linha `s` por `a_sp`.
2. **Zere toda outra linha**, incluindo a linha do objetivo: `nova_linha_i = linha_antiga_i - (entrada da linha antiga na coluna p) * nova_linha_de_pivô`, para toda linha `i != s`.

Uma consequência vale a pena derivar diretamente: o valor do objetivo depois de um pivô é `Z' = Z - c_j * (b_s / a_sp)`. Como o teste de razão garante `b_s / a_sp > 0` (é uma razão de quantidades não negativas, por construção) e a variável entrante foi escolhida porque `c_j < 0`, `-c_j > 0`, então `Z' > Z` estritamente — **todo pivô melhora estritamente o objetivo** (fora da degenerescência, coberta abaixo), o que é exatamente por que o algoritmo nunca revisita um tableau que já produziu e é garantido terminar num problema não degenerado.

Duas condições de terminação delimitam toda execução: se todo coeficiente da linha do objetivo é `>= 0`, o tableau atual é ótimo, ponto final. Se em vez disso alguma coluna `j` tem um coeficiente negativo na linha do objetivo *e* toda entrada nessa coluna é `<= 0`, o teste de razão não tem nada para comparar — `x_j` pode crescer sem limite e `Z` também, então o problema é **ilimitado** e o algoritmo para, tendo provado isso, em vez de entrar em loop.

### Formas não padrão: chegando a um tableau inicial

Problemas reais raramente chegam como uma maximização com só restrições `<=`. Três transformações trazem eles para um formato sobre o qual o simplex pode pivotear:

- **Minimização**: use `min Z = max(-Z)` — negue os coeficientes do objetivo, resolva como uma maximização, depois negue o valor ótimo de volta. Nada nas restrições muda.
- **Restrições `>=`**: reescreva `a_1 x_1 + ... + a_n x_n >= b` como `a_1 x_1 + ... + a_n x_n - e + A = b`, introduzindo uma **variável de excesso** não negativa `e` (coeficiente `-1`, capturando o quanto a restrição está super-satisfeita) *e* uma **variável artificial** não negativa `A` (coeficiente `+1`). O excesso sozinho não consegue dar uma solução básica inicial viável — definir toda variável estrutural como `0` forçaria `e = -b < 0`, violando a não negatividade — então a variável artificial é o que de fato semeia a base.
- **Restrições `=`**: introduza só uma variável artificial `A` (nenhum excesso necessário, já que a igualdade já fixa a linha); mesmo propósito, um placeholder de variável básica de onde partir.

Ambos os dois últimos casos deixam variáveis artificiais sentadas na base sem nenhum motivo para estar na resposta *final*, que é o que o **método de duas fases** existe para limpar:

- **Fase I** substitui o objetivo real por `minimizar W = soma de toda variável artificial` (equivalentemente `maximizar -W`), e roda o simplex comum nesse problema auxiliar. Se terminar com `W* = 0`, toda variável artificial foi expulsa da base (ou fixada em `0`), o que devolve uma solução básica genuinamente viável para as restrições *originais*. Se terminar com `W* > 0` em vez disso, nenhuma combinação de variáveis artificiais consegue chegar a zero — o problema original não tem solução viável nenhuma, ponto final.
- **Fase II** descarta inteiramente as colunas de variável artificial, restaura a linha do objetivo real no lugar delas, e retoma o simplex comum a partir da base viável que a Fase I entregou.

**Exemplo resolvido** (da mesma fonte do trace acima): `max Z = 3x1 - 5x2` sujeito a `x1 <= 4`, `2x2 <= 12`, `3x1 + 2x2 >= 18`, `x1, x2 >= 0`. A terceira restrição precisa de um excesso `x5` e artificial `A1`: `3x1 + 2x2 - x5 + A1 = 18`. A Fase I minimiza `A1` (equivalentemente maximiza `-W`); depois de zerar o coeficiente da variável artificial fora da linha do objetivo (ele começa não nulo lá puramente porque `A1` é básica) e dois pivôs (entrando `x1`, depois `x2`), a Fase I termina em `x1=4, x2=3, x3=0, x4=6, x5=0, A1=0, W=0` — um ponto genuinamente viável, já que `A1` chegou a zero. A Fase II então descarta a coluna `A1`, restaura `Z - 3x1 + 5x2 = 0` como a linha do objetivo, rezera as colunas das variáveis básicas nela (`x1` e `x2` já são básicas desde a Fase I, então suas entradas na linha do objetivo precisam ser rezeradas antes de ler a otimalidade), e pivoteia mais uma vez até o verdadeiro ótimo: `x1=2, x2=6, x3=2, Z=-24`.

### Variantes construídas sobre o mesmo tableau: dual-simplex e simplex generalizado

O simplex comum mantém um tableau **viável** a cada passo (todo valor de variável básica é `>= 0`) e trabalha para alcançar a **otimalidade** (todo coeficiente da linha do objetivo `>= 0` numa maximização). O **algoritmo dual-simplex** roda esse pareamento ao contrário: começa a partir de um tableau que já é ótimo — a linha do objetivo já satisfaz a condição de sinal — mas *inviável*, significando que o lado direito de alguma variável básica é negativo. Essa situação surge naturalmente sempre que uma nova restrição é aparafusada num LP já resolvido (um caso comum em análise de sensibilidade, ou quando um método de programação inteira adiciona uma restrição de plano de corte a uma relaxação que já otimizou): a linha do objetivo do antigo tableau ótimo permanece intocada pela nova linha, então a otimalidade sobrevive, mas a nova linha pode facilmente fazer alguma variável básica antes tranquila ficar negativa.

A regra de pivoteamento do dual-simplex espelha a do simplex comum, com papéis invertidos: a variável **sainte** é escolhida primeiro — a variável básica com o lado direito mais negativo — e a variável **entrante** é qualquer variável não básica, entre as com coeficiente negativo naquela linha, que minimize a razão `|coeficiente da linha do objetivo| / |coeficiente daquela linha|`. O pivoteamento prossegue pela mesma eliminação de Gauss-Jordan de antes. Cada iteração restaura um pouco mais de viabilidade sem nunca sacrificar a condição de otimalidade, até que todo lado direito seja não negativo — ponto em que o tableau é viável e ótimo ao mesmo tempo, terminado. Seu verdadeiro ganho é evitar uma reresolução completa do zero: reusar um tableau já ótimo como ponto de partida é mais barato do que reconstruir uma base viável nova e pivotear tudo de volta para cima.

Quando um tableau inicial não é *nem* viável *nem* ótimo ao mesmo tempo — algum lado direito é negativo *e* algum coeficiente da linha do objetivo ainda viola a condição de otimalidade — nenhum dos dois algoritmos sozinho se aplica diretamente. O **procedimento de simplex generalizado** é simplesmente rodá-los em sequência: primeiro, iterações de dual-simplex para eliminar os lados direitos negativos (restaurando viabilidade enquanto mantém fixo o padrão de sinal da otimalidade), depois, uma vez que todo lado direito é não negativo, mudando para iterações de simplex comum para eliminar os coeficientes negativos restantes da linha do objetivo (restaurando otimalidade enquanto mantém a viabilidade). Não é um terceiro algoritmo com sua própria regra de pivoteamento — é uma decisão de agendamento (dual-simplex primeiro, depois simplex) construída inteiramente a partir das duas regras de pivoteamento já descritas.

## Trade-offs

- **Pior caso exponencial, excelente desempenho prático — a mesma divisão que o concept irmão sinaliza para algoritmos de LP em geral.** [George Dantzig](https://en.wikipedia.org/wiki/George_Dantzig) criou o simplex em 1947; em 1972 Klee e Minty construíram uma família explícita de LPs (o "cubo de Klee-Minty", um hipercubo `n`-dimensional distorcido) que força a regra de pivô de coeficiente-mais-negativo a passar por todos os `2^n` vértices antes de terminar — prova de que nenhum limite polinomial de pior caso pode valer para essa regra. Na prática, o simplex ainda assim costuma alcançar o ótimo num número de iterações mais próximo de linear no número de restrições, o que é por que ele, em vez de um método provadamente polinomial, permaneceu o solver padrão por décadas.
- **O custo por iteração é pequeno e mecânico; o número de iterações é o que é ilimitado.** Cada pivô é uma atualização completa de Gauss-Jordan de um tableau de `m` linhas sobre `N = n + m` colunas (`n` estruturais mais `m` de folga/excesso/artificiais) — `O(mN)` operações aritméticas, dominadas por zerar toda outra linha contra a nova linha de pivô. O número de tableaus *possíveis*, no entanto, é o número de formas de escolher `m` variáveis básicas entre `N`, `C(N, m)` — um coeficiente binomial que cresce combinatorialmente, de onde de fato vem o pior caso exponencial, não de nenhum pivô individual ser caro.
- **A degenerescência pode travar o progresso, e no pior caso ciclar para sempre.** Se o lado direito de uma variável básica já é `0`, um pivô pode deixar o valor do objetivo completamente inalterado (`Z' = Z` quando `b_s = 0` na fórmula acima) — uma iteração desperdiçada que não avança para um vértice genuinamente novo. Pivôs degenerados repetidos podem, em princípio, ciclar de volta a um tableau visitado antes e entrar em loop para sempre; a **regra de Bland** (sempre quebrar empates na escolha de variável entrante/sainte escolhendo a variável de menor índice) é uma correção bem conhecida que provadamente previne ciclagem, ao custo de geralmente ser mais lenta por problema do que uma heurística de desempate mais agressiva.
- **O método Big-M e o método de duas fases resolvem o mesmo problema de "sem tableau inicial viável óbvio" com modos de falha diferentes.** Uma formulação Big-M (penalizando variáveis artificiais no objetivo real por uma constante muito grande `M`, numa única passada) evita precisar de duas otimizações separadas, mas um `M` mal escolhido é uma pegadinha real: pequeno demais, e a penalidade não domina, deixando uma solução aparentemente inviável com uma variável artificial sobrando parecer atraente; grande demais, e a aritmética de ponto flutuante num solver real perde precisão comparando coeficientes verdadeiros minúsculos contra outros escalados por `M`. O método de duas fases evita inteiramente o problema de escolha da constante, ao custo de rodar o simplex duas vezes.
- **Sem passeio `viz` aqui.** Um tableau simplex é uma grade numérica cuja transformação significativa é aritmética (redução de linha de Gauss-Jordan), não uma mudança estrutural num token, árvore ou forma de grafo — nenhum dos modos `formula`/`moves`/`tree`/`graph`/`btree` deste motor se encaixa nisso, o mesmo raciocínio que os concepts irmãos `linear-programming-formulation-and-duality` e `knapsack-01-vs-fractional` já estabeleceram para conteúdo em forma de tableau e tabela. O trace resolvido acima é o equivalente em tableau das próprias tabelas markdown desses concepts.

## Documentation Links

- [Hamdy A. Taha — *Operations Research: An Introduction*, 8ª Edição (Pearson/Prentice Hall, 2007-2008)](https://www.pearson.com/en-us/subject-catalog/p/operations-research-an-introduction/P200000003221/9780137625727) — book
- [Simplex algorithm — Wikipedia](https://en.wikipedia.org/wiki/Simplex_algorithm) — doc
- [George Dantzig — Wikipedia](https://en.wikipedia.org/wiki/George_Dantzig) — doc
- [Bland's rule — Wikipedia](https://en.wikipedia.org/wiki/Bland%27s_rule) — doc
