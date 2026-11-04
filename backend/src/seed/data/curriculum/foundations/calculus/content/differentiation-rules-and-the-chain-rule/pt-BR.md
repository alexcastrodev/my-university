---
version: 1.0
updatedAt: 2026-11-04
title: "Regras de Derivação e a Regra da Cadeia"
summary: "As regras da potência, do produto, do quociente e da cadeia, deduzidas a partir da definição por limite, com a regra da cadeia lida como composição de aproximações lineares locais."
---
## Objetivos de Aprendizagem

- Aplicar as regras da constante multiplicativa, da soma, da potência, do produto e do quociente, e indicar o domínio em que cada uma vale.
- Deduzir as regras da potência, do produto e do quociente a partir da definição da derivada por limite.
- Enunciar a regra da cadeia com suas hipóteses e lê-la como a composição de duas aproximações lineares locais.
- Derivar composições aninhadas camada por camada e evitar os erros usuais (esquecer a derivada interna, usar $(fg)' = f'g'$).
- Explicar como as regras do produto e da cadeia permitem a um programa calcular derivadas exatas automaticamente, e por que a regra da cadeia é o que a retropropagação (backpropagation) aplica.

## Contexto e Motivação

A lição anterior, `the-derivative-as-a-rate-of-change`, definiu $f'(a)$ como um limite e o calculou para $x^2$, $\frac{1}{x}$ e $\sqrt{x}$, cada vez com uma álgebra diferente. Isso não escala. Uma função como $\sqrt{1 + (3x^2 - x)^2}$ exigiria uma página de álgebra sob o sinal de limite, e uma função definida por um programa com milhares de operações está fora de questão.

A saída é derivar a função pela sua estrutura. Quase toda função deste curso é construída a partir de um pequeno estoque de funções básicas, unidas por aritmética (somas, produtos, quocientes) e por composição ($f$ aplicada à saída de $g$). Se a derivada de cada operação de junção é conhecida, a derivada do todo sai de forma mecânica. As regras desta lição são as derivadas dessas operações, as regras da soma, da potência, do produto e do quociente demonstradas cada uma uma vez a partir da definição, e a regra da cadeia justificada por um argumento de aproximação linear, e usadas depois para sempre.

A regra da cadeia, a regra da composição, é a de maior alcance. Uma rede neural profunda é uma longa composição de camadas simples, e a derivada da sua perda em relação a um parâmetro das primeiras camadas é obtida multiplicando derivadas locais camada por camada (na forma multivariável da regra, `partial-derivatives-and-the-multivariable-chain-rule`). Organizar esse produto de modo eficiente é o que a retropropagação faz. Esta lição ensina apenas a regra que a torna possível, não o algoritmo.

## Teoria Central

### Linearidade e a regra da potência

Se $f$ e $g$ são diferenciáveis em $x$ e $c$ é uma constante, então $(cf)' = c f'$ e $(f + g)' = f' + g'$. Ambas decorrem diretamente das leis dos limites aplicadas ao quociente de diferenças. A derivada de uma constante é $0$.

**Regra da potência.** Para um inteiro positivo $n$, $\frac{d}{dx} x^n = n x^{n-1}$. Expandindo com o binômio de Newton:

$$\frac{(x+h)^n - x^n}{h} = \frac{n x^{n-1} h + \binom{n}{2} x^{n-2} h^2 + \cdots + h^n}{h} = n x^{n-1} + \binom{n}{2} x^{n-2} h + \cdots + h^{n-1}.$$

Todo termo depois do primeiro ainda contém um fator $h$, então some no limite. A regra se estende aos inteiros negativos pela regra do quociente abaixo, para $x \neq 0$. Para outros expoentes reais ela é demonstrada em `derivatives-of-exponentials-logarithms-and-trigonometric-functions`, onde vale para $x > 0$. Até lá, use-a apenas com expoentes inteiros.

### A regra do produto

Se $f$ e $g$ são diferenciáveis em $x$, então

$$(fg)' = f'g + fg'.$$

Dedução: some e subtraia $f(x+h)\,g(x)$ no numerador,

$$\frac{f(x+h)g(x+h) - f(x)g(x)}{h} = f(x+h)\,\frac{g(x+h) - g(x)}{h} + g(x)\,\frac{f(x+h) - f(x)}{h}.$$

Quando $h \to 0$, os quocientes viram $g'(x)$ e $f'(x)$, e $f(x+h) \to f(x)$ porque uma função diferenciável é contínua. Esse passo é essencial: o argumento precisa de $\lim_{h \to 0} f(x+h) = f(x)$, e isso vale porque $f$ é diferenciável em $x$. A regra não é $f'g'$: com $f = g = x$, o produto é $x^2$, de derivada $2x$, enquanto $f'g' = 1$.

### A regra do quociente

Se $f$ e $g$ são diferenciáveis em $x$ e $g(x) \neq 0$, então

$$\left(\frac{f}{g}\right)' = \frac{f'g - fg'}{g^2}.$$

Primeiro o inverso: $\frac{1}{h}\left(\frac{1}{g(x+h)} - \frac{1}{g(x)}\right) = -\frac{g(x+h) - g(x)}{h}\cdot\frac{1}{g(x+h)\,g(x)} \to -\frac{g'(x)}{g(x)^2}$, o que usa $g(x) \neq 0$ e a continuidade de $g$. Depois, $\frac{f}{g} = f \cdot \frac{1}{g}$ e a regra do produto dão a fórmula. A ordem no numerador importa, porque a diferença não é simétrica. A condição $g(x) \neq 0$ não basta sozinha: com $f(x) = \lvert x \rvert$ e $g(x) = 1$ em $x = 0$, o denominador é $1$, e mesmo assim $\frac{f}{g} = \lvert x \rvert$ não tem derivada ali, porque $f$ não tem.

### A regra da cadeia

**Teorema.** Se $g$ é diferenciável em $x$ e $f$ é diferenciável em $g(x)$, então $f \circ g$ é diferenciável em $x$ e

$$(f \circ g)'(x) = f'\big(g(x)\big)\, g'(x).$$

Na forma de Leibniz, com $u = g(x)$ e $y = f(u)$: $\frac{dy}{dx} = \frac{dy}{du}\cdot\frac{du}{dx}$.

**Por que é verdade.** Use a leitura por aproximação linear da lição anterior. Um pequeno passo $h$ em $x$ move a saída interna em cerca de $g'(x)\,h$. Um pequeno passo $k$ em $u$ move a saída externa em cerca de $f'(u)\,k$. Encadeando os dois, com $k = g'(x)\,h$, a saída final muda em cerca de $f'(g(x))\,g'(x)\,h$. Compor dois mapas lineares locais multiplica suas inclinações. Uma reta de inclinação $3$ seguida de uma de inclinação $4$ é uma reta de inclinação $12$.

A demonstração ingênua, que multiplica e divide por $g(x+h) - g(x)$, divide por zero sempre que $g$ assume o mesmo valor em pontos próximos. Uma demonstração completa reescreve a aproximação como uma igualdade com uma função de erro que tende a $0$. O enunciado acima é o teorema padrão.

**As hipóteses importam, mas nenhuma é necessária para a conclusão.** Sejam $g(x) = x^2$ e $f(u) = \sqrt{u}$, de modo que $f(g(x)) = \sqrt{x^2} = \lvert x \rvert$. Para $x \neq 0$, a regra da cadeia dá $\frac{1}{2\sqrt{x^2}} \cdot 2x = \frac{x}{\lvert x \rvert}$, que vale $\pm 1$, como deveria. Em $x = 0$, a função externa $\sqrt{u}$ não é diferenciável em $u = g(0) = 0$, então o teorema não se aplica, e a conclusão falha: $\lvert x \rvert$ tem uma quina em $0$. A hipótese interna pode falhar do mesmo modo: com $g(x) = \lvert x \rvert$ e $f(u) = u$, $g$ não é diferenciável em $0$, e $f \circ g = \lvert x \rvert$ também não. Mas falhar uma hipótese apenas retira a garantia. Com $g(x) = \lvert x \rvert$ e $f(u) = u^2$, $g$ não é diferenciável em $0$, e mesmo assim $f \circ g = x^2$ é.

### Camada por camada

Para uma composição de várias funções, derive de fora para dentro, multiplicando ao longo do caminho. Para $y = f(g(h(x)))$:

$$\frac{dy}{dx} = f'\big(g(h(x))\big)\cdot g'\big(h(x)\big)\cdot h'(x).$$

Um programa avalia uma composição de dentro para fora e pode multiplicar as derivadas locais na mesma passada. Essa observação é a base da diferenciação automática no modo progressivo (forward mode), mostrada no Exemplo 3.

## Exemplos Resolvidos

### Exemplo 1: regra do quociente, domínio e reta tangente

Derive $f(x) = \dfrac{3x^2 + 1}{x^2 - 2}$.

O domínio exclui $x = \pm\sqrt{2}$, onde o denominador se anula. Aplicando a regra do quociente:

$$f'(x) = \frac{6x(x^2 - 2) - (3x^2 + 1)(2x)}{(x^2 - 2)^2} = \frac{6x^3 - 12x - 6x^3 - 2x}{(x^2 - 2)^2} = \frac{-14x}{(x^2 - 2)^2}.$$

Em $x = 1$: $f(1) = \frac{4}{-1} = -4$ e $f'(1) = -14$. Uma diferença central com passo $10^{-6}$ dá $-14{,}000000$, confirmando a álgebra. A reta tangente é $y = -4 - 14(x - 1)$. Ela prevê $f(1{,}01) \approx -4{,}14$, e o valor verdadeiro é $-4{,}1436$. Em $x = 1{,}1$ ela prevê $-5{,}4$, enquanto o valor verdadeiro é $-5{,}8608$: a função caminha para a assíntota vertical em $\sqrt{2} \approx 1{,}414$, e a reta não consegue acompanhá-la.

### Exemplo 2: uma cadeia de três camadas

Derive $F(x) = \sqrt{1 + (3x^2 - x)^2}$.

Dê nome às camadas: $u = 3x^2 - x$, depois $v = 1 + u^2$, depois $F = \sqrt{v}$. Multiplique as derivadas locais:

$$F'(x) = \frac{1}{2\sqrt{v}} \cdot 2u \cdot (6x - 1) = \frac{(3x^2 - x)(6x - 1)}{\sqrt{1 + (3x^2 - x)^2}}.$$

Aqui $v \geq 1 > 0$ para todo $x$, então a raiz externa é sempre avaliada em um ponto onde é diferenciável, e $F'$ existe em todo $\mathbb{R}$. Em $x = 1$: $u = 2$, $v = 5$, logo $F'(1) = \frac{2 \cdot 5}{\sqrt{5}} = 2\sqrt{5} \approx 4{,}4721$. Uma diferença central dá $4{,}47214$.

### Exemplo 3: a regra da cadeia dentro de um programa

A diferenciação automática no modo progressivo carrega um par (valor, derivada) por todas as operações. A regra do produto define a multiplicação de pares, e a regra da cadeia define como uma função como $\sqrt{\cdot}$ os transforma:

```python
import math

class Dual:
    def __init__(self, v, d=0.0):
        self.v, self.d = v, d                      # valor e derivada
    def __add__(self, o):
        o = o if isinstance(o, Dual) else Dual(o)
        return Dual(self.v + o.v, self.d + o.d)    # regra da soma
    __radd__ = __add__
    def __sub__(self, o):
        o = o if isinstance(o, Dual) else Dual(o)
        return Dual(self.v - o.v, self.d - o.d)
    def __mul__(self, o):
        o = o if isinstance(o, Dual) else Dual(o)
        return Dual(self.v * o.v, self.d * o.v + self.v * o.d)   # regra do produto
    __rmul__ = __mul__

def dsqrt(a):
    r = math.sqrt(a.v)
    return Dual(r, a.d / (2 * r))                  # regra da cadeia com derivada externa 1/(2 sqrt)

def F(x):
    u = 3 * x * x - x
    return dsqrt(1 + u * u)

out = F(Dual(1.0, 1.0))        # semente: dx/dx = 1
print(out.v, out.d)            # 2.23606797749979 4.47213595499958
```

O programa imprime $\sqrt{5}$ e $2\sqrt{5}$, coincidindo com o Exemplo 2 sem nenhuma álgebra simbólica e sem passo, de modo que o compromisso entre erro de truncamento e erro de cancelamento visto nas diferenças numéricas da lição anterior não aparece. Resta apenas o arredondamento comum.

## Equívocos Comuns e Armadilhas

- **"A derivada de um produto é o produto das derivadas."** É $f'g + fg'$. O contraexemplo $x \cdot x$ tem derivada $2x$, não $1$.
- **"Derivar $(x^2 + 1)^3$ dá $3(x^2 + 1)^2$."** Isso omite a derivada interna. A resposta correta é $3(x^2+1)^2 \cdot 2x = 6x^5 + 12x^3 + 6x$, que em $x = 1$ vale $24$, o dobro do valor errado $12$.
- **"O numerador da regra do quociente pode ser escrito em qualquer ordem."** É $f'g - fg'$. Trocar os dois termos inverte o sinal do resultado.
- **"A regra da potência vale para qualquer expoente, inclusive um variável."** $\frac{d}{dx}x^n = n x^{n-1}$ vale quando o expoente é constante. Em $2^x$ a variável está no expoente e a regra dá a resposta errada, caso tratado na próxima lição.
- **"As regras se aplicam onde quer que a fórmula possa ser escrita."** Elas se aplicam onde as hipóteses valem. Tome $f(u) = u^{2/3}$ e $g(x) = x^3$ em $x = 0$: a função externa não é diferenciável em $g(0) = 0$, e a expressão da regra da cadeia $\frac{2}{3}(x^3)^{-1/3} \cdot 3x^2$ é indefinida em $0$, embora valha $2x$ para $x \neq 0$. O teorema nada diz em $0$ aqui, e a composta $x^2$ por acaso é diferenciável ali, de modo que o valor precisa ser obtido pela definição.
- **"Em uma cadeia longa, as derivadas locais são fatores inofensivos."** O produto delas é a resposta inteira. Cinquenta fatores $0{,}9$ se multiplicam em cerca de $0{,}005$, e cinquenta fatores $1{,}1$ em cerca de $117$. É a aritmética por trás dos gradientes que desaparecem e explodem em redes profundas, e é consequência da regra da cadeia, não de um defeito de implementação.

## Resumo

Derivadas podem ser calculadas pela estrutura: constantes e somas por linearidade, $x^n$ por $n x^{n-1}$ para expoentes inteiros, produtos por $f'g + fg'$ e quocientes por $\frac{f'g - fg'}{g^2}$ onde $f$ e $g$ são diferenciáveis e $g \neq 0$. As regras da soma, da potência, do produto e do quociente são demonstradas uma vez a partir da definição por limite, e a regra da cadeia é justificada por um argumento de aproximação linear. A regra da cadeia, $(f \circ g)'(x) = f'(g(x))\,g'(x)$, exige $g$ diferenciável em $x$ e $f$ diferenciável em $g(x)$, e diz que as inclinações de aproximações lineares locais compostas se multiplicam. Uma composição é derivada de fora para dentro, multiplicando um fator por camada. A mesma contabilidade executada por um programa dá derivadas exatas (a menos de arredondamento) sem álgebra simbólica nem passo, que é o princípio da diferenciação automática e, em aprendizado profundo, da retropropagação. A próxima lição, `derivatives-of-exponentials-logarithms-and-trigonometric-functions`, fornece as derivadas das demais funções básicas, de modo que estas regras alcancem quase todas as funções da prática.

## Documentation Links

- [OpenStax Calculus Volume 1, 3.3 Differentiation Rules](https://openstax.org/books/calculus-volume-1/pages/3-3-differentiation-rules): regras da constante, da potência, da soma, do produto e do quociente
- [OpenStax Calculus Volume 1, 3.6 The Chain Rule](https://openstax.org/books/calculus-volume-1/pages/3-6-the-chain-rule): a regra da cadeia, composições de várias funções e exemplos resolvidos
- [MIT OCW 18.01SC, Session 11: Chain Rule](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-a-definition-and-basic-rules/session-11-chain-rule/): a regra da cadeia em videoaulas e notas
- [MIT OCW 18.01SC, Session 9: Product Rule](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-a-definition-and-basic-rules/session-9-product-rule/): a regra do produto em videoaulas e notas
- [Active Calculus, 2.5 The chain rule](https://activecalculus.org/single/sec-2-5-chain.html): a regra da cadeia com exercícios
