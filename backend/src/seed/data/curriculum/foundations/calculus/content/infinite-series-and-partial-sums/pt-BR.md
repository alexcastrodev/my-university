---
version: 1.0
updatedAt: 2026-11-04
title: "Séries Infinitas e Somas Parciais"
summary: "Uma série infinita como o limite de suas somas parciais, a série geométrica, somas telescópicas, o teste da divergência e por que a série harmônica diverge, incluindo como a soma em ponto flutuante pode esconder uma divergência."
---
## Objetivos de Aprendizagem

- Definir a soma de uma série infinita como o limite da sequência de suas somas parciais, e dizer quando uma série converge ou diverge.
- Somar uma série geométrica, enunciar exatamente quando a fórmula vale e transformar uma dízima periódica em fração.
- Achar as somas parciais de uma série telescópica por cancelamento e tomar o limite.
- Enunciar o teste da divergência no sentido correto e mostrar com um exemplo por que sua recíproca é falsa.
- Provar que a série harmônica diverge, dizer o quão devagar ela diverge e reconhecer quando a soma em ponto flutuante esconde uma divergência.

## Contexto e Motivação

A lição anterior, `arithmetic-and-geometric-progressions`, deu formas fechadas para a soma dos $n$ primeiros termos. Agora deixe o número de termos crescer para sempre. Somar infinitos números não pode ser feito somando um depois do outro, então a soma precisa ser definida, e a definição reaproveita o que você viu em `sequences-and-convergence`: olhar a sequência das somas parciais e perguntar se ela converge.

A mesma pergunta apareceu para áreas em `improper-integrals`, onde uma cauda infinita de área ou somava um número finito ou não somava. As séries são a versão discreta dessa história, e as duas se reencontram adiante, porque a integral de $1$ a $\infty$ de $1/x$ decide o destino da série harmônica. Na computação, séries aparecem sempre que uma grandeza é construída somando correções: uma aproximação numérica, um total acumulado de custos, as probabilidades dos resultados sucessivos de uma tentativa repetida. Saber se o total é finito não é um detalhe técnico.

## Teoria Central

### Somas parciais e o significado de uma soma infinita

Dada uma sequência $(a_n)$, a **$N$-ésima soma parcial** é $S_N = a_1 + a_2 + \dots + a_N$. A **série infinita** $\sum_{n=1}^{\infty} a_n$ **converge** para $S$ se a sequência $(S_N)$ converge para $S$, e **diverge** se $(S_N)$ não converge. O número $S$ é chamado de soma da série. Nada é "somado infinitas vezes"; a soma é um limite de somas finitas.

O ponto em que a série começa afeta o valor, mas não a convergência, já que remover finitos termos desloca a soma por uma quantidade fixa. Se $\sum a_n$ e $\sum b_n$ convergem, então $\sum (a_n + b_n) = \sum a_n + \sum b_n$ e $\sum c\,a_n = c \sum a_n$. Se uma converge e a outra diverge, a soma das duas diverge. Se as duas divergem, tudo pode acontecer: com $a_n = 1$ e $b_n = -1$, a série combinada $\sum (a_n + b_n) = 0 + 0 + \dots$ converge.

### A série geométrica

Para $a \neq 0$,

$$\sum_{n=0}^{\infty} a\,r^n = \frac{a}{1 - r} \quad \text{se } \lvert r \rvert < 1, \qquad \text{e a série diverge se } \lvert r \rvert \ge 1$$

A demonstração é a forma fechada da lição anterior: $S_N = a(1 - r^{N+1})/(1 - r)$, e para $\lvert r \rvert < 1$ vale $r^{N+1} \to 0$, de modo que $S_N \to a/(1-r)$. Para $\lvert r \rvert \ge 1$ os termos $a r^n$ não tendem a $0$, o que exclui a convergência pelo teste da divergência abaixo. A fórmula $a/(1-r)$ é uma afirmação sobre o caso $\lvert r \rvert < 1$ apenas. Colocar $r = 2$ nela para "somar" $1 + 2 + 4 + \dots$ dá $-1$, uma resposta sem sentido para uma série cujas somas parciais são $2^{N+1} - 1 \to \infty$.

### Séries telescópicas

Se $a_n = b_n - b_{n+1}$ para alguma sequência $(b_n)$, então termos consecutivos se cancelam e

$$S_N = (b_1 - b_2) + (b_2 - b_3) + \dots + (b_N - b_{N+1}) = b_1 - b_{N+1}$$

Logo a série converge exatamente quando $(b_n)$ converge, e então sua soma é $b_1 - \lim b_n$. O trabalho está em achar os $b_n$, muitas vezes por frações parciais.

### O teste da divergência

> Se $\sum a_n$ converge, então $a_n \to 0$.

O motivo: $a_N = S_N - S_{N-1}$, e se $S_N \to S$ então também $S_{N-1} \to S$, de modo que $a_N \to S - S = 0$. A forma útil é a contrapositiva. Se $a_n$ não tende a $0$ (tende a outro valor, ou não tem limite), a série diverge. O teste só pode provar divergência. A recíproca é falsa: $a_n \to 0$ não faz a série convergir, e a série harmônica é o contraexemplo padrão.

### A série harmônica

A série harmônica é $\sum_{n=1}^{\infty} 1/n$, com somas parciais $H_N = 1 + \tfrac12 + \dots + \tfrac1N$. Compare cada termo com uma área. Para $n \ge 1$, a função $1/x$ é no máximo $1/n$ em $[n, n+1]$, então $1/n \ge \int_n^{n+1} dx/x$. Somando essas desigualdades para $n = 1, \dots, N$,

$$H_N \ge \int_1^{N+1} \frac{dx}{x} = \ln(N+1) \to \infty$$

e a série diverge. Este é o caso limite $p = 1$ do teste-$p$ de `improper-integrals`. Uma cota superior correspondente vem de $1/n \le \int_{n-1}^{n} dx/x$ para $n \ge 2$, que dá $H_N \le 1 + \ln N$. Juntas,

$$\ln(N+1) \le H_N \le 1 + \ln N$$

e então $H_N$ cresce como $\ln N$: sem limite, mas muito devagar.

### Séries de termos não negativos

Se todo $a_n \ge 0$, as somas parciais são não decrescentes, e pelo teorema da convergência monótona a série converge se e somente se $(S_N)$ é limitada superiormente. É a ferramenta por trás dos argumentos de comparação, e ela falha para termos de sinais misturados. Por exemplo, como $1/n^2 \le 1/(n(n-1)) = 1/(n-1) - 1/n$ para $n \ge 2$, uma soma telescópica mostra que $\sum_{n=1}^{N} 1/n^2 \le 1 + (1 - 1/N) < 2$. As somas parciais são limitadas, então $\sum 1/n^2$ converge. (Sua soma é $\pi^2/6 \approx 1{,}6449$, um valor que exige outro argumento.) A próxima lição, `convergence-tests`, reúne mais dessas ideias de comparação.

## Exemplos Resolvidos

### Exemplo 1: série geométrica, uma dízima e os casos que falham

Para $\sum_{n=0}^{\infty} (2/3)^n$ temos $a = 1$ e $r = 2/3$, então a soma é $1/(1 - 2/3) = 3$. As somas parciais se aproximam dela:

```text
último índice m    S_m
0                  1.0000
1                  1.6667
2                  2.1111
5                  2.7366
10                 2.9653
20                 2.9994
```

A dízima periódica $0{,}272727\dots = \dfrac{27}{100} + \dfrac{27}{100^2} + \dots$ é geométrica com $a = 27/100$ e $r = 1/100$, então vale $\dfrac{27/100}{1 - 1/100} = \dfrac{27}{99} = \dfrac{3}{11}$. Uma soma direta dos seis primeiros termos dá $0{,}272727272727$, de acordo com $3/11$ (a soma exata de seis termos é $0{,}272727272727$, faltando cerca de $2{,}7 \times 10^{-13}$ para $3/11$).

Casos que falham: para $r = -1$ as somas parciais são $1, 0, 1, 0, \dots$ e não convergem, então $\sum (-1)^n$ não tem soma. Para $r = 1{,}1$ os termos crescem e o teste da divergência se aplica. E o índice inicial importa para o valor: $\sum_{n=0}^{\infty} (1/2)^n = 2$, enquanto $\sum_{n=1}^{\infty} (1/2)^n = 1$.

### Exemplo 2: duas somas telescópicas, uma convergente e outra não

**Convergente.** Frações parciais dão $\dfrac{1}{n(n+2)} = \dfrac12\left(\dfrac1n - \dfrac1{n+2}\right)$. Os termos se cancelam com dois passos de distância, então só sobrevivem os dois primeiros e os dois últimos valores de $b$:

$$S_N = \frac12\left(1 + \frac12 - \frac1{N+1} - \frac1{N+2}\right) \to \frac34$$

Conferir em frações exatas para $N = 1, 2, 5, 10, 100$ confirma a fórmula e dá $S_N = 0{,}3333;\ 0{,}4583;\ 0{,}5952;\ 0{,}6629;\ 0{,}7401$, subindo em direção a $0{,}75$.

**Divergente, embora os termos vão a zero.** Como $\ln(1 + 1/n) = \ln(n+1) - \ln n$, as somas parciais telescopam até $S_N = \ln(N+1)$, que vale $2{,}398$ em $N = 10$, $6{,}909$ em $N = 1000$ e $13{,}816$ em $N = 10^6$. A série diverge mesmo com $\ln(1 + 1/n) \to 0$.

### Exemplo 3: o quão devagar a série harmônica diverge

Cálculo direto e as cotas da Teoria Central:

```text
N          ln(N+1)    H_N        1 + ln N
10         2.398      2.929      3.303
100        4.615      5.187      5.605
1000       6.909      7.485      7.908
1000000    13.816     14.393     14.816
```

Cada valor de $H_N$ fica entre as cotas. A soma parcial passa de $10$ pela primeira vez em $N = 12367$. Para passar de $100$, use a aproximação $H_N \approx \ln N + \gamma$ com $\gamma \approx 0{,}5772$ (a constante de Euler-Mascheroni): a soma parcial passa de $100$ perto de $N \approx e^{100 - \gamma} \approx 1{,}5 \times 10^{43}$. A soma é ilimitada, e nenhuma computação chegaria perto de mostrar isso. A divergência aqui é uma afirmação sobre o limite, não sobre algo que uma máquina um dia alcance.

### Exemplo 4: o ponto flutuante pode fazer uma série divergente parecer convergente

Some $1/k$ em precisão simples até que somar um termo não altere mais o total:

```python
import numpy as np

total, k = np.float32(0), 0
while True:
    k += 1
    new = np.float32(total + np.float32(1) / np.float32(k))
    if new == total:        # somar 1/k não altera mais a soma em float32
        break
    total = new
print(k, total)
```

Ele imprime `2097152 15.403683`. O espaçamento dos números de precisão simples perto de $15{,}4$ é cerca de $9{,}5 \times 10^{-7}$, e o termo $1/2^{21} \approx 4{,}8 \times 10^{-7}$ é a metade disso, então a partir de $k = 2097152 = 2^{21}$ cada termo somado é arredondado para nada e a soma calculada para em $15{,}403683$. A soma parcial verdadeira, calculada em precisão dupla, é $H_{2097152} \approx 15{,}1333$, e continua crescendo sem limite. O total em float32 também difere dela, porque erros de arredondamento se acumularam ao longo de dois milhões de adições. Um critério de parada "pare quando o próximo termo estiver abaixo da resolução" informaria um valor finito para uma série que diverge. A precisão dupla empurra a estagnação para muito mais tarde, mas não a elimina.

## Equívocos Comuns e Armadilhas

- **"Se $a_n \to 0$, a série converge."** A série harmônica e $\sum \ln(1 + 1/n)$ têm termos que tendem a $0$ e divergem. O teste da divergência só funciona em um sentido.
- **"A fórmula $a/(1-r)$ vale para qualquer razão."** Ela exige $\lvert r \rvert < 1$. Para $r = 2$ ela devolve $-1$ para uma série cujas somas parciais vão ao infinito.
- **Confundir o índice inicial.** Os mesmos termos somados a partir de $n = 0$ ou de $n = 1$ diferem pelo primeiro termo. Escreva o primeiro termo antes de usar uma fórmula.
- **"Uma série com termos minúsculos já convergiu."** O Exemplo 4 soma termos menores que $10^{-6}$ e trava em um valor finito, enquanto a série verdadeira diverge. Termos minúsculos e um total em ponto flutuante estagnado não são evidência de convergência.
- **"Parênteses e rearranjos são sempre seguros."** Agrupar os termos de $1 - 1 + 1 - 1 + \dots$ como $(1-1) + (1-1) + \dots$ dá $0$, enquanto $1 + (-1+1) + (-1+1) + \dots$ dá $1$, e a série não tem soma alguma (suas somas parciais alternam entre $1$ e $0$). Rearranjar os termos de uma série convergente também pode mudar sua soma em certas séries, o que exige a noção de convergência absoluta para ser esclarecido.
- **"Se as somas parciais são limitadas, a série converge."** Isso vale para termos não negativos, onde as somas parciais são monótonas. Para $1 - 1 + 1 - 1 + \dots$ as somas parciais são limitadas e a série diverge.
- **Separar uma série em duas parcelas divergentes.** A linearidade exige que as duas séries convirjam.

## Resumo

Uma série infinita é o limite de suas somas parciais $S_N$: ela converge quando $(S_N)$ converge e diverge caso contrário. A série geométrica $\sum_{n=0}^{\infty} a r^n$ converge para $a/(1-r)$ exatamente quando $\lvert r \rvert < 1$. As séries telescópicas colapsam em $S_N = b_1 - b_{N+1}$, de modo que sua convergência se reduz à de uma sequência. O teste da divergência diz que, se $a_n \not\to 0$, a série diverge, mas $a_n \to 0$ não garante nada, como mostra a série harmônica: $\ln(N+1) \le H_N \le 1 + \ln N$, logo ela diverge, mas tão devagar que $H_N$ só passa de $10$ em $N = 12367$. Para termos não negativos, convergir é o mesmo que ter somas parciais limitadas. A soma em ponto flutuante pode estagnar em uma série divergente, então o comportamento numérico sozinho não prova nada. A próxima lição, `convergence-tests`, constrói critérios gerais para decidir a convergência sem calcular as somas parciais em forma fechada.

## Documentation Links

- [OpenStax Calculus Volume 2: 5.2 Infinite Series](https://openstax.org/books/calculus-volume-2/pages/5-2-infinite-series): somas parciais, a série harmônica, séries geométricas, o teste da divergência e séries telescópicas.
- [Active Calculus: 8.3 Geometric sums](https://activecalculus.org/single/sec-8-3-geometric.html): séries geométricas finitas e infinitas e quando a soma infinita existe.
- [MIT OCW 18.01SC: Unit 5, Exploring the Infinite](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-5-exploring-the-infinite/): as sessões sobre séries infinitas e comparação de séries, com notas e vídeos.
