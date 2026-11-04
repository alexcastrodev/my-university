---
version: 1.0
updatedAt: 2026-11-04
title: "Itemsets Frequentes e o Algoritmo Apriori"
summary: "Itemsets e suporte, a propriedade antimonótona que poda a busca e a geração de candidatos por níveis do Apriori, com candidatos gerados, podados e contados em cada nível de um conjunto pequeno de transações, conferidos com força bruta e mlxtend."
---
## Objetivos de Aprendizagem

- Definir itemset, contagem de suporte, suporte relativo e a convenção do limiar, e converter entre as variantes usadas por livros e bibliotecas.
- Enunciar a propriedade antimonótona do suporte com sua hipótese, prová-la e mostrar uma medida em que ela falha.
- Executar à mão os passos de junção, poda e contagem do Apriori, informando os candidatos gerados, podados e contados em cada nível.
- Conferir uma execução com uma enumeração por força bruta e com `mlxtend`.
- Explicar o que a poda não consegue fazer e o que continua exponencial.

## Contexto e Motivação

O k-NN de `k-nearest-neighbors` precisava de rótulos. A mineração de itemsets frequentes não tem nenhum: nos termos de `the-supervised-unsupervised-and-reinforcement-taxonomy`, ela é não supervisionada, e aqui não há conjunto de treino, conjunto de teste nem acurácia. As execuções desta lição são exploratórias e descrevem um único conjunto de dados.

A pergunta é simples de enunciar: quais conjuntos de itens aparecem juntos em muitos registros? Os registros podem ser cestas, vagas de emprego ou documentos. Com $m$ itens distintos existem $2^m-1$ conjuntos candidatos não vazios, então contar todos logo deixa de ser possível. O Apriori, que Zaki e Meira creditam a Agrawal e Srikant (1994), se apoia numa observação que elimina a maioria deles sem precisar contá-los.

## Teoria Central

### Itens, transações e suporte

Seja $I$ um conjunto de itens e $D$ uma lista de $n$ transações, cada uma um subconjunto de $I$. Um **itemset** é um subconjunto $X\subseteq I$, e um $k$-itemset tem $k$ itens. Uma transação **contém** $X$ quando $X\subseteq t$.

$$\sigma(X)=\lvert\{t\in D: X\subseteq t\}\rvert,\qquad s(X)=\frac{\sigma(X)}{n}.$$

$\sigma$ é a **contagem de suporte** e $s$ é o **suporte relativo**. $X$ é **frequente** quando $\sigma(X)\ge\text{minsup}$.

Confira estas convenções antes de comparar números:

| Escolha | Nesta lição | Outros usos |
|---|---|---|
| Unidade do suporte | contagem $\sigma$ | Han, Pei e Yin usam contagens; `mlxtend` recebe a fração $s$ |
| Comparação | $\sigma(X)\ge\text{minsup}$ | Zaki e Meira, os slides de MMDS, Han, Pei e Yin, e o `mlxtend` usam "pelo menos"; o Exemplo 3 mostra o que um $>$ estrito muda |
| Valor do limiar | minsup $=3$ de $n=10$ | `min_support=0.3` em `mlxtend`, a mesma regra só porque $n=10$ |

### O conjunto de dados da lição

Estas 10 vagas de emprego inventadas listam habilidades com seis etiquetas: D (Docker), G (Go), J (Java), K (Kubernetes), P (Python), S (SQL). As duas próximas lições, `fp-growth` e `association-rules-support-confidence-lift`, usam estes mesmos dados.

| ID | Itens | ID | Itens |
|---|---|---|---|
| T1 | D G J K S | T6 | D K S |
| T2 | D J K P S | T7 | D P |
| T3 | D J K S | T8 | D S |
| T4 | D J P | T9 | J K P S |
| T5 | D K S | T10 | J K S |

Daqui em diante, `DKS` abrevia $\{D,K,S\}$ e minsup vale 3.

### Antimonotonicidade do suporte

**Propriedade.** Se $X\subseteq Y$, então $\sigma(Y)\le\sigma(X)$, com as duas contagens feitas sobre o mesmo $D$.

*Prova.* Toda transação que contém $Y$ também contém $X$, então o conjunto contado para $Y$ é subconjunto do conjunto contado para $X$. $\square$

A contrapositiva é a forma de trabalho: se $X$ é infrequente, todo superconjunto de $X$ é infrequente. Assim, os itemsets frequentes são fechados por subconjunto, e uma busca por níveis pode descartar um conjunto assim que faltar um de seus subconjuntos. A hipótese importa: a prova compara contagens de transações que contêm o conjunto sobre um único $D$, então não diz nada sobre uma pontuação definida de outro jeito, como mostra o Exemplo 4.

### Apriori

Mantenha os itens de cada itemset em ordem. Seja $L_k$ o conjunto dos $k$-itemsets frequentes e $C_k$ o dos candidatos.

1. Conte cada item e guarde $L_1$.
2. **Junção.** Para $k\ge2$, combine cada par de membros de $L_{k-1}$ que concordam nos primeiros $k-2$ itens. Cada candidato é gerado uma única vez, porque os dois últimos itens diferentes são tomados em ordem crescente.
3. **Poda.** Apague um candidato se algum de seus $(k-1)$-subconjuntos não estiver em $L_{k-1}$. Isso não usa os dados.
4. **Contagem.** Faça uma passada por $D$ e conte os candidatos restantes.
5. Guarde os que têm $\sigma\ge\text{minsup}$ como $L_k$. Repita até não haver o que gerar.

A junção e a poda nunca perdem um itemset frequente: todo subconjunto de um $k$-itemset frequente é frequente, então seus dois $(k-1)$-subconjuntos que compartilham os primeiros $k-2$ itens estão em $L_{k-1}$, ele é gerado, e nenhum teste de subconjunto pode removê-lo. Em $k=2$, a poda não consegue remover nada, porque os dois elementos de um par formado pela junção estão em $L_1$ por construção.

**Livro vs hoje.** Os slides de MMDS medem o custo do A-Priori em passadas: as cestas ficam em arquivos simples em disco, cada passada lê todas elas e a memória principal limita quantas contagens cabem. O `mlxtend` mantém uma matriz booleana em memória e conta um candidato combinando as colunas de seus itens. A lógica por níveis é a mesma, então diferem no custo, não no resultado.

### O que continua exponencial

A poda limita os candidatos em relação ao que é frequente, mas não consegue fazer a resposta ser pequena. Se uma transação com $m$ itens aparece minsup vezes, todos os seus $2^m-1$ subconjuntos não vazios são frequentes e qualquer algoritmo precisa devolvê-los. Os candidatos também crescem antes da saída: Han, Pei e Yin observam que $10^4$ itens frequentes forçam mais de $10^7$ pares candidatos, já que $\binom{10^4}{2}=49.995.000$. `fp-growth` ataca esse custo.

## Exemplos Resolvidos

### Exemplo 1: uma execução completa

**$k=1$.** Seis candidatos, todos contados:

```text
D 8   G 1   J 6   K 7   P 4   S 8
```

G fica abaixo de 3. $L_1=\{D,J,K,P,S\}$.

**$k=2$.** A junção dá todos os $\binom52=10$ pares e a poda não remove nenhum:

```text
DJ 4   DK 5   DP 3   DS 6   JK 5   JP 3   JS 5   KP 2   KS 7   PS 2
```

KP e PS ficam abaixo de 3, o que deixa 8 pares em $L_2$. Ter eliminado G antes economizou 5 pares aqui.

**$k=3$.** A junção sobre $L_2$ gera 9 candidatos:

```text
DJK  DJP  DJS  DKP  DKS  DPS  JKP  JKS  JPS
```

Quatro têm um subconjunto fora de $L_2$ e são podados sem tocar nos dados:

```text
pruned   missing subset
DKP      KP
DPS      PS
JKP      KP
JPS      PS
```

Os outros cinco são contados:

```text
DJK 3   DJP 2   DJS 3   DKS 5   JKS 5
```

DJP é o caso instrutivo. Seus três pares são frequentes, mas só T2 e T4 contêm os três itens. A poda é um teste necessário, não suficiente, e é por isso que a passada de contagem existe.

**$k=4$.** $L_3=\{DJK,DJS,DKS,JKS\}$. Só DJK e DJS compartilham os dois primeiros itens, o que dá `DJKS`. Seus quatro 3-subconjuntos estão em $L_3$, então nada é podado, e a contagem é 3 (T1, T2, T3).

**$k=5$.** $L_4$ tem um único membro, então a junção não tem par e a execução para sem quinta passada. A saída da execução instrumentada:

```text
k   generated  pruned  counted  frequent
1   6          0       6        5
2   10         0       10       8
3   9          4       5        4
4   1          0       1        1
    total counted: 22          total frequent: 18
```

### Exemplo 2: duas conferências independentes

Um laço de força bruta sobre os $2^6-1=63$ subconjuntos não vazios, contando cada um nas 10 transações, encontra 18 itemsets com as mesmas contagens. O `mlxtend` 0.25.0 também:

```python
import pandas as pd
from mlxtend.frequent_patterns import apriori
from mlxtend.preprocessing import TransactionEncoder

rows = [list(t) for t in ("DGJKS", "DJKPS", "DJKS", "DJP", "DKS",
                          "DKS", "DP", "DS", "JKPS", "JKS")]
te = TransactionEncoder()
df = pd.DataFrame(te.fit_transform(rows), columns=te.columns_)
apriori(df, min_support=0.3, use_colnames=True)
```

Os suportes, agrupados por tamanho:

```text
size 1: D 0.8, S 0.8, K 0.7, J 0.6, P 0.4
size 2: KS 0.7, DS 0.6, DK 0.5, JK 0.5, JS 0.5, DJ 0.4, DP 0.3, JP 0.3
size 3: DKS 0.5, JKS 0.5, DJK 0.3, DJS 0.3
size 4: DJKS 0.3
```

Os três resultados concordam nos 18 itemsets. O Apriori contou 22 candidatos e a força bruta contou 63, ambos na mesma unidade de um cálculo de suporte. Essas contagens não incluem o custo de gerar candidatos, e tempo decorrido é outra questão, tratada em `fp-growth`.

### Exemplo 3: como o limiar move o trabalho

Nos mesmos dados:

```text
minsup            1    2    3    4    5    6
frequent itemsets 47   25   18   13   11   6
candidates counted 48  28   22   20   14   12
```

A comparação estrita também importa. Usar $\sigma(X)>3$ no lugar de $\sigma(X)\ge3$ devolve 13 itemsets, o mesmo resultado de minsup $=4$. Em 10 transações, mudar o limiar em uma unidade pode remover 5 itemsets. Nenhum valor é certo por si só, porque minsup é uma escolha sobre o que olhar.

### Exemplo 4: uma medida que quebra a propriedade

Suponha que o objetivo sejam itemsets que cobrem muitas células da tabela. Defina a **área** $a(X)=\lvert X\rvert\cdot\sigma(X)$ e peça $a(X)\ge10$. Parece um limiar de suporte, mas o tamanho entra como fator:

```text
X       sigma(X)  area
D       8         8
DS      6         12
DKS     5         15
DJKS    3         12
```

A área sobe e depois desce nessa cadeia, então não é antimonótona nem monótona. Todo item isolado tem área de no máximo 8, então uma busca por níveis pararia em $k=1$ e não devolveria nada. A força bruta encontra 8 itemsets com área de pelo menos 10: DK, DS, JK, JS, KS, DKS, JKS, DJKS. A propriedade não se aplica, porque ela fala de $\sigma$ e $a$ é outra função: multiplica $\sigma$ por um tamanho que cresce com o conjunto. A poda do Apriori só vale para uma medida que não pode crescer quando o conjunto cresce.

## Equívocos Comuns e Armadilhas

- **"A poda decide o que é frequente."** Ela só remove conjuntos que não podem ser. DJP passou pela poda e reprovou na contagem.
- **"A poda atua em todo nível."** Em $k=2$ ela não consegue remover nada, como mostra o Exemplo 1.
- **"Qualquer medida de interesse pode usar o Apriori."** Só uma antimonótona. O Exemplo 4 perdeu as 8 respostas.
- **"`min_support=0.3` significa três transações."** Significa 30% de qualquer que seja $n$. Os dois só coincidem em $n=10$.
- **"Frequente significa relacionado."** O suporte conta coocorrência. S está em 8 de 10 vagas, então forma par com quase tudo. `association-rules-support-confidence-lift` mede isso, e os números das duas lições não são evidência de que uma habilidade cause outra.
- **"O Apriori torna o problema polinomial."** Ele remove candidatos, mas a saída ainda pode ter $2^m-1$ conjuntos.

## Resumo

O suporte de um itemset é o número de transações que o contêm, dado como contagem ou fração, e a comparação aqui é $\ge$, o que precisa ser declarado porque um $>$ estrito muda o resultado. O suporte é antimonótono porque um superconjunto está em menos transações, e isso deixa o Apriori gerar o nível $k$ a partir do nível $k-1$, podar candidatos com subconjunto faltante e contar só o resto, numa passada por nível. Nas 10 vagas, com minsup 3, ele contou 22 de 63 candidatos em quatro passadas e achou 18 itemsets frequentes, e a força bruta e o `mlxtend` acharam os mesmos 18. A poda não substituiu a contagem (DJP), e o método não se estende a uma medida como a área, em que a antimonotonicidade falha.

## Documentation Links

- [Han, Pei e Yin (2000), Mining Frequent Patterns without Candidate Generation](https://hanj.cs.illinois.edu/pdf/sigmod00.pdf): o custo da geração de candidatos, com os números citados acima.
- [Zaki e Meira, Data Mining and Machine Learning, capítulo 8](https://dataminingbook.info/book_html/chap8/book.html): mineração de itemsets, suporte, a geração de candidatos por prefixo do Apriori com poda por subconjuntos, e o crédito a Agrawal e Srikant (1994).
- [Mining of Massive Datasets, frequent itemsets](http://www.mmds.org/mmds/v2.1/ch06-assocrules.pdf): slides do curso sobre suporte, monotonicidade, as passadas do A-Priori e dados em disco.
- [mlxtend, apriori](https://rasbt.github.io/mlxtend/user_guide/frequent_patterns/apriori/): a função, o formato de entrada e `min_support`.
