---
version: 1.0
updatedAt: 2026-11-04
title: "Fontes de Erro: Truncamento, Arredondamento, Propagação"
summary: "De onde vem o erro numérico: truncar um processo infinito, arredondar para precisão finita e como os dois se propagam num cálculo, com erro absoluto e relativo e perda de significância."
---
## Objetivos de Aprendizagem

- Calcular o erro absoluto e o erro relativo, e dizer qual dos dois faz sentido para uma dada grandeza.
- Separar o erro de truncamento do erro de arredondamento num resultado calculado, e deduzir como cada um depende de um parâmetro como o passo $h$.
- Enunciar o modelo padrão da aritmética de ponto flutuante, incluindo onde ele deixa de valer, e distinguir épsilon de máquina de unit roundoff.
- Propagar o erro em somas, produtos e funções em primeira ordem, e prever a perda de significância numa subtração.
- Localizar o ponto em que o arredondamento ultrapassa o truncamento, e explicar por que reduzir $h$ além dele piora a resposta.

## Contexto e Motivação

`ieee-754-floating-point` mostra o que é um double, e `floating-point-and-approximation` mostra os sintomas: `0.1 + 0.2` que não dá `0.3`, e dez somas de `0.1` que não chegam a `1.0`. O trabalho numérico precisa de algo mais forte que "cuidado com float". Precisa de um orçamento: a que distância da verdade está um número calculado, qual decisão causou qual parte da diferença, e qual botão a reduz?

Um número que sai de um programa numérico costuma ter sofrido três tipos de dano. As entradas chegam com erro, de uma medição ou de um cálculo anterior. O método troca um processo infinito por um finito, o que é truncamento. O hardware arredonda cada resultado intermediário. O programador controla o segundo, o formato fixa o terceiro, e o primeiro muitas vezes vem de fora do programa. Esta lição dá nome aos três, mede cada um e mostra como interagem, porque o resto da disciplina reencontra o mesmo compromisso: reduzir o truncamento pede um passo menor ou mais trabalho, e a partir de certo ponto esse ganho é devolvido em arredondamento.

## Teoria Central

### Erro absoluto e erro relativo

Se $\hat x$ aproxima $x$, o **erro absoluto** é $\lvert\hat x - x\rvert$ e, para $x \ne 0$, o **erro relativo** é $\lvert\hat x - x\rvert/\lvert x\rvert$. Um erro absoluto de $1$ é excelente para uma distância de $10^6$ km e não significa nada para uma probabilidade. O erro relativo não tem unidade e conta dígitos, aproximadamente: um valor perto de $10^{-d}$ indica cerca de $d$ dígitos significativos corretos. Ele não está definido em $x = 0$, então qualquer teste baseado nele precisa de uma regra à parte para respostas perto de zero.

### Erro de truncamento

Erro de truncamento é o que sobra quando um processo infinito ou de limite é interrompido cedo, supondo toda operação exata. Ele existe mesmo em aritmética exata. A diferença progressiva

$$D_h f(x) = \frac{f(x+h) - f(x)}{h}$$

interrompe o limite que define $f'(x)$ num $h$ finito. Suponha $f'$ contínua no intervalo fechado entre $x$ e $x+h$ e $\lvert f''\rvert \le M$ no intervalo aberto correspondente. O teorema de Taylor com $n = 1$ (`taylor-and-maclaurin-series-with-error-bounds`) dá $D_h f(x) - f'(x) = \tfrac{h}{2} f''(\xi)$ para algum $\xi$ entre os dois, então o erro é no máximo $Mh/2$: primeira ordem em $h$.

O expoente depende dessa hipótese. Para $f(x) = \lvert x\rvert^{3/2}$ em $x = 0$ temos $f'(0) = 0$, mas $f''$ é ilimitada perto de $0$. Então $D_h f(0) = h^{1/2}$ para $h > 0$, e assim $h = 10^{-2}$ dá erro $0{,}1$ e $h = 10^{-6}$ dá apenas $10^{-3}$: ordem $\tfrac12$, não $1$.

### Erro de arredondamento

O erro de arredondamento vem de guardar um resultado em precisão finita. O **épsilon de máquina** $\epsilon$ é a distância entre $1$ e o float seguinte: $2^{-52} \approx 2{,}22\times10^{-16}$ em float64 e $2^{-23} \approx 1{,}19\times10^{-7}$ em float32, o valor que `numpy.finfo` chama de `eps`. Arredondar para o mais próximo tem erro relativo no máximo igual ao **unit roundoff** $u = \epsilon/2$, ou seja, $2^{-53}$ e $2^{-24}$. A terminologia varia: o artigo de Goldberg usa "machine epsilon" para $u$, então confira a definição em cada referência.

O IEEE 754 exige arredondamento correto nas operações básicas, o que dá o **modelo padrão**:

$$\operatorname{fl}(x \circ y) = (x \circ y)(1 + \delta), \qquad \lvert\delta\rvert \le u, \qquad \circ \in \{+, -, \times, /\}.$$

Ele vale quando o resultado exato cai na faixa normalizada. Fora dela, pode falhar: `5e-324 / 2` devolve `0.0`, erro relativo de $1$, e `1e308 * 10` devolve `inf`. Uma soma ou diferença com resultado subnormal é exata, como em `5e-324 + 1.5e-323`, então para $+$ e $-$ só o overflow quebra o modelo. Em 200.000 pares de doubles, cada operando uniforme em $(-1, 1)$ vezes $2^k$ com $k$ inteiro uniforme em $[-30, 30]$ (`random` do Python, semente 1), conferidos contra aritmética racional exata, o maior $\lvert\delta\rvert$ nas quatro operações foi $1{,}11019\times10^{-16}$, abaixo de $u = 1{,}11022\times10^{-16}$.

### Propagação

Seja $\hat x$ a entrada guardada e $\hat f$ a versão calculada de $f$. O erro total se divide em duas partes:

$$\hat f(\hat x) - f(x) = \underbrace{\hat f(\hat x) - f(\hat x)}_{\text{truncamento e arredondamento no método}} + \underbrace{f(\hat x) - f(x)}_{\text{erro de entrada propagado}}.$$

Para $f$ derivável em $x$, a segunda parte vale cerca de $f'(x)(\hat x - x)$ em primeira ordem. Aplicado a duas entradas, isso diz que numa soma ou diferença os erros absolutos se somam, e num produto ou quociente os erros relativos se somam, a menos do sinal.

É na subtração que isso dói. Se $x$ e $y$ têm erros relativos de no máximo $\rho$, então

$$\frac{\lvert\Delta(x - y)\rvert}{\lvert x - y\rvert} \le \frac{\lvert x\rvert + \lvert y\rvert}{\lvert x - y\rvert}\,\rho.$$

O fator é enorme quando $x \approx y$. Isso é a **perda de significância**. A subtração em si é inocente: na aritmética IEEE, quando $y/2 \le x \le 2y$ a diferença é calculada exatamente (Teorema 11 de Goldberg), e 200.000 pares aleatórios assim não produziram nenhuma exceção. A operação só expõe erros que já estavam nos operandos. Goldberg chama isso de cancelamento catastrófico quando os operandos carregam erros de arredondamento, e de cancelamento benigno quando são conhecidos exatamente.

Num cálculo longo, o mesmo raciocínio limita a soma acumulada de $n$ termos: em primeira ordem, $\lvert\hat s_n - s_n\rvert \lesssim (n-1)\,u\sum_i\lvert x_i\rvert$.

## Exemplos Resolvidos

### Exemplo 1: o passo que não pode ir a zero

Uma verificação de gradiente em machine learning compara a derivada do backpropagation com uma diferença finita. Tome $f = \tanh$ em $x = 1$, com $f'(1) = \operatorname{sech}^2 1 = 0{,}4199743416$ e $\lvert f''(1)\rvert = 0{,}6397$. O truncamento deve ficar em torno de $0{,}32h$. Quanto ao arredondamento, $f(x+h)$ e $f(x)$ carregam cada um um erro perto de $u\lvert f\rvert$, e dividir por $h$ o amplia. Juntando:

$$E(h) \approx \frac{h}{2}\lvert f''\rvert + \frac{2u\lvert f\rvert}{h}, \qquad h^* = 2\sqrt{\frac{u\lvert f\rvert}{\lvert f''\rvert}}, \qquad E(h^*) = \lvert f''\rvert\, h^*.$$

Isso prevê $h^* = 2{,}3\times10^{-8}$ com $E = 1{,}5\times10^{-8}$ em float64, e $h^* = 5{,}3\times10^{-4}$ com $E = 3{,}4\times10^{-4}$ em float32. O erro medido:

```text
h       erro float64    erro float32
1e-01   3.09e-02        3.09e-02
1e-02   3.19e-03        3.19e-03
1e-03   3.20e-04        2.98e-04   melhor em float32
1e-04   3.20e-05        3.58e-04
1e-05   3.20e-06        2.74e-03
1e-06   3.20e-07        2.74e-03
1e-07   3.18e-08        1.76e-01
1e-08   8.53e-09        4.20e-01   melhor em float64
1e-10   2.86e-07        4.20e-01
1e-12   2.30e-05        4.20e-01
1e-14   1.91e-03        4.20e-01
1e-16   4.20e-01        4.20e-01
```

Em float64, uma reta ajustada a $\log_{10}$ do erro contra $\log_{10} h$ tem inclinação $+0{,}999$ para $h$ de $10^{-1}$ a $10^{-7}$, onde o truncamento domina e reduzir $h$ ajuda. Ela tem inclinação $-0{,}977$ para $h$ de $10^{-9}$ a $10^{-15}$, onde o arredondamento domina e reduzir $h$ atrapalha. A tabela termina em perda total: `1 + 1e-16 == 1` em float64 e `1 + 1e-8 == 1` em float32, então o quociente é $0$ e o erro é todo o $f'(1)$.

Uma fórmula melhor desloca o ponto de cruzamento sem eliminá-lo. A diferença central $\frac{f(x+h)-f(x-h)}{2h}$ tem truncamento de segunda ordem e, nesta $f$, seu melhor erro em float64 é $1{,}2\times10^{-11}$, em $h = 10^{-5}$.

### Exemplo 2: perda de significância em $1 - \cos x$

Para $x$ pequeno, $1 - \cos x \approx x^2/2$. O $\cos x$ guardado está a cerca de $u$ do valor verdadeiro e a subtração é exata, então o erro relativo pode chegar a cerca de $u/(x^2/2) = 2u/x^2$. Reescrever como $2\sin^2(x/2)$ elimina a subtração de números próximos:

```text
x      valor exato    1 - cos x      erro rel.    erro rel. de 2 sin^2(x/2)
1e-02  4.999958e-05   4.999958e-05   2.88e-13     1.42e-16
1e-04  5.000000e-09   5.000000e-09   5.24e-09     7.62e-17
1e-06  5.000000e-13   5.000445e-13   8.89e-05     9.62e-19
1e-07  5.000000e-15   4.996004e-15   7.99e-04     2.40e-17
1e-08  5.000000e-17   0.000000e+00   1.00e+00     6.88e-17
```

O teto previsto $2u/x^2$ é $2{,}2\times10^{-12}$, $2{,}2\times10^{-8}$, $2{,}2\times10^{-4}$ e $2{,}2\times10^{-2}$ nas quatro primeiras linhas, e cada erro medido fica abaixo dele. Em $x = 10^{-8}$ o teto passa de $1$ e todos os dígitos se vão. Por que uma fórmula falha e a outra sobrevive é o assunto de `conditioning-and-numerical-stability`.

### Exemplo 3: um relógio em float32

Um laço de simulação marca o tempo com `t += dt`, com $dt = 0{,}1$. Depois de $10^7$ ticks o valor ideal é $10^6$:

```text
método                          resultado           erro
float32, t += 0.1               1087937.0           +8.8e+04
float32, numpy.sum              999989.4375         -1.1e+01
float64, t += 0.1               999999.9998389754   -1.6e-04
float64, numpy.sum              999999.9999999782   -2.2e-08
float64, math.fsum              1000000.0           0
contador inteiro de ticks * 0.1 1000000.0           0
```

O relógio em float32 erra em 8,8 por cento. Isso respeita a cota de primeira ordem de $6{,}0\times10^5$, mas fica muito acima dos $\sqrt{n}\,u\,s \approx 190$ que erros aleatórios independentes sugeririam. Esses erros não são independentes. Em $[2^{19}, 2^{20})$ o espaçamento do float32 é $2^{-4} = 0{,}0625$, `t` é múltiplo dele, e `t + 0.1` arredonda para `t + 0.125` toda vez, como a execução confirma: todo passo nessa faixa vale exatamente $0{,}125$. Em $[2^{17}, 2^{19})$ todo passo vale $0{,}09375$. O mesmo arredondamento se repete, então a deriva cresce linearmente e pode mudar de sentido: $-1{,}4$ depois de $10^5$ ticks, $+958$ depois de $10^6$.

`numpy.sum` usa soma parcialmente em pares quando nenhum eixo é informado, o que encurta a cadeia de operações por que cada termo passa. `math.fsum` acompanha somas parciais intermediárias, de modo que os bits menos significativos não se perdem. O conserto mais barato para um relógio é parar de acumular: guardar um contador inteiro de ticks e multiplicar, o conselho sobre inteiros de `floating-point-and-approximation` em outro cenário.

## Equívocos Comuns e Armadilhas

- **"Truncamento e arredondamento são a mesma coisa."** O truncamento pertence ao método e sobrevive à aritmética exata. O arredondamento pertence ao formato. Eles reagem a movimentos opostos, como mostra o Exemplo 1.
- **"Um passo menor é sempre melhor."** Só até o ponto de cruzamento. Abaixo dele o erro cresce, e em $h = 10^{-16}$ a resposta em float64 é $0$.
- **"Subtrair números próximos é uma operação imprecisa."** Ali a operação é exata. Ela revela o erro que os operandos já traziam.
- **"Erros de arredondamento se cancelam em média."** Podem se comportar assim em alguns cálculos, mas o Exemplo 3 é um caso em que se repetem com o mesmo sinal numa faixa inteira de valores.
- **"O épsilon de máquina é o menor float positivo."** Ele é uma distância relativa em $1$. O menor double positivo é $2^{-1074} \approx 5\times10^{-324}$.
- **"Precisão dupla resolve isso."** Mais bits deslocam o ponto de cruzamento. O Exemplo 2 perdeu todos os dígitos em float64.
- **"A cota é o erro."** A cota da soma é $6{,}0\times10^5$ e o erro é $8{,}8\times10^4$. Cotas garantem, não estimam.

## Resumo

O erro absoluto mede distância, e o erro relativo mede distância na escala da resposta. Um resultado calculado herda o erro de entrada, o truncamento de interromper um processo de limite e o arredondamento da precisão finita. O modelo padrão $\operatorname{fl}(x\circ y) = (x\circ y)(1+\delta)$, com $\lvert\delta\rvert \le u = \epsilon/2$, descreve uma operação na faixa normalizada. Em primeira ordem, erros absolutos se somam em somas e erros relativos se somam em produtos, então subtrair números próximos amplifica o erro que eles já carregam. O truncamento cai com $h$ enquanto o arredondamento cresce como $u/h$, o que dá à diferença progressiva um melhor passo perto de $\sqrt{\epsilon}$ quando $f$ e $f''$ têm tamanhos parecidos. O arredondamento repetido pode ser enviesado em vez de aleatório, e muitas vezes sai mais barato mudar a fórmula que acrescentar precisão.

## Documentation Links

- [Goldberg (1991), What Every Computer Scientist Should Know About Floating-Point Arithmetic](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html): erro de arredondamento, o modelo de erro relativo, dígitos de guarda, cancelamento catastrófico e benigno, e subtração exata de números próximos.
- [Fundamentals of Numerical Computation, 1.1 Floating-point numbers](https://fncbook.com/floating-point): espaçamento dos floats, épsilon de máquina e precisão no formato double.
- [Fundamentals of Numerical Computation, 5.5 Convergence of finite differences](https://fncbook.com/fd-converge): truncamento das fórmulas de diferença e o compromisso com o arredondamento.
- [MIT OpenCourseWare 18.335J, Week 1](https://ocw.mit.edu/courses/18-335j-introduction-to-numerical-methods-spring-2019/pages/week-1/): resumo da aula sobre aritmética de ponto flutuante e precisão relativa, com os materiais de apoio.
- [NumPy documentation, numpy.finfo](https://numpy.org/doc/stable/reference/generated/numpy.finfo.html): limites de máquina de cada tipo float, incluindo `eps`.
- [NumPy documentation, numpy.sum](https://numpy.org/doc/stable/reference/generated/numpy.sum.html): comportamento da soma parcialmente em pares.
- [Python documentation, math](https://docs.python.org/3/library/math.html): `fsum`, `expm1`, `log1p` e funções relacionadas de ponto flutuante.
