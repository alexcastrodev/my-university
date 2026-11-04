---
version: 1.0
updatedAt: 2026-11-04
title: "Progressões Aritméticas e Geométricas"
summary: "Progressões aritméticas e geométricas, formas fechadas para os termos e para as somas finitas, o comportamento de r^n, e onde aparecem na computação: contagem de iterações de laços, o custo amortizado de um array dinâmico que dobra de tamanho e o crescimento composto."
---
## Objetivos de Aprendizagem

- Reconhecer uma progressão aritmética ou geométrica por uma diferença constante ou uma razão constante, e escrever o seu $n$-ésimo termo.
- Deduzir e usar as formas fechadas da soma dos $n$ primeiros termos de cada uma, incluindo o caso especial $r = 1$ e a contagem correta de termos.
- Decidir o comportamento de $r^n$ a longo prazo para toda razão real $r$, e ligá-lo à convergência de uma sequência.
- Traduzir laços em somas: laços aninhados dão somas aritméticas, divisão pela metade e dobramento dão somas geométricas.
- Usar uma soma geométrica para explicar o custo de um array que dobra de tamanho e do crescimento composto, e contrastá-los com os equivalentes aritméticos.

## Contexto e Motivação

Entre todas as sequências, duas famílias têm formas fechadas simples o bastante para serem tratadas exatamente e comuns o bastante para aparecer em quase toda análise de custo. Em uma **progressão aritmética**, cada termo difere do anterior por uma quantidade fixa $d$. Em uma **progressão geométrica**, cada termo é um múltiplo fixo $r$ do anterior. A primeira descreve crescimento linear, a segunda crescimento exponencial, e o contraste entre elas é o contraste entre um laço que faz um pouco mais de trabalho a cada passada e um processo que multiplica o próprio tamanho.

Na lição anterior, `sequences-and-convergence`, você viu o que significa uma sequência se estabilizar. Uma progressão é o lugar mais fácil para praticar essa definição, já que a resposta é conhecida em forma fechada. As somas de progressões também são o ponto em que a sequência $(a_n)$ vira uma nova sequência, a das somas parciais, a ideia sobre a qual a próxima lição, `infinite-series-and-partial-sums`, se constrói. A lição de estruturas de dados `dynamic-arrays-and-amortized-resizing` argumenta que dobrar um array cheio mantém as inserções baratas em média e que somar uma quantidade fixa não mantém. Esta lição fornece a aritmética por trás das duas afirmações e as confere com uma contagem de verdade.

## Teoria Central

### Progressões aritméticas

Uma sequência com $a_{n+1} - a_n = d$ para todo $n$ é uma progressão aritmética de primeiro termo $a_1$ e razão (diferença) $d$. Seus termos são

$$a_n = a_1 + (n-1)\,d$$

Sua soma $S_n = a_1 + a_2 + \dots + a_n$ pode ser obtida escrevendo a soma duas vezes, uma na ordem direta e outra na inversa, e somando coluna por coluna: toda coluna soma $a_1 + a_n$, e há $n$ colunas, então $2S_n = n(a_1 + a_n)$. Logo

$$S_n = \frac{n\,(a_1 + a_n)}{2} = \frac{n\,\bigl(2a_1 + (n-1)d\bigr)}{2}$$

A mesma fórmula pode ser provada por indução, como em `mathematical-induction`. O caso especial $a_1 = 1$, $d = 1$ dá $1 + 2 + \dots + n = n(n+1)/2$. Para $d \neq 0$, os termos crescem linearmente em $n$ e as somas quadraticamente. Se $d \neq 0$, a sequência $(a_n)$ diverge (cresce sem limite, para cima ou para baixo), e se $d = 0$ ela é constante.

### Progressões geométricas

Uma sequência com $a_{n+1} = r\,a_n$ é uma progressão geométrica de razão $r$:

$$a_n = a_1\, r^{\,n-1}$$

Para a soma, subtraia $r S_n$ de $S_n$. Todos os termos se cancelam, exceto o primeiro e o último, restando $S_n(1 - r) = a_1(1 - r^n)$, e portanto

$$S_n = a_1\,\frac{1 - r^n}{1 - r} \qquad (r \neq 1)$$

Essa fórmula divide por $1 - r$, então não vale para $r = 1$. Nesse caso todo termo é $a_1$ e $S_n = n\,a_1$. Quando a soma começa no expoente $0$, como em $1 + r + \dots + r^n$, há $n + 1$ termos e a fórmula fica $(1 - r^{n+1})/(1 - r)$. Contar os termos errado é o erro mais comum ao aplicá-la.

### O que $r^n$ faz

O comportamento da sequência $(r^n)$ é a história toda da convergência das progressões geométricas:

- Se $\lvert r \rvert < 1$, então $r^n \to 0$.
- Se $r = 1$, a sequência é constante igual a $1$.
- Se $r = -1$, ela alterna entre $-1$ e $1$ e diverge.
- Se $r > 1$, então $r^n \to \infty$. Se $r < -1$, os termos alternam de sinal e seu tamanho cresce sem limite, então diverge.

Para ver o primeiro caso, note que $r = 0$ é imediato; para $r \neq 0$, escreva $\lvert r \rvert = 1/(1+h)$ com $h > 0$. A desigualdade de Bernoulli dá $(1+h)^n \ge 1 + nh$, logo $0 \le \lvert r \rvert^n \le 1/(1 + nh) \to 0$, e o teorema do confronto conclui. Em consequência, uma progressão geométrica $a_1 r^{n-1}$ converge exatamente quando $\lvert r \rvert < 1$ (para $0$) ou $r = 1$ (para $a_1$), desde que $a_1 \neq 0$. E quando $\lvert r \rvert < 1$, a forma fechada mostra as somas parciais se estabilizando em $a_1/(1-r)$, já que $r^n \to 0$ (a próxima lição transforma isso em um teorema sobre séries infinitas).

### Laços, metades e dobros

Contar as iterações de um programa muitas vezes significa somar uma progressão. Um laço interno cuja cota cresce de um em um a cada passada externa dá uma soma aritmética, portanto $\Theta(n^2)$ no total. Uma grandeza dividida pela metade a cada passo, como no laço `while n > 1: n //= 2`, executa $\lfloor \log_2 n \rfloor$ vezes, e em uma recursão que faz trabalho proporcional ao tamanho da entrada e depois recorre sobre a metade dela, as quantidades sucessivas $n, n/2, n/4, \dots$ formam uma progressão geométrica. Em uma soma geométrica com $r > 1$, o último termo domina: $1 + 2 + \dots + 2^{k-1} = 2^k - 1$ é menor que o dobro do último termo $2^{k-1}$. É esse fato que torna o dobramento barato.

## Exemplos Resolvidos

### Exemplo 1: somas aritméticas vindas de laços

O laço `for i in range(n): for j in range(i): count += 1` executa o corpo interno $0 + 1 + \dots + (n-1) = n(n-1)/2$ vezes. Rodá-lo dá $45$ para $n = 10$, $4950$ para $n = 100$ e $499500$ para $n = 1000$, coincidindo com a fórmula em todos os casos. É cerca de metade de $n^2$, mas ainda quadrático.

Agora inverta a pergunta. Para a progressão $5, 8, 11, 14, \dots$ (ou seja, $a_1 = 5$, $d = 3$), ache o menor $n$ com $S_n > 1000$. Aqui $S_n = n(3n + 7)/2$, então precisamos de $3n^2 + 7n - 2000 > 0$. A raiz positiva é $(-7 + \sqrt{24049})/6 \approx 24{,}68$. Confira os vizinhos: $S_{24} = 948$ e $S_{25} = 1025$. A resposta é $n = 25$, cujo último termo é $a_{25} = 77$.

### Exemplo 2: somas geométricas e a contagem de termos

Para $3 + 6 + 12 + \dots$ com $10$ termos, $a_1 = 3$, $r = 2$:

$$S_{10} = 3\,\frac{1 - 2^{10}}{1 - 2} = 3 \cdot 1023 = 3069$$

Para $1 + \tfrac12 + \tfrac14 + \dots$ com $10$ termos, $S_{10} = \dfrac{1 - 2^{-10}}{1 - 1/2} = 2 - 2^{-9} = 1{,}998046875$. Somar os dez termos diretamente dá o mesmo número. A soma $1 + 2 + 4 + \dots + 2^9$ vale $1023 = 2^{10} - 1$, o maior número que cabe em dez bits, já que cada bit ligado contribui com uma potência de dois. Os expoentes de $0$ a $9$ dão $10$ termos, não $9$.

### Exemplo 3: contando as cópias de um array que dobra

Cada inserção em um array cheio copia todos os elementos guardados para um array maior. O script abaixo conta apenas essas cópias, partindo da capacidade $1$, para duas regras de crescimento: dobrar a capacidade e somar $16$ posições.

```python
def count_copies(n, grow):
    capacity, length, copies = 1, 0, 0
    for _ in range(n):
        if length == capacity:          # cheio: aloca um array maior e copia
            copies += length
            capacity = grow(capacity)
        length += 1                     # a própria inserção (uma escrita)
    return copies

for n in (10, 1_000, 10_000, 100_000, 1_000_000):
    dbl = count_copies(n, lambda c: 2 * c)
    inc = count_copies(n, lambda c: c + 16)
    print(f"{n:>9}  doubling: {dbl:>9} ({dbl / n:.2f} per append)   +16: {inc:>12} ({inc / n:.1f} per append)")
```

Sua saída:

```text
       10  doubling:        15 (1.50 per append)   +16:            1 (0.1 per append)
     1000  doubling:      1023 (1.02 per append)   +16:        31311 (31.3 per append)
    10000  doubling:     16383 (1.64 per append)   +16:      3120625 (312.1 per append)
   100000  doubling:    131071 (1.31 per append)   +16:    312456250 (3124.6 per append)
  1000000  doubling:   1048575 (1.05 per append)   +16:  31249562500 (31249.6 per append)
```

**Dobrando.** As realocações acontecem quando o comprimento é $1, 2, 4, \dots$, então as cópias formam a soma geométrica $1 + 2 + \dots + 2^{k-1} = 2^k - 1$, em que $2^k$ é a capacidade final, a menor potência de dois que é pelo menos $n$. Para $n = 10^6$ isso é $2^{20} - 1 = 1048575$, exatamente a contagem. Como $2^k < 2n$, as cópias ficam sempre abaixo de $2n$, que é a cota usada em `dynamic-arrays-and-amortized-resizing`. A razão por inserção não é constante: vale $1{,}02$ em $n = 1000$ e $1{,}64$ em $n = 10^4$, porque o array dobrou para a capacidade $16384$ na inserção $8193$, e as $16383$ cópias até ali estão espalhadas por apenas $10^4$ inserções. Ela fica abaixo de $2$ o tempo todo.

**Somando 16.** As realocações acontecem nos comprimentos $1, 17, 33, \dots$, uma progressão aritmética com $d = 16$. Com $m = \lfloor (n-2)/16 \rfloor$, as cópias somam $(m+1) + 16\,m(m+1)/2$. Para $n = 1000$, $m = 62$ e o total é $63 + 31248 = 31311$, como contado. O custo por inserção cresce como $n/32$, então só piora conforme $n$ cresce.

Isso compara apenas cópias. Dobrar cobra em memória: logo depois de uma realocação até metade do array fica sem uso, enquanto somar $16$ desperdiça no máximo $15$ posições. E o fator $2$ não é especial. Crescer a capacidade por qualquer fator fixo $r > 1$ mantém as cópias por inserção limitadas por cerca de $r/(r-1)$, de modo que o fator $1{,}5$ (arredondado para cima) mede $2{,}10$ por inserção em $n = 10^6$ e o fator $1{,}125$ mede $8{,}68$. Um fator menor troca menos posições ociosas por mais cópias.

### Exemplo 4: crescimento composto contra crescimento simples

Considere uma conta com saldo $1000$, taxa anual fixa de $5\%$ e capitalização anual. Juros simples somam $50$ por ano, uma progressão aritmética: $1000 + 50k$, que vale $2500$ após $30$ anos. Juros compostos multiplicam por $1{,}05$, uma progressão geométrica: $1000 \cdot 1{,}05^k$ vale $1050$ após $1$ ano, $1628{,}89$ após $10$ e $4321{,}94$ após $30$. O saldo dobra quando $1{,}05^k = 2$, em $k = \ln 2 / \ln 1{,}05 \approx 14{,}21$ anos (a regra prática $72/5 = 14{,}4$ chega perto).

Depósitos regulares formam uma soma geométrica. Depositar $100$ no fim de cada mês durante $120$ meses, à taxa mensal $i = 0{,}05/12$, dá $100\,\dfrac{(1+i)^{120} - 1}{i} \approx 15528{,}23$, enquanto os depósitos em si somam $12000$. Aplicar os depósitos mês a mês em um laço reproduz $15528{,}23$.

## Equívocos Comuns e Armadilhas

- **Erro de um na contagem de termos.** A soma $r^0 + r^1 + \dots + r^n$ tem $n + 1$ termos, e usar $n$ no expoente da fórmula dá a resposta errada. Escreva o primeiro e o último expoente, conte e só então substitua.
- **Aplicar a fórmula geométrica em $r = 1$.** Ela divide por zero. A soma é $n\,a_1$, e esse caso importa porque um laço de razão exatamente $1$ é só um laço.
- **"A soma de uma progressão aritmética é linear."** Para $d \neq 0$, os termos são lineares em $n$ e a soma é quadrática. Um laço aninhado com cota que cresce com o contador externo é $\Theta(n^2)$, mesmo que a contagem interna seja "apenas" $i$.
- **"Uma progressão geométrica com $r>1$ é dominada pelos primeiros termos."** Para $r > 1$ o último termo domina, e a soma é um múltiplo limitado dele. Para $\lvert r \rvert < 1$ o primeiro termo domina. Por isso os custos de cópia de um array que dobra somam um pequeno múltiplo de $n$.
- **"Amortizado O(1) significa que cada inserção é barata."** No Exemplo 3, a inserção no comprimento $2^{19} = 524288$ copia esse tanto de elementos de uma vez. A afirmação trata da média sobre muitas inserções, não de uma inserção qualquer.
- **"Uma razão $r < -1$ faz os termos tenderem a $-\infty$."** Os termos alternam de sinal com tamanho crescente, então a sequência não tem limite algum, finito ou infinito.

## Resumo

Uma progressão aritmética soma uma diferença fixa: $a_n = a_1 + (n-1)d$ e $S_n = n(a_1 + a_n)/2$, então, para $d \neq 0$, os termos crescem linearmente e as somas quadraticamente. Uma progressão geométrica multiplica por uma razão fixa: $a_n = a_1 r^{n-1}$ e $S_n = a_1(1 - r^n)/(1 - r)$ para $r \neq 1$, com $S_n = n\,a_1$ em $r = 1$. A sequência $(r^n)$ tende a $0$ exatamente quando $\lvert r \rvert < 1$, o que decide quando uma progressão geométrica converge. Contar os termos com cuidado importa, porque o mesmo padrão dá $n$ ou $n+1$ termos conforme onde o expoente começa. Na computação, laços aninhados produzem somas aritméticas, dividir pela metade produz $\log_2 n$ passos, e dobrar produz uma soma geométrica dominada pelo último termo, e por isso um array que dobra copia menos de $2n$ elementos em $n$ inserções, enquanto um incremento fixo de $16$ copia cerca de $n^2/32$. O crescimento composto é a mesma estrutura geométrica com dinheiro no lugar de memória. A próxima lição, `infinite-series-and-partial-sums`, pergunta o que acontece com essas somas quando o número de termos pode crescer para sempre.

## Documentation Links

- [OpenStax Calculus Volume 2: 5.1 Sequences](https://openstax.org/books/calculus-volume-2/pages/5-1-sequences): fórmulas explícitas e recursivas, com sequências aritméticas e geométricas entre os exemplos.
- [OpenStax Calculus Volume 2: 5.2 Infinite Series](https://openstax.org/books/calculus-volume-2/pages/5-2-infinite-series): somas parciais e a série geométrica, incluindo a razão e a forma fechada.
- [Active Calculus: 8.3 Geometric sums](https://activecalculus.org/single/sec-8-3-geometric.html): somas geométricas finitas e sua forma fechada, estendida às séries geométricas infinitas.
