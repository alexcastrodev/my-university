---
version: 1.0
updatedAt: 2026-11-04
title: "Limites: Intuição e a Definição Formal"
summary: "O que significa f(x) se aproximar de um valor, primeiro por tabelas e gráficos e depois pela definição épsilon-delta, com limites laterais e os casos em que um limite não existe."
---
## Objetivos de Aprendizagem

- Explicar o que $\lim_{x\to a}f(x)=L$ diz em palavras, incluindo por que o valor $f(a)$ não tem papel nenhum.
- Estimar um limite a partir de uma tabela ou de um gráfico, e reconhecer quando uma tabela engana.
- Calcular limites laterais e usá-los para decidir se o limite bilateral existe.
- Classificar as três formas padrão de um limite não existir: salto, crescimento ilimitado e oscilação.
- Enunciar a definição $\varepsilon$-$\delta$ e fazer uma demonstração completa, com números explícitos, para uma função linear e uma não linear.

## Contexto e Motivação

A derivada, a integral e a soma de uma série infinita são todas definidas como limites, então esta é a lição em que o resto da disciplina se apoia. O motivo de os limites existirem é prático. A velocidade média de um carro num intervalo é distância dividida por tempo, mas a velocidade num instante seria $0/0$. O limite é a ferramenta que dá sentido a essa expressão: não dividindo zero por zero, mas perguntando o que o quociente faz quando o intervalo encolhe em direção a zero.

Quem programa encontra o mesmo obstáculo sem o vocabulário. Não dá para avaliar uma função no ponto em que ela é indefinida, então avaliamos em pontos próximos e confiamos na tendência. Esta lição mostra quando essa confiança se justifica e quando não (uma tabela em ponto flutuante abaixo dá a resposta errada). O remédio é uma definição precisa: uma que diz exatamente o que "perto" significa e pode ser verificada sem computador. Essa definição também tem a forma de toda garantia numérica em computação: para obter uma saída dentro de $\varepsilon$ do valor verdadeiro, com que precisão a entrada precisa ser conhecida? As funções usadas aqui vêm de `functions-and-the-elementary-families`.

## Teoria Central

### Aproximando-se de um valor

Considere $f(x)=\dfrac{x^2-1}{x-1}$. Ela é indefinida em $x=1$, pois a fórmula dá $0/0$. Mesmo assim, para $x\ne1$ podemos fatorar e cancelar, então $f(x)=x+1$. Avaliando perto de $1$:

```text
     x     0.9   0.99  0.999  1.001   1.01    1.1
  f(x)     1.9   1.99  1.999  2.001   2.01    2.1
```

Os valores se aproximam de 2 pelos dois lados. Escrevemos $\lim_{x\to1}f(x)=2$ e lemos: "$f(x)$ pode ser feita tão próxima de 2 quanto quisermos tomando $x$ suficientemente perto de 1, mas diferente de 1." A restrição $x\ne a$ faz parte da ideia. Um limite descreve o comportamento de $f$ perto de $a$, não em $a$. A função pode ser indefinida em $a$, ou definida com outro valor, e o limite é o mesmo.

### Tabelas podem mentir

Uma tabela é evidência, não demonstração. O limite $\lim_{x\to0}\dfrac{1-\cos x}{x^2}$ vale $\tfrac12$. Calculando em precisão dupla com a fórmula como está escrita:

```text
       x    (1-cos x)/x^2    2 sin^2(x/2)/x^2
   1e-01     0.4995834722        0.4995834722
   1e-04     0.4999999970        0.4999999996
   1e-06     0.5000444503        0.5000000000
   1e-07     0.4996003611        0.5000000000
   1e-08     0.0000000000        0.5000000000
```

A coluna da esquerda se afasta de $0{,}5$ e depois colapsa para $0$, porque $\cos x$ é tão próximo de 1 que a subtração $1-\cos x$ cancela todos os dígitos significativos. A coluna da direita usa a identidade $1-\cos x=2\sin^2(x/2)$, que é a mesma função escrita sem subtrair números quase iguais. Quem parasse de ler a coluna da esquerda em $x=10^{-8}$ concluiria que o limite é $0$. O limite é um fato sobre a função, e a definição abaixo é o que permite raciocinar sobre a função e não sobre a sua sombra em ponto flutuante.

### Limites laterais e as formas de um limite falhar

O **limite lateral à esquerda** $\lim_{x\to a^-}f(x)$ usa apenas $x<a$, e o **limite lateral à direita** $\lim_{x\to a^+}f(x)$ usa apenas $x>a$.

**Teorema.** $\lim_{x\to a}f(x)=L$ se e somente se os dois limites laterais existem e ambos valem $L$.

A hipótese "ambos iguais" pode falhar. Para $f(x)=\lvert x\rvert/x$, o limite à direita em $0$ é $1$ e o limite à esquerda é $-1$. Os dois existem, são diferentes, e portanto o limite bilateral não existe. Três padrões cobrem a maioria das falhas:

- **Salto.** Os limites laterais existem mas diferem (o caso acima).
- **Crescimento ilimitado.** Para $1/x^2$ em $0$ os valores são $100$, $10.000$, $10^6$ em $x=0{,}1;\,0{,}01;\,0{,}001$. Escrevemos $\lim_{x\to0}1/x^2=\infty$ como descrição de como o limite deixa de ser um número real, não como um número.
- **Oscilação.** $\sin(1/x)$ em $0$ vale $1$ em $x_n=1/(\pi/2+2\pi n)$ e $-1$ em $x_n'=1/(3\pi/2+2\pi n)$. Para $n=1,2,3$ a primeira sequência é $0{,}1273;\ 0{,}0707;\ 0{,}0490$ e a segunda é $0{,}0909;\ 0{,}0579;\ 0{,}0424$. Ambas encolhem em direção a $0$, mas o valor da função alterna entre $1$ e $-1$ ao longo delas, então nenhum $L$ serve.

### A definição épsilon-delta

**Definição.** Seja $f$ definida num intervalo em torno de $a$, exceto possivelmente em $a$. Então $\lim_{x\to a}f(x)=L$ significa: para todo $\varepsilon>0$ existe $\delta>0$ tal que

$$0<\lvert x-a\rvert<\delta \quad\Longrightarrow\quad \lvert f(x)-L\rvert<\varepsilon.$$

É um jogo de desafio e resposta. Um adversário escolhe uma tolerância $\varepsilon$ em torno de $L$ no lado da saída. Você precisa responder com um $\delta$ que coloque todo $x$ a menos de $\delta$ de $a$ (exceto o próprio $a$) dentro dessa tolerância. Se você sempre consegue responder, o limite é $L$. Vários detalhes sustentam a definição:

- A desigualdade $0<\lvert x-a\rvert$ é o que exclui $x=a$.
- $\delta$ pode depender de $\varepsilon$ (tolerâncias menores costumam pedir $\delta$ menor) e de $a$.
- Qualquer $\delta$ menor também serve, então a demonstração só precisa de uma escolha válida.
- A hipótese de que $f$ é definida perto de $a$ importa: a definição precisa de pontos $x\ne a$ arbitrariamente próximos de $a$ para testar.

**Unicidade.** Se um limite existe, ele é único. Dois valores diferentes $L_1\ne L_2$ exigiriam que $f(x)$ estivesse a menos de $\lvert L_1-L_2\rvert/2$ de ambos ao mesmo tempo, o que é impossível. Por isso é legítimo escrever "o" limite.

Em termos de engenharia, $\varepsilon$ é o erro que você tolera na resposta e $\delta$ é a precisão que você precisa exigir da entrada.

## Exemplos Resolvidos

### Exemplo 1: uma função linear, $\lim_{x\to3}(2x+1)=7$

*Rascunho (de trás para frente).* Precisamos de $\lvert(2x+1)-7\rvert=2\lvert x-3\rvert<\varepsilon$, o que vale quando $\lvert x-3\rvert<\varepsilon/2$. Então escolha $\delta=\varepsilon/2$.

*Demonstração (para frente).* Seja $\varepsilon>0$ e tome $\delta=\varepsilon/2$. Se $0<\lvert x-3\rvert<\delta$, então $\lvert(2x+1)-7\rvert=2\lvert x-3\rvert<2\delta=\varepsilon$. $\blacksquare$

*Com números reais.* Para $\varepsilon=0{,}1$ a receita dá $\delta=0{,}05$. Amostrando 100.000 pontos de $(2{,}95;\,3{,}05)$ diferentes de $3$, o maior valor de $\lvert f(x)-7\rvert$ fica logo abaixo de $0{,}1$, como esperado de uma desigualdade estrita. Para $\varepsilon=0{,}001$, $\delta=0{,}0005$. A inclinação $2$ é a taxa de câmbio entre precisão da entrada e precisão da saída.

### Exemplo 2: uma função não linear, $\lim_{x\to2}x^2=4$

*Rascunho.* Fatore: $\lvert x^2-4\rvert=\lvert x-2\rvert\,\lvert x+2\rvert$. O fator $\lvert x+2\rvert$ não é constante, então o majoramos exigindo primeiro $\delta\le1$. Então $\lvert x-2\rvert<1$ dá $1<x<3$, logo $\lvert x+2\rvert<5$. Assim $\lvert x^2-4\rvert<5\lvert x-2\rvert$, e isso é no máximo $\varepsilon$ se $\lvert x-2\rvert<\varepsilon/5$. Juntando as duas exigências: $\delta=\min(1,\varepsilon/5)$.

*Demonstração.* Dado $\varepsilon>0$, seja $\delta=\min(1,\varepsilon/5)$. Se $0<\lvert x-2\rvert<\delta$, então $\lvert x+2\rvert<5$ e $\lvert x^2-4\rvert=\lvert x-2\rvert\lvert x+2\rvert<5\delta\le\varepsilon$. $\blacksquare$

*Com números reais.* Uma varredura do intervalo em torno de $2$ (excluindo $2$) dá o erro no pior caso para cada tolerância:

```text
epsilon   delta = min(1, epsilon/5)   maior |x^2 - 4| no intervalo
      1                         0.2                           0.84
    0.1                        0.02                         0.0804
   0.01                       0.002                       0.008004
    100                           1                              5
```

A receita é segura, mas não justa: o erro real fica abaixo de $\varepsilon$ com folga. O $\min$ com $1$ é necessário para esta receita. Para $\varepsilon=100$, usar apenas $\varepsilon/5=20$ permitiria $x=21$, que está a menos de $20$ de $2$, e no entanto $\lvert 21^2-4\rvert=437>100$. A receita $\delta=\varepsilon/5$ falha exatamente quando $\varepsilon>5$, porque a cota $\lvert x+2\rvert<5$ exige $\delta\le1$. O teto é um conserto; $\delta=\varepsilon/(5+\varepsilon)$ é outro.

### Exemplo 3: mostrando que um limite não existe

Afirmação: $\lim_{x\to0}\lvert x\rvert/x$ não existe. Suponha que valha algum $L$ e tome $\varepsilon=\tfrac12$. Para qualquer $\delta>0$, os pontos $x=\pm\delta/2$ satisfazem $0<\lvert x\rvert<\delta$ e dão os valores $1$ e $-1$. Se ambos estivessem a menos de $\tfrac12$ de $L$, então $2=\lvert1-(-1)\rvert\le\lvert1-L\rvert+\lvert L+1\rvert<1$, uma contradição. Nenhum $\delta$ responde a $\varepsilon=\tfrac12$, então nenhum $L$ serve. Um desafio perdido para um único $\varepsilon$ basta.

### Exemplo 4: o limite ignora o ponto

Para $f(x)=\dfrac{x^2-1}{x-1}$ em $a=1$: para $x\ne1$, $\lvert f(x)-2\rvert=\lvert x+1-2\rvert=\lvert x-1\rvert$. Então $\delta=\varepsilon$ serve, e $\lim_{x\to1}f(x)=2$ mesmo que $f(1)$ não exista. Se redefinirmos $f(1)=10$, o limite continua $2$. Quando o limite e o valor coincidem, isso é uma propriedade com nome próprio, continuidade, tratada em `continuity-and-the-intermediate-value-theorem`.

## Equívocos Comuns e Armadilhas

- **"O limite é o valor da função no ponto."** Só para funções bem comportadas, e essa coincidência é uma propriedade à parte. O Exemplo 4 mostra um limite sem valor. A função $\operatorname{sgn}x$, definida com $\operatorname{sgn}0=0$, tem valor em $0$ e nenhum limite ali (os limites laterais são $-1$ e $1$).
- **"A função nunca atinge o limite."** Nada exige isso. A função constante $f(x)=3$ tem limite $3$ e é igual a ele em toda parte. A condição $x\ne a$ só diz que o próprio ponto $a$ é excluído.
- **"Uma tabela que se estabiliza prova o limite."** A tabela em ponto flutuante acima colapsou para $0$ na última linha e estava errada. Tabelas sugerem uma conjectura, e a definição (ou uma lei de limites da próxima lição, `limit-laws-and-indeterminate-forms`) a demonstra.
- **"$\lim=\infty$ significa que o limite existe."** O limite não existe como número real. O símbolo registra a maneira como ele falha.
- **"Escolha $\delta=\varepsilon$ e pronto."** Isso funciona quando a inclinação é $1$, como no Exemplo 4. Para $2x+1$ é preciso $\varepsilon/2$, e para $x^2$ perto de $2$ precisa tanto do fator $1/5$ quanto do teto: $\delta=\min(1,\varepsilon)$ falha em $\varepsilon=0{,}1$, pois $x=2{,}09$ está a menos de $0{,}1$ de $2$ e dá $\lvert x^2-4\rvert=0{,}3681$.
- **"Uma fórmula para $\delta$ só precisa funcionar para $\varepsilon$ pequeno."** Ela precisa funcionar para todo $\varepsilon>0$. A escolha $\delta=\varepsilon/5$ parece boa em $\varepsilon=0{,}1$ e falha em $\varepsilon=100$ (Exemplo 2).
- **"Se os dois limites laterais existem, o limite existe."** Eles também precisam ser iguais.

## Resumo

A afirmação $\lim_{x\to a}f(x)=L$ diz que $f(x)$ pode ser forçada para dentro de qualquer tolerância $\varepsilon$ de $L$ mantendo $x\ne a$ a uma distância pequena o bastante $\delta$ de $a$. Ela depende apenas do que $f$ faz perto de $a$, nunca de $f(a)$. Um limite bilateral existe exatamente quando os dois limites laterais existem e coincidem, e falha por salto, por crescimento ilimitado ou por oscilação. Tabelas e avaliação em ponto flutuante servem para adivinhar e não servem para decidir. A demonstração $\varepsilon$-$\delta$ é uma receita: majore o erro por um múltiplo de $\lvert x-a\rvert$ (impondo um teto a $\delta$ quando o múltiplo varia), resolva para $\delta$ e então verifique a implicação. A próxima lição, `limit-laws-and-indeterminate-forms`, transforma a definição em álgebra para que cada limite não precise da sua própria demonstração $\varepsilon$-$\delta$.

## Documentation Links

- [OpenStax Calculus Volume 1: 2.2 The Limit of a Function](https://openstax.org/books/calculus-volume-1/pages/2-2-the-limit-of-a-function): limites por tabelas e gráficos, limites laterais e limites infinitos.
- [OpenStax Calculus Volume 1: 2.5 The Precise Definition of a Limit](https://openstax.org/books/calculus-volume-1/pages/2-5-the-precise-definition-of-a-limit): a definição $\varepsilon$-$\delta$, demonstrações para funções lineares e não lineares, e as versões lateral e infinita.
- [MIT OpenCourseWare 18.01SC: Part A, Definition and Basic Rules](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-a-definition-and-basic-rules/): uma unidade de curso gratuita cujas sessões 4, 5 e 8 cobrem limites e continuidade, descontinuidade e limites de seno e cosseno, com vídeos e notas.
