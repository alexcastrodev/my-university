---
version: 1.0
updatedAt: 2026-11-04
title: "Escolhendo um Método Numérico: Um Guia de Decisão"
summary: "Um guia de decisão para toda a disciplina: dados o tamanho, a suavidade e o condicionamento de um problema, escolher um método e diagnosticar por que ele falhou."
---
## Objetivos de Aprendizagem

- Decidir se um problema pode ser resolvido com exatidão antes de escolher um algoritmo.
- Escolher um primeiro método razoável para busca de raízes, sistemas lineares, ajuste, integração e equações diferenciais.
- Dizer o que faria você abandonar essa primeira escolha.
- Ler uma falha pelos sintomas: resíduo pequeno com resposta errada, erro que estagna, ordem menor que a prometida, resolvedor dando passos minúsculos.

## Contexto e Motivação

Dezesseis lições desta disciplina estudaram, cada uma, um método e como ele quebra. O trabalho real começa pela outra ponta. Você tem um problema, uma biblioteca oferece várias rotinas, e volta algo com cara de número. A habilidade útil é escolher um primeiro método razoável e reconhecer quando a saída não merece confiança.

Dois hábitos atravessam a disciplina. Meça em vez de supor: as lições aqui imprimem erros, taxas e contagens em vez de afirmá-los. E separe o problema do algoritmo: `conditioning-and-numerical-stability` mostra que parte da imprecisão pertence à pergunta, e nenhum algoritmo pode removê-la.

## Teoria Central

### Três perguntas antes de qualquer método

**O problema é bem condicionado?** A regra prática de `the-matrix-condition-number` é que um número de condição $\kappa$ pode custar até cerca de $\log_{10}\kappa$ dígitos decimais dos cerca de 16 que o float64 guarda. Isso é um teto, não uma previsão, e uma matriz mal escalada pode exibir um $\kappa$ enorme sem perder nada, então equilibre primeiro. Quando $\kappa$ está perto de $10^{16}$ num problema bem escalado, trocar de algoritmo não ajuda, e é preciso mudar a formulação ou os dados.

**O que a função oferece?** Um intervalo com troca de sinal, uma derivada, suavidade, ou só uma caixa-preta cara de chamar. Ordem maior só existe quando há a suavidade que ela supõe, e velocidade por iteração não é velocidade por avaliação, como mostra `secant-method-and-order-of-convergence`.

**Qual o tamanho e a estrutura?** Densa ou esparsa, simétrica ou não, um lado direito ou muitos. A estrutura costuma mudar a resposta mais que a escolha da família de algoritmos.

### Uma primeira escolha para cada tarefa

| Tarefa | Comece com | Troque quando |
|---|---|---|
| Raiz de uma função | `brentq` num intervalo | Sem intervalo, mas com boa derivada: Newton |
| Sistema linear denso | LU com pivoteamento parcial | Simétrica definida positiva: Cholesky |
| Sistema esparso grande | Resolvedor direto esparso | Memória ou preenchimento são o limite: iterativo, com precondicionador |
| Dados com ruído | Mínimos quadrados por QR ou `lstsq` | Outliers dominam: uma perda robusta |
| Dados exatos e suaves | Spline cúbica | Você escolhe os nós: Chebyshev |
| Integral definida | `quad` | Singularidade ou salto conhecidos: divida ali ou passe `points` |
| Equação diferencial | `solve_ivp` com `RK45` e um `rtol` declarado | Passos minúsculos numa solução que varia devagar: `Radau` ou `BDF` |

São padrões, não regras. Cada linha é o lugar onde começar a medir.

### Lendo uma falha

| Sintoma | Causa provável | Verificação |
|---|---|---|
| Resíduo pequeno, resposta errada | Mau condicionamento | Calcule $\kappa$ |
| Erro cai, depois para ou sobe | Piso de arredondamento | Compare o passo com $\sqrt{\varepsilon}$ ou $\varepsilon$ |
| Ordem menor que a prometida | Falta de suavidade | Examine a função e divida no ponto ruim |
| Razão de erros do Newton perto de uma constante | Raiz múltipla | Imprima as razões |
| Interpolante oscila entre os pontos | Nós igualmente espaçados, ou ruído | Tente uma spline ou um ajuste de grau baixo |
| Resolvedor explícito se arrasta numa solução lenta | Stiffness | Tente um método implícito e compare |
| Resolvedor indica sucesso, resposta errada | Tolerância frouxa demais | Aperte o `rtol` e compare |

## Exemplos Resolvidos

Cada exemplo rodou em NumPy 2.1.3 e SciPy 1.15.3, e o que importa são as comparações de contagens. Os dados aleatórios usam `default_rng(0)` no Exemplo 2 e `default_rng(1)` no Exemplo 3, que ajusta com `Chebyshev.fit`.

### Exemplo 1: uma raiz, e o custo da velocidade

Encontre a raiz de $f(x)=x^3-2x-5$ perto de $2{,}0946$. Há um intervalo, pois $f(2)=-1$ e $f(3)=16$, e há uma derivada.

```text
Newton a partir de x = 2.0
passo  x                    erro
0      2.0                  9.46e-02
1      2.1                  5.45e-03
2      2.094568121104185    1.66e-05
3      2.094551481698199    1.56e-10
4      2.0945514815423265   0.0

Newton: 5 avaliações de f e 4 de f'
brentq em [2, 3], xtol 1e-12: 8 avaliações de f
```

Newton dobra aproximadamente os dígitos corretos a cada passo e usou 5 chamadas de $f$ contra 8, ao preço de 4 chamadas de $f'$. As contagens ficam próximas porque é uma cúbica com bom ponto de partida. O motivo de `brentq` ser o padrão é a segurança: ele dispensa a derivada e não sai do intervalo. Newton compensa quando a derivada é barata e há um bom ponto de partida, como no laço interno de um resolvedor implícito.

### Exemplo 2: quando o problema é o problema

Resolva $Ax=b$ com solução exata $x=(1,\dots,1)$ e duas matrizes de tamanho 12, usando `numpy.linalg.solve` nas duas.

```text
matriz             kappa      resíduo relativo   erro relativo
Hilbert            1.7e+16    1.1e-16            0.25
Gaussiana aleat.   1.5e+02    2.2e-16            1.1e-14
```

Os resíduos são igualmente minúsculos, então o resolvedor fez seu trabalho nas duas. O erro na Hilbert é de 25% porque $\kappa\approx10^{16}$ quase não deixa dígitos corretos. Um resíduo pequeno significa que a resposta resolve um problema próximo, como explica `conditioning-and-numerical-stability`. Se essa resposta está perto da verdadeira depende de $\kappa$.

### Exemplo 3: ajustar ou interpolar

Tome 11 amostras igualmente espaçadas de $\sin x$ em $[0,\pi]$ com ruído gaussiano de desvio-padrão $0{,}02$, e compare com o $\sin x$ verdadeiro numa malha fina.

```text
                     erro nas amostras      erro máximo contra sin x
Grau 10 passando     1.6e-15                0.121
Ajuste de grau 3     não zero, de propósito 0.036
```

O interpolante acerta todas as amostras e fica mais de três vezes pior contra a verdade, porque ajusta também o ruído. Com dados ruidosos, o alvo é a função por trás, não os pontos. Veja `least-squares-curve-fitting`.

### Exemplo 4: o que um integrador paga, e o que ele pode perder

É `quad` em $[0,1]$ com tolerâncias padrão.

```text
integrando                       avaliações   estimativa   erro real
e^x                              21           1.9e-14      2.2e-16
sqrt(x)                          231          7.4e-16      2.2e-16
salto em 1/sqrt(2)               1071         1.4e-08      5.2e-10
salto em 0.334349                189          7.4e-16      1.0e-03
salto em 0.334349, com points    42           7.4e-15      0.0
```

Integrandos suaves são baratos, e uma derivada singular ou um salto custam muito mais, porque a rotina precisa achar o problema por bissecção. A quarta linha é a que vale guardar. A rotina devolve exatamente o que devolve para um salto em $1/3$, porque suas amostras não distinguem os dois casos, então a resposta erra por $10^{-3}$ enquanto a estimativa diz $7\times10^{-16}$, sem nenhum aviso. Passar a posição com `points` resolve. Isso só ajuda com detalhes que você conhece: `error-orders-and-adaptive-quadrature` mostra o `quad` perdendo um pico estreito mesmo com `points`.

### Exemplo 5: passos minúsculos numa solução suave

Resolva $y'=-1000\,(y-\cos t)-\sin t$ com $y(0)=1$ em $[0,1]$. A solução é simplesmente $\cos t$. Com `rtol=1e-6` e `atol=1e-8`:

```text
método   passos   chamadas de f   erro em t=1
RK45     358      2156            2.6e-07
Radau    10       85              7.9e-10
BDF      24       58              3.0e-09
```

As chamadas foram contadas com um wrapper, porque `nfev` deixa algumas de fora nos métodos implícitos. A solução varia devagar, então 358 passos não têm a ver com exatidão. O método explícito é contido pela estabilidade, que é a marca de stiffness descrita em `eulers-method-and-local-vs-global-error`. Os métodos implícitos dão bem menos passos aqui, embora cada um dê mais trabalho num sistema grande, pois cada passo resolve um sistema linear.

### Exemplo 6: uma taxa que entrega a causa

Newton em $g(x)=(x-1)^2(x+2)$ a partir de $x=2$ converge para a raiz dupla $1$:

```text
passo   erro        razão com o anterior
4       7.96e-02    0.512
6       2.03e-02    0.503
9       2.55e-03    0.500
```

Uma razão que se estabiliza em $0{,}5$ é convergência linear, não a taxa quadrática que `newtons-method` promete para raiz simples. Esse número aponta a causa, pois uma raiz de multiplicidade $m$ dá razão $1-\frac1m$. Dobrar o passo para $x-2\,g(x)/g'(x)$ recupera a convergência rápida, com erro de $6{,}7\times10^{-14}$ depois de quatro passos. Imprimir as razões custou uma linha.

## Equívocos Comuns e Armadilhas

- **"Resíduo pequeno significa resposta exata."** O Exemplo 2 tem resíduo de $10^{-16}$ e erro de 25%.
- **"Ordem maior é sempre melhor."** Ordem é uma afirmação assintótica sob hipóteses de suavidade. Em $\sqrt{x}$ uma regra de ordem alta perde a ordem, e o Exemplo 1 mostra a ordem 2 ganhando pouco de um método mais seguro num problema pequeno.
- **"Passar por todos os pontos é o mais exato."** Com ruído não é, como mostra o Exemplo 3.
- **"A biblioteca resolveu."** Bibliotecas informam uma estimativa do erro, não o erro. O Exemplo 4 mostra uma estimativa errada por doze ordens de grandeza sem nenhum aviso, então confira um caso de resposta conhecida.
- **"Mais passos sempre dão mais exatidão."** Abaixo de certo passo, o arredondamento toma conta, como mostra `sources-of-error-truncation-rounding-propagation`.
- **"Iteração vence fatoração em sistemas esparsos."** Não automaticamente. `iterative-methods-jacobi-and-gauss-seidel` mede um resolvedor direto esparso vencendo com folga num problema 2D.

## Resumo

Pergunte primeiro se o problema é bem condicionado, depois o que a função oferece e como os dados são estruturados. Comece de um padrão robusto: `brentq`, LU, `lstsq`, spline, `quad`, `RK45` com tolerância declarada. Tenha em mente a condição para abandoná-lo. Leia as falhas pelos sintomas e deixe taxas e contagens medidas apontarem a causa, porque imprimir uma razão de erros costuma ser mais rápido que uma discussão. Um método só merece confiança num cenário em que você o conferiu contra algo conhecido.

## Documentation Links

- [Driscoll and Braun: Fundamentals of Numerical Computation](https://fncbook.com/): livro aberto que cobre todas as tarefas deste guia.
- [Goldberg (1991): What Every Computer Scientist Should Know About Floating-Point Arithmetic](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html): a referência sobre arredondamento e float64.
- [SciPy documentation: scipy.optimize.brentq](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.brentq.html): o buscador de raízes com intervalo do Exemplo 1.
- [SciPy documentation: scipy.integrate.quad](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.quad.html): o integrador adaptativo do Exemplo 4, incluindo `points`.
- [SciPy documentation: scipy.integrate.solve_ivp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html): os resolvedores do Exemplo 5.
- [NumPy documentation: numpy.linalg.lstsq](https://numpy.org/doc/stable/reference/generated/numpy.linalg.lstsq.html): mínimos quadrados pela SVD.
