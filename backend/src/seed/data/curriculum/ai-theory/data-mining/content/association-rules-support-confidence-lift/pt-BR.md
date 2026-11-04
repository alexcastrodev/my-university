---
version: 1.0
updatedAt: 2026-11-04
title: "Regras de Associação: Suporte, Confiança, Lift"
summary: "De itemsets frequentes a regras: suporte, confiança e lift, por que lift é simétrico e confiança não, o caso exato em que a confiança é antimonótona, e por que confiança alta sozinha pode enganar."
---
## Objetivos de Aprendizagem

- Calcular suporte, confiança e lift de uma regra e citar as variantes dessas medidas em livros e bibliotecas.
- Provar que o lift é simétrico e a confiança não é, e mostrar as duas coisas em dados.
- Enunciar o caso exato em que a confiança é antimonótona e mostrar o que acontece fora dele.
- Gerar regras a partir de itemsets frequentes com poda por confiança e conferi-las com `mlxtend`.
- Mostrar uma regra de confiança alta com lift abaixo de 1, e um lift alto produzido por ruído.

## Contexto e Motivação

`frequent-itemsets-and-the-apriori-algorithm` e `fp-growth` produziram os mesmos 18 itemsets frequentes a partir de 10 vagas de emprego inventadas, com minsup 3. Um itemset diz que itens ocorrem juntos. Uma regra diz mais: entre os registros com $X$, com que frequência $Y$ aparece, e isso é mais do que $Y$ apareceria de qualquer forma? Esta lição usa os mesmos dados. A mineração é exploratória, sem divisão entre treino e teste, então uma regra descreve estas 10 linhas e nada além delas. Ela descreve coocorrência, e nenhuma regra aqui diz que uma habilidade leva a outra.

As contagens de itens isolados são D 8, S 8, K 7, J 6, P 4, G 1, com $n=10$.

## Teoria Central

### Definições

Uma regra $X\to Y$ tem $X$ e $Y$ não vazios e disjuntos. Com $\sigma$ a contagem de suporte, $s=\sigma/n$ e $XY$ como abreviação de $X\cup Y$:

$$\text{support}(X\to Y)=s(XY),\qquad \text{conf}(X\to Y)=\frac{\sigma(XY)}{\sigma(X)},\qquad \text{lift}(X\to Y)=\frac{\text{conf}(X\to Y)}{s(Y)}=\frac{s(XY)}{s(X)\,s(Y)}.$$

A confiança é a estimativa amostral de $P(Y\mid X)$. O lift a compara com a taxa de base $s(Y)$. Lift 1 significa $s(XY)=s(X)s(Y)$, o que a independência daria nesta amostra. Acima de 1, $X$ e $Y$ coocorrem mais que isso, e abaixo de 1, menos.

Os nomes variam, então compare fórmulas, não palavras:

| Nome | Fórmula | Onde |
|---|---|---|
| suporte de uma regra | $s(XY)$ | Zaki e Meira, a coluna `support` do `mlxtend` e esta lição |
| suporte de uma regra | $s(X)$, só o lado esquerdo | slides de Mining of Massive Datasets |
| interest | $\text{conf}(I\to j)-s(j)$, uma diferença (o exemplo resolvido dos slides informa o valor absoluto) | slides de Mining of Massive Datasets |
| lift | $\text{conf}/s(Y)$, uma razão | Zaki e Meira, `mlxtend` |
| leverage | $s(XY)-s(X)s(Y)$ | Zaki e Meira, `mlxtend` |

Para $D\to S$ abaixo, isso dá interest de $-0{,}05$, lift de $0{,}9375$ e leverage de $-0{,}04$. As três medidas põem a regra abaixo da taxa de base, em escalas diferentes.

### Simetria

Com o suporte tomado como $s(XY)$, suporte e lift não dependem da direção, porque $s(XY)$ e $s(X)s(Y)$ não mudam quando se trocam $X$ e $Y$. Por isso, o lift não pode dizer para que lado uma regra "aponta". A confiança depende da direção:

$$\frac{\text{conf}(X\to Y)}{\text{conf}(Y\to X)}=\frac{\sigma(Y)}{\sigma(X)}.$$

O lift também tem uma cota superior. Como $s(XY)\le\min(s(X),s(Y))$, vale $\text{lift}\le1/\max(s(X),s(Y))$. Um consequente com $s(Y)=0{,}8$ nunca passa de lift 1,25, então valores de lift de regras sobre itens de frequências diferentes não estão em pé de igualdade.

### Onde a confiança é antimonótona

O suporte é antimonótono sobre itemsets. A confiança não é, e não deve ser podada como se fosse. A propriedade que serve tem uma forma estreita.

**Propriedade.** Fixe um itemset $Z$ e tome conjuntos não vazios $X'\subset X\subset Z$. Então

$$\text{conf}(X'\to Z\setminus X')\le\text{conf}(X\to Z\setminus X).$$

*Prova.* As duas confianças têm numerador $\sigma(Z)$. Como $X'\subset X$, a antimonotonicidade do suporte dá $\sigma(X')\ge\sigma(X)$, então a primeira fração tem o denominador maior. $\square$

Em palavras: **mover itens do antecedente para o consequente, dentro de um único itemset fixo, não pode aumentar a confiança.** A hipótese é que $Z$ continue o mesmo, o que mantém o numerador fixo.

Sem ela, a conclusão se perde. Compare $X\to Y$ com $X\cup W\to Y$ para um $Y$ fixo: os itemsets diferem, numerador e denominador encolhem e a confiança pode ir para qualquer lado. O Exemplo 3 mostra as duas direções. (Aumentar só o consequente, com $X$ fixo, também não pode elevar a confiança, porque só o numerador encolhe. Isso é pura antimonotonicidade do suporte, compara regras de itemsets diferentes e não é o que poda a geração de regras dentro de $Z$.) Zaki e Meira também observam que o lift não é fechado para baixo.

### Gerando regras

Zaki e Meira e os slides de MMDS dividem o problema em dois: achar os itemsets frequentes e depois derivar regras. Para cada $Z$ frequente com $\lvert Z\rvert\ge2$, todo subconjunto próprio não vazio $X$ dá uma regra $X\to Z\setminus X$, então $Z$ tem $2^{\lvert Z\rvert}-2$ regras candidatas. Seu suporte já atende ao limiar, então só a confiança precisa de teste, e $\sigma(X)$ já está guardado, pois todo subconjunto de um itemset frequente é frequente. Nenhuma passada pelos dados é necessária.

A propriedade dá a poda, na forma usada pelo Algoritmo 8.6 de Zaki e Meira: tente primeiro os antecedentes grandes e, se $X\to Z\setminus X$ reprovar em minconf, pule todo antecedente $W\subset X$. O que isso economiza são consultas, não varreduras.

## Exemplos Resolvidos

### Exemplo 1: as regras dos dados da lição

Os 18 itemsets frequentes incluem 13 de tamanho pelo menos 2, a saber 8 pares, 4 trincas e DJKS, o que dá $8\cdot2+4\cdot6+14=54$ regras. Uma seleção, saída de um script:

```text
rule      s(XY)  s(X)  s(Y)  conf    lift
K -> S    0.7    0.7   0.8   1.000   1.250
S -> K    0.7    0.8   0.7   0.875   1.250
JS -> K   0.5    0.5   0.7   1.000   1.429
J -> K    0.5    0.6   0.7   0.833   1.190
P -> J    0.3    0.4   0.6   0.750   1.250
P -> D    0.3    0.4   0.8   0.750   0.938
D -> S    0.6    0.8   0.8   0.750   0.938
S -> D    0.6    0.8   0.8   0.750   0.938
DK -> J   0.3    0.5   0.6   0.600   1.000
D -> J    0.4    0.8   0.6   0.500   0.833
```

O `mlxtend` 0.25.0 dá as mesmas 54 regras, com confiança e lift iguais, a partir de `association_rules(frequent, metric="confidence", min_threshold=0.0, num_itemsets=10)` sobre a saída de `apriori` com `min_support=0.3`.

As duas primeiras linhas mostram a assimetria. $K\to S$ tem confiança 1, porque as 7 vagas com Kubernetes listam SQL, enquanto $S\to K$ tem $7/8$. A razão é $8/7=\sigma(S)/\sigma(K)$, e o lift é 1,25 nos dois sentidos. Esse 1,25 também é a cota para este consequente, pois $s(S)=0{,}8$.

### Exemplo 2: confiança alta, lift abaixo de 1

$D\to S$ parece forte: 75% das vagas com Docker listam SQL. Só que 80% de todas as vagas listam SQL. Então, entre as vagas com Docker, SQL é menos comum do que no total:

$$\text{lift}(D\to S)=\frac{0{,}75}{0{,}8}=0{,}9375.$$

A confiança sozinha manteria essa regra com qualquer minconf até 0,75. Um único antecedente mostra isso de forma ainda mais direta: $P\to J$ e $P\to D$ têm confiança 0,75, com lift 1,25 e 0,9375. A primeira fica acima de sua taxa de base de 0,6, e a segunda, abaixo de sua taxa de base de 0,8. Das 24 regras com confiança de pelo menos 0,7, 6 têm lift abaixo de 1.

Não perca de vista o tamanho da amostra. Com 10 linhas, isto é descrição, não achado. Até a regra perfeita $K\to S$ tem p-valor hipergeométrico unilateral de $8/120=0{,}067$ contra a independência com estas margens.

### Exemplo 3: a propriedade restrita, e fora dela

Dentro do itemset fixo $Z=$ DJKS, com $\sigma(Z)=3$, mover itens para a direita só pode baixar a confiança:

```text
rule        sigma(Z)/sigma(X)   conf
DJK -> S    3/3                 1.000
DJ  -> KS   3/4                 0.750
D   -> JKS  3/8                 0.375
```

Fora dele, tome o consequente fixo S e aumente o antecedente, de modo que $Z$ muda:

```text
rule      sigma(XY)/sigma(X)   conf    lift
D  -> S   6/8                  0.750   0.938
DK -> S   5/5                  1.000   1.250
DP -> S   1/3                  0.333   0.417
```

Acrescentar K eleva a confiança e acrescentar P a reduz, então reprovar em minconf em $D\to S$ não diz nada sobre $DK\to S$. O lift se move do mesmo jeito aqui e cruza 1 em $DK\to S$.

### Exemplo 4: a poda, contada

Gerando regras dos 13 itemsets, com os maiores antecedentes primeiro e pulando os subconjuntos de um antecedente reprovado:

```text
minconf  rules tested, no pruning   rules tested, pruned   rules kept
0.7      54                         39                     24
0.8      54                         35                     11
0.9      54                         34                     6
```

As regras mantidas são idênticas com e sem poda nos três limiares. A economia aqui é modesta, porque a maioria dos itemsets é pequena.

### Exemplo 5: quando o lift engana

**O lift depende de $n$.** Acrescente linhas que não contêm nenhuma dessas habilidades, como vagas de outras áreas. A confiança não muda, mas o lift escala com $n$:

```text
rows added   n     conf(D -> S)   lift(D -> S)   lift(K -> S)
0            10    0.75           0.9375         1.25
10           20    0.75           1.875          2.50
90           100   0.75           9.375          12.50
```

$D\to S$ passou de abaixo de 1 para cerca de 9 sem mudar nenhuma vaga que menciona essas habilidades. Assim, o lift é uma afirmação relativa a uma população escolhida, e essa população precisa ser declarada.

**Lift alto vindo de ruído.** Sorteie `X = rng.random((1000, 200)) < 0.02` com `rng = numpy.random.default_rng(0)`, de modo que cada item esteja presente de forma independente com probabilidade 0,02 e nenhum par tenha relação por construção. Espera-se um par em 0,4 transação. Dos 19.900 pares, 147 alcançam contagem de pelo menos 3, e seus lifts vão de 3,03 a 13,99, com mediana 6,07. Testando cada um com um teste hipergeométrico unilateral, 145 dos 147 ficam abaixo de $p=0{,}05$, e o menor é $1{,}1\times10^{-4}$. Nenhum sobrevive a uma correção de Bonferroni para todos os 19.900 pares, cujo limiar é $2{,}5\times10^{-6}$. A confiança deles é no máximo 0,31, então um piso de confiança também os removeria, mas os valores de lift sozinhos parecem descobertas. Um par plantado, os itens 0 e 1 acrescentados às linhas de `rng.choice(1000, 20, replace=False)` do mesmo gerador, alcança lift 18,4 com $p=8\times10^{-25}$ e passa pela mesma correção. Zaki e Meira também avisam que itemsets raros podem ter lift muito alto em conjuntos pequenos.

## Equívocos Comuns e Armadilhas

- **"Confiança alta significa associação forte."** $D\to S$ tem confiança 0,75 e lift abaixo de 1. Compare com a taxa de base.
- **"Lift alto significa padrão real."** Os 147 pares do Exemplo 5 vieram de itens independentes.
- **"O lift dá a direção."** Ele é simétrico. Só a confiança difere por direção, e essa diferença só reflete $\sigma(Y)/\sigma(X)$.
- **"A confiança é antimonótona como o suporte."** A propriedade de poda exige mover itens dentro de um único itemset fixo. $DK\to S$ supera $D\to S$.
- **"Regras dizem o porquê."** $K\to S$ informa que todas as vagas com Kubernetes desta tabela listam SQL. Não diz que uma coisa exige a outra, e um fator comum ou o modo como as linhas foram coletadas poderia produzir isso.
- **"O lift é uma propriedade dos dois itens."** Ele depende das linhas incluídas, como mostram as linhas acrescentadas.

## Resumo

Regras vêm de itemsets frequentes: o suporte de $X\to Y$ é $s(XY)$, a confiança é $\sigma(XY)/\sigma(X)$ e o lift é a confiança sobre $s(Y)$, com nomes que variam entre as fontes. Lift e suporte são simétricos, a confiança não é, e o lift tem cota em $1/\max(s(X),s(Y))$. A confiança não tem a antimonotonicidade do suporte: o caso que vale é mover itens do antecedente para o consequente dentro de um único itemset fixo, e é isso que permite podar as $2^{\lvert Z\rvert}-2$ regras de $Z$. Nas vagas, $D\to S$ tem confiança 0,75 e lift 0,9375, abaixo da taxa de base. O lift muda com $n$ e chegou a 13,99 com itens independentes, então uma regra precisa da taxa de base, da população e de alguma conferência contra o acaso. Uma regra descreve coocorrência nos dados minerados.

## Documentation Links

- [Zaki e Meira, Data Mining and Machine Learning, capítulo 8](https://dataminingbook.info/book_html/chap8/book.html): suporte e confiança de regras, a tarefa em dois passos, a geração de regras e a poda de antecedentes do Algoritmo 8.6.
- [Zaki e Meira, Data Mining and Machine Learning, capítulo 12](https://dataminingbook.info/book_html/chap12/book.html): confiança, lift, leverage e seus limites, incluindo testes de significância.
- [Mining of Massive Datasets, frequent itemsets](http://www.mmds.org/mmds/v2.1/ch06-assocrules.pdf): slides do curso com suporte de regra no lado esquerdo, os dois passos, interest como diferença e a observação sobre confiança na geração de regras.
- [mlxtend, association_rules](https://rasbt.github.io/mlxtend/user_guide/frequent_patterns/association_rules/): a função e as métricas que ela informa.
