---
version: 1.0
updatedAt: 2026-11-04
title: "Ordens de Erro e Quadratura Adaptativa"
summary: "A ordem de uma regra de quadratura, a extrapolação de Richardson e a quadratura adaptativa, que refina só onde a estimativa de erro exige."
---
## Objetivos de Aprendizagem

- Definir a ordem de uma regra de quadratura como afirmação assintótica e estimá-la mesmo sem a integral exata.
- Usar a expansão de Euler-Maclaurin para explicar as potências pares no erro do trapézio e seu comportamento em integrandos periódicos.
- Aplicar a extrapolação de Richardson, deduzir dela a regra de Simpson e montar uma tabela de Romberg.
- Mostrar o que a extrapolação faz quando a potência de $h$ assumida está errada, e corrigir isso.
- Transformar duas estimativas de Simpson numa estimativa de erro e num algoritmo adaptativo que gasta avaliações onde está o erro.
- Comparar uma rotina adaptativa com `scipy.integrate.quad` por avaliações e erro atingido, e citar entradas que derrotam as duas.

## Contexto e Motivação

Em `trapezoid-and-simpson-rules`, escolher $n$ exigia uma cota para $f''$ ou $f^{(4)}$ no intervalo inteiro, e um único $h$ valia em toda parte. Nenhuma das duas coisas combina com o uso real. Uma biblioteca recebe só uma função e uma tolerância, e um integrando como um pico estreito precisa de painéis finos num lugar e grossos no resto.

Os dois problemas têm a mesma resposta: comparar a regra com ela mesma em duas resoluções. A diferença entre elas estima o erro, sem derivada nenhuma. Ela pode melhorar o resultado (extrapolação de Richardson) ou decidir onde refinar (quadratura adaptativa).

## Teoria Central

### Ordem, medida

Um método $A(h)$ para $I$ tem **ordem** $p$ num integrando $f$ se $A(h) - I = Ch^p + o(h^p)$ com $C\ne0$ quando $h\to0$. Há três coisas embutidas aí: a afirmação é sobre o limite $h\to0$, depende de $f$ e não diz nada sobre um $h$ específico. Para uma regra composta de grau de precisão $d$ em $f\in C^{d+1}$, cada painel contribui com $O(h^{d+2})$ e há $O(1/h)$ painéis, então o erro é $O(h^{d+1})$: $O(h^2)$ para o trapézio, $O(h^4)$ para Simpson. A ordem é exatamente $d+1$ quando a constante principal não é zero. Ela pode ser maior para uma $f$ específica, como mostra a próxima seção.

Com o valor exato, $p\approx\log_2\big(E(h)/E(h/2)\big)$. Sem ele, três resoluções bastam, pois

$$\rho = \frac{A(h)-A(h/2)}{A(h/2)-A(h/4)} \to 2^p.$$

Para a regra do trapézio em $e^x$ sobre $[0,1]$, $\rho = 3{,}996$ com $n=4,8,16$. Em $\sqrt x$, $\rho$ vale $2{,}804$, $2{,}816$, $2{,}820$ partindo de $n=64$, $256$, $512$, a caminho de $2^{3/2}=2{,}828$. A integral exata não foi usada.

### A expansão de Euler-Maclaurin

Se $f\in C^{2m}[a,b]$, a regra composta do trapézio satisfaz

$$T(h) - I = \frac{h^2}{12}\big[f'\big]_a^b - \frac{h^4}{720}\big[f'''\big]_a^b + \dots + O(h^{2m}), \qquad [g]_a^b = g(b)-g(a).$$

Só aparecem potências pares, e só entram derivadas nos extremos. Em $e^x$ com $n=8$: o primeiro termo é $2{,}237346\times10^{-3}$, dois termos dão $2{,}236763488\times10^{-3}$ e a diferença verdadeira é $2{,}236763705\times10^{-3}$. A série é assintótica: para $h$ fixo ela não precisa convergir quando se acrescentam termos.

Duas consequências saem de imediato.

- Se $f'(a)=f'(b)$, o termo em $h^2$ some. Para $x^2(1-x)^2$ em $[0,1]$, $T_n - I$ é $-8{,}138\times10^{-6}$ em $n=8$ e $-5{,}086\times10^{-7}$ em $n=16$, ordem medida de $4{,}00$, de acordo com o termo seguinte $-h^4/30$.
- Se $f$ é $C^\infty$ e periódica de período $b-a$, todo colchete se anula, então o erro vence qualquer potência de $h$. Isso explica a tabela de $e^{\cos x}$ da lição anterior.

### Extrapolação de Richardson

Suponha $A(h) = I + Ch^p + O(h^q)$ com $q>p$ e $p$ conhecido. Eliminar $C$ de $A(h)$ e $A(h/2)$ dá

$$R(h) = \frac{2^p A(h/2) - A(h)}{2^p - 1} = I + O(h^q).$$

Nenhuma avaliação nova é necessária. Na regra do trapézio, $p=2$, $q=4$, e a combinação é exatamente a regra de Simpson: $S_{2n} = (4T_{2n} - T_n)/3$. Logo Simpson pode ser lida como a regra do trapézio sem o erro principal.

A expansão só tem potências pares, então isso pode ser repetido. A **integração de Romberg** preenche uma tabela com $R_{i,0}=T_{2^i}$ e

$$R_{i,j} = \frac{4^j R_{i,j-1} - R_{i-1,j-1}}{4^j - 1}.$$

### Da extrapolação à estimativa de erro

Num painel $[a,b]$ com ponto médio $m$, seja $S_1$ um painel de Simpson e $S_2$ a soma de dois meios painéis. Se $f^{(4)}$ é quase constante em $[a,b]$, então $I-S_1\approx 16(I-S_2)$, e assim

$$I - S_2 \approx \frac{S_2 - S_1}{15}.$$

A aproximação depende dessa condição. Onde $f^{(4)}$ varia muito, ou não existe, o fator 15 está errado. Somar a correção, $S_2+(S_2-S_1)/15$, dá a regra de Boole nos cinco pontos, exata para polinômios de grau 5.

### Simpson adaptativa

O algoritmo: estime o erro num painel; se estiver dentro da tolerância, aceite; caso contrário, divida em dois, dê a cada metade metade da tolerância e aplique a recursão. Os valores da função são passados adiante, então cada divisão custa só duas avaliações novas, e $P$ painéis aceitos custam $4P+1$ avaliações.

```python
def adaptive_simpson(f, a, b, tol):
    def simp(a, fa, fm, b, fb):
        return (b - a) / 6 * (fa + 4 * fm + fb)
    def rec(a, fa, m, fm, b, fb, whole, tol, depth):
        l, r = (a + m) / 2, (m + b) / 2
        fl, fr = f(l), f(r)
        left, right = simp(a, fa, fl, m, fm), simp(m, fm, fr, b, fb)
        d = left + right - whole
        if abs(d) <= 15 * tol or depth == 0:
            return left + right + d / 15
        return (rec(a, fa, l, fl, m, fm, left, tol / 2, depth - 1)
                + rec(m, fm, r, fr, b, fb, right, tol / 2, depth - 1))
    m = (a + b) / 2
    fa, fm, fb = f(a), f(m), f(b)
    return rec(a, fa, m, fm, b, fb, simp(a, fa, fm, b, fb), tol, 60)
```

### O que `scipy.integrate.quad` faz de diferente

`quad` chama o QUADPACK. Para um intervalo finito sem pesos nem pontos de quebra, a rotina é `qagse`, que a documentação do SciPy descreve como subdivisão globalmente adaptativa com extrapolação e uma regra de Gauss-Kronrod de 21 pontos em cada subintervalo. "Globalmente adaptativa" significa que ela mantém uma lista de painéis e refina o que tem a maior estimativa de erro, em vez de dividir a tolerância de antemão como a recursão acima. Os padrões são `epsabs=1.49e-8`, `epsrel=1.49e-8`, `limit=50`. Uma regra de Gauss-Kronrod só avalia pontos interiores, então um integrando que explode num extremo não é, por si só, um problema para ela.

## Exemplos Resolvidos

### Exemplo 1: Richardson à mão

Em $e^x$ sobre $[0,1]$: $T_4 = 1{,}7272219046$ e $T_8 = 1{,}7205185922$, com erros $8{,}94\times10^{-3}$ e $2{,}24\times10^{-3}$. Então

$$\frac{4T_8 - T_4}{3} = 1{,}7182841547,$$

com erro $2{,}33\times10^{-6}$, que é $S_8$ a menos de arredondamento. Nove avaliações já tinham sido gastas em $T_8$, então o ganho de cerca de 1000 vezes não custou nada.

Para o estimador de erro no painel único $[0,1]$: $S_1 = 1{,}7188611519$, $S_2 = 1{,}7183188419$, logo $(S_2-S_1)/15 = -3{,}615\times10^{-5}$, perto do valor verdadeiro $I-S_2 = -3{,}701\times10^{-5}$.

### Exemplo 2: uma tabela de Romberg

Erros em $e^x$ sobre $[0,1]$, cada coluna um nível de extrapolação adiante:

```text
painéis aval. ordem 2   ordem 4   ordem 6   ordem 8   ordem 10
   1     2    1.41e-01
   2     3    3.56e-02  5.79e-04
   4     5    8.94e-03  3.70e-05  8.59e-07
   8     9    2.24e-03  2.33e-06  1.38e-08  3.35e-10
  16    17    5.59e-04  1.46e-07  2.16e-10  1.34e-12  3.31e-14
  32    33    1.40e-04  9.10e-09  3.38e-12  4.88e-15  2.22e-16
```

Com 33 avaliações a tabela chegou ao arredondamento, então o $2{,}22\times10^{-16}$ sob a ordem 10 é ruído: em aritmética de 60 dígitos essa entrada tem erro $3{,}3\times10^{-17}$, e a seguinte na diagonal, não impressa, tem $8{,}2\times10^{-19}$. `scipy.integrate.romb` nas mesmas 33 amostras também termina em $2{,}2\times10^{-16}$.

### Exemplo 3: extrapolando com a potência errada

Em $\sqrt x$ a expansão do trapézio não tem potências pares. Ela é $T(h)-I = \zeta(-\tfrac12)\,h^{3/2} + \tfrac{1}{24}h^2 + \dots$ com $\zeta(-\tfrac12)\approx-0{,}2079$, uma forma generalizada de Euler-Maclaurin para singularidade num extremo. Em $n=4096$ esses dois termos dão $-7{,}905394871\times10^{-7}$, de acordo com a diferença calculada até dez dígitos. Richardson com o $p=2$ de livro só muda a constante. Com o $p=3/2$ medido, o termo principal vai embora:

```text
   n    erro T     erro p=2   ordem   erro p=3/2   ordem
 256   5.012e-05   1.982e-05          4.074e-07
 512   1.779e-05   7.008e-06  1.50    1.018e-07    2.00
1024   6.304e-06   2.478e-06  1.50    2.546e-08    2.00
2048   2.233e-06   8.759e-07  1.50    6.365e-09    2.00
4096   7.905e-07   3.097e-07  1.50    1.591e-09    2.00
```

Romberg, que assume potências pares, herda o problema: com 1025 avaliações a última entrada da diagonal tem erro $2{,}1\times10^{-6}$, contra $2{,}2\times10^{-16}$ com 33 avaliações em $e^x$. Meça $\rho$ primeiro, depois extrapole.

### Exemplo 4: Simpson adaptativa contra `quad`

Tolerância $10^{-6}$ para ambas, com `epsabs=1e-6, epsrel=0, limit=500`, contando chamadas com um wrapper (a contagem é igual a `infodict['neval']` de `quad`). A última coluna vem de uma varredura linear pelos $n$ pares: é o primeiro $n$, mais 1, em que Simpson uniforme alcança o erro da adaptativa.

```text
integrando em [0,1]     Simpson adaptativa   quad              Simpson uniforme
                        aval.   erro         aval.  erro       aval.
e^x                        17   2.2e-10        21   2.2e-16        83
sqrt(x)                   105   2.0e-08       231   2.2e-16     25849
1/(1e-6 + (x-0.3)^2)     5009   1.7e-09       567   2.7e-12      8493
|x - 1/sqrt(2)|            37   4.0e-08       357   4.8e-10       413
degrau em 1/sqrt(2)       217   1.1e-16       735   6.5e-08     (veja abaixo)
```

Leia as colunas com cuidado, porque os erros são diferentes. Avaliações, sozinhas, não ordenam os métodos. A coluna uniforme também é um primeiro acerto, não um limiar estável, no pico e na quina: o erro não é monótono em $n$, e $n$ pares maiores ainda erram a meta, até $n=8860$ no pico e $n=2728$ na quina.

- **Suave:** `quad` chega ao arredondamento em 21 avaliações. Simpson adaptativa para em 17 com erro bem maior e precisa de 129 avaliações (tolerância $10^{-10}$) para chegar a $6{,}7\times10^{-16}$. A regra de grau mais alto vence.
- **Pico:** no pico de meia-largura $\varepsilon=10^{-3}$, Simpson adaptativa precisa de 5009 avaliações contra 8493 da uniforme. Ser adaptativa não é vitória automática: com $\varepsilon=10^{-2}$ são 1413 contra 779 da uniforme, e com $\varepsilon=10^{-4}$ são 16433 contra 89463. O ganho cresce com a concentração da dificuldade. Em $\varepsilon=10^{-2}$, 234 dos 353 painéis aceitos ficam em $[0{,}25;\,0{,}35]$, um décimo do intervalo.
- **Singular:** em $\sqrt x$ os painéis encolhem na direção de $0$ (o painel aceito mais estreito tem largura $4{,}8\times10^{-7}$) e a ordem em avaliações é recuperada: ajustando sobre tolerâncias de $10^{-4}$ a $10^{-10}$, o erro cai como $N^{-5{,}7}$, contra $N^{-1{,}5}$ de Simpson uniforme. A taxa passa de 4 porque a rotina devolve o valor extrapolado.
- **Degrau:** a recursão custa 217 avaliações em toda tolerância testada. Num painel que contém o salto, $\lvert d\rvert$ e a tolerância caem pela metade a cada divisão, então o teste só passa quando o painel tem cerca de $10^{-16}$ de largura e o arredondamento zera $d$. Simpson uniforme é errática aqui, com erro perto de $10^{-5}$ em 65537 avaliações. `quad` informada do local, com `points=[c]`, precisa de 42 avaliações e tem erro 0.

### Exemplo 5: o que derrota um método adaptativo

Todo método que amostra uma quantidade finita de pontos pode ser enganado, porque uma função pode diferir de $f$ só entre as amostras. Cada um destes casos foi executado:

- **Um pico entre as amostras.** Tome $e^{-((x-1/\pi)/w)^2}$ em $[0,1]$ com $w=10^{-3}$, cuja integral é $0{,}00177$. Simpson adaptativa vê cinco valores perto de zero e devolve $0{,}0$ depois de 5 avaliações. `quad` devolve $0{,}0$ com estimativa de erro $0{,}0$ depois de 21, sem aviso. `points=[1/pi]` resolve esse caso, mas para $w=10^{-4}$ ainda devolve cerca de $3\times10^{-24}$. Conhecendo a escala, divida o intervalo à mão em volta do pico.
- **Uma estimativa pequena demais.** Simpson adaptativa em $\sqrt x$ com tolerância $10^{-3}$ usa 9 avaliações e tem erro $3{,}2\times10^{-3}$, mais de três vezes a tolerância. O fator 15 supunha $f^{(4)}$ quase constante.
- **Um erro reportado que está errado.** No degrau em $1/\sqrt2$ com `epsabs=1e-10, epsrel=0, limit=500`, `quad` devolve um erro de $1{,}8\times10^{-10}$, reporta $3{,}3\times10^{-16}$ e não emite aviso. O erro fica acima da tolerância, e o valor reportado é mais de cinco ordens de grandeza menor que o real.
- **Uma integral que não existe.** $\int_0^1 dx/(x-0{,}3)$ diverge. `quad` devolve $0{,}8473$ (que é $\ln\frac73$, o valor principal) com estimativa de erro $4\times10^{-13}$ e emite `IntegrationWarning`: "The integral is probably divergent, or slowly convergent." A documentação diz: "For valid results, the integral must converge; behavior for divergent integrals is not guaranteed."
- **Explosão num extremo.** Para $\int_0^1 \cos x/\sqrt x\,dx \approx 1{,}8090484758$, a rotina acima falha com `ZeroDivisionError` em $f(0)$. `quad` funciona com 231 avaliações e erro $1{,}6\times10^{-15}$, porque nunca avalia $0$. A substituição $x=t^2$ dá $\int_0^1 2\cos(t^2)\,dt$, que é suave, e `quad` passa a precisar de 21 avaliações.

Livro vs hoje: tutoriais antigos usam `scipy.integrate.romberg` e `scipy.integrate.quadrature`, que não existem no SciPy atual. Use `quad` para uma função e `romb` para $2^k+1$ amostras igualmente espaçadas.

## Equívocos Comuns e Armadilhas

- **"A ordem $p$ me dá o erro no meu $h$."** Ela descreve o limite, sob hipóteses. Meça com $\rho$.
- **"Richardson sempre aumenta a precisão."** Só com a potência certa e $f$ suave o bastante. Com $p=2$ em $\sqrt x$ a ordem continua $1{,}50$.
- **"A tolerância é uma garantia."** No Exemplo 5 o erro chega a três vezes a tolerância. Ela é uma meta que uma estimativa tenta cumprir.
- **"O erro reportado por `quad` é uma cota superior."** No Exemplo 5 ele fica mais de cinco ordens de grandeza abaixo do real.
- **"Adaptativa sempre sai mais barata que uniforme."** Não num pico suave: 1413 contra 779 avaliações.
- **"Sem aviso, o resultado está certo."** O pico devolveu $0{,}0$ sem aviso. Se o integrando tem características conhecidas, passe-as em `points` ou divida o intervalo.
- **Comparar rotinas por avaliações na mesma tolerância.** Compare no mesmo erro atingido, pois as rotinas superam uma tolerância por margens muito diferentes.

## Resumo

Ordem é uma afirmação assintótica, mensurável sem a resposta exata pela razão $\rho$. A expansão de Euler-Maclaurin mostra que o erro do trapézio é uma série em potências pares comandada pelas derivadas nos extremos, o que explica a ordem 4 quando $f'(a)=f'(b)$ e a convergência muito rápida em integrandos suaves e periódicos. A extrapolação de Richardson remove uma potência conhecida: aplicada à regra do trapézio dá Simpson, e repetida dá Romberg. Ela exige a potência certa, como $\sqrt x$ mostra. Comparar um painel de Simpson com dois dá uma estimativa de erro, e refinar onde ela é grande dá a quadratura adaptativa, que ajuda mais quando a dificuldade está concentrada. `quad` acrescenta uma regra de grau bem mais alto e refinamento global, e vence em integrandos suaves. Nenhuma das duas enxerga entre as amostras, então tolerâncias e estimativas não são garantias.

## Documentation Links

- [Fundamentals of Numerical Computation, 5.7 Adaptive integration](https://fncbook.com/adaptive): a estimativa de erro por dois níveis de Simpson e um integrador adaptativo recursivo.
- [Fundamentals of Numerical Computation, 5.6 Numerical integration](https://fncbook.com/integration): a fórmula de Euler-Maclaurin e a extrapolação da regra do trapézio.
- [SciPy, scipy.integrate.quad](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.quad.html): parâmetros, `infodict`, pontos de quebra e as rotinas do QUADPACK.
- [SciPy, scipy.integrate.romb](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.romb.html): integração de Romberg em $2^k+1$ amostras igualmente espaçadas.
